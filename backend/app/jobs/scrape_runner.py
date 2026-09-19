"""Linux subreaper supervisor containing even detached Chromium descendants.

The supervisor survives worker-parent death. It marks a durable cleanup barrier
before launch and clears it via a fresh DB connection only after all descendants
are dead and reaped. An unconfirmed barrier blocks automatic lease recovery.
"""
import ctypes
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

CLEAN_ERROR = 125
CLEAN_TIMEOUT = 124
UNCERTAIN_CLEANUP = 126


def enable_subreaper():
    if sys.platform != 'linux':
        raise RuntimeError('Durable scraper containment requires Linux')
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise OSError(ctypes.get_errno(), 'Could not enable scraper subreaper')


def _processes():
    result = {}
    for path in Path('/proc').iterdir():
        if not path.name.isdigit():
            continue
        try:
            # comm may contain spaces/parentheses; fields follow its final ')'.
            tail = (path / 'stat').read_text().rsplit(')', 1)[1].split()
            result[int(path.name)] = (int(tail[1]), tail[19])  # PPID, starttime
        except (FileNotFoundError, ProcessLookupError):
            pass
    return result


def _descendants(snapshot, root):
    descendants = set()
    parents = {root}
    while parents:
        children = {pid for pid, (ppid, _) in snapshot.items() if ppid in parents}
        descendants.update(children)
        parents = children
    return descendants


def cleanup_descendants(timeout=10):
    """Freeze/kill every descendant, including new sessions and adopted orphans."""
    deadline = time.monotonic()+timeout
    while time.monotonic() < deadline:
        snapshot = _processes()
        children = _descendants(snapshot, os.getpid())
        for sig in (signal.SIGSTOP, signal.SIGKILL):
            for pid in children:
                try:
                    # Do not signal an unrelated process if the PID was reused.
                    current = (Path('/proc') / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()
                    if current[19] == snapshot[pid][1]:
                        os.kill(pid, sig)
                except (FileNotFoundError, ProcessLookupError):
                    pass
        # Subreaper adoption closes the detached/reparented-child discovery gap.
        no_children = False
        while True:
            try:
                pid, _ = os.waitpid(-1, os.WNOHANG)
                if pid == 0:
                    break
            except ChildProcessError:
                no_children = True
                break
        if no_children and not _descendants(_processes(), os.getpid()):
            return
        time.sleep(.01)
    raise RuntimeError('Could not reap all scraper descendants')


def supervise(parent_pid, deadline, command, payload, mark_started, confirm_cleanup):
    """Return (exit_code, stdout); callbacks persist fenced cleanup ownership."""
    stop = False
    def request_stop(_sig, _frame):
        nonlocal stop
        stop = True
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    enable_subreaper()
    output = b''
    code = CLEAN_ERROR
    process = None
    owns_barrier = False
    try:
        if not mark_started():
            return CLEAN_ERROR, b''  # Do not acknowledge another supervisor's barrier.
        owns_barrier = True
        if stop or os.getppid() != parent_pid or time.monotonic() >= deadline:
            code = CLEAN_TIMEOUT
        else:
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.DEVNULL, start_new_session=True)
            pending_input = payload
            while True:
                if stop or os.getppid() != parent_pid or time.monotonic() >= deadline:
                    code = CLEAN_TIMEOUT
                    break
                try:
                    output, _ = process.communicate(pending_input, timeout=.1)
                    code = 0 if process.returncode == 0 else CLEAN_ERROR
                    break
                except subprocess.TimeoutExpired:
                    pending_input = None
    except Exception:
        code = CLEAN_ERROR
    finally:
        try:
            cleanup_descendants()
            if process is not None:
                process.wait()  # Synchronize Popen after subreaper waitpid reaped it.
            # A new short-lived DB connection also works after worker death.
            if owns_barrier and not confirm_cleanup():
                return UNCERTAIN_CLEANUP, b''
        except Exception:
            return UNCERTAIN_CLEANUP, b''
    return code, output if code == 0 else b''


def _db_callback(identity, method):
    import asyncio
    from types import SimpleNamespace
    from uuid import UUID
    from app.db import session as db_session
    from app.jobs.durable_store import repository
    claim = SimpleNamespace(id=UUID(identity['id']), owner=identity['owner'], fence=identity['fence'])
    async def execute():
        db_session.init_engine()
        try:
            return await getattr(repository(), method)(claim)
        finally:
            await db_session.dispose_engine()
    return asyncio.run(execute())


def main():
    parent_pid, deadline = int(sys.argv[1]), float(sys.argv[2])
    identity = json.loads(sys.argv[3])
    # stdin is bounded and supplied by worker; command is never client-controlled.
    payload = sys.stdin.buffer.read(4096)
    code, output = supervise(parent_pid, deadline, [sys.executable, '-m', 'app.jobs.scrape_task'], payload,
        lambda: _db_callback(identity, 'mark_external_started'),
        lambda: _db_callback(identity, 'confirm_cleanup'))
    if output:
        sys.stdout.buffer.write(output)
        sys.stdout.buffer.flush()
    raise SystemExit(code)


if __name__ == '__main__':
    main()

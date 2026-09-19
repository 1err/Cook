"""No-network Linux regression suite; runnable with stdlib unittest in Docker."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

from app.jobs import scrape_runner


@unittest.skipUnless(sys.platform == 'linux', 'Linux subreaper containment; run in Docker')
class ContainmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.pidfile = self.root / 'descendant'
        self.confirmed = self.root / 'confirmed'

    def tearDown(self):
        if self.pidfile.exists():
            for pid in json.loads(self.pidfile.read_text()):
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        self.temp.cleanup()

    def wait_file(self, path):
        end = time.monotonic()+10
        while time.monotonic() < end:
            if path.exists():
                return path.read_text()
            time.sleep(.02)
        self.fail(f'timed out waiting for {path.name}')

    def supervisor_code(self, child_code, seconds=1):
        return f'''
import os,sys,time,json
from pathlib import Path
from app.jobs.scrape_runner import supervise, _descendants, _processes
def confirm():
    assert not _descendants(_processes(), os.getpid()), 'cleanup acknowledged while descendants remained'
    Path({str(self.confirmed)!r}).write_text('confirmed')
    return True
code, output = supervise(os.getppid(), time.monotonic()+{seconds},
    [sys.executable, '-c', {child_code!r}], b'', lambda: True, confirm)
if output: sys.stdout.buffer.write(output)
sys.exit(code)
'''

    def detached_child(self, exit_parent=False):
        grandchild = 'import time; time.sleep(60)'
        return f'''
import json,os,subprocess,sys,time
from pathlib import Path
p = subprocess.Popen([sys.executable, '-c', {grandchild!r}], start_new_session=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
Path({str(self.pidfile)!r}).write_text(json.dumps([p.pid]))
{'print("[]", flush=True)' if exit_parent else 'time.sleep(60)'}
'''

    def assert_gone(self):
        for pid in json.loads(self.pidfile.read_text()):
            self.assertFalse(Path(f'/proc/{pid}').exists(), f'detached PID {pid} survived or remained unreaped')
        self.assertEqual(self.confirmed.read_text(), 'confirmed')

    def test_deadline_reaps_detached_grandchild_before_confirmation(self):
        process = subprocess.Popen([sys.executable, '-c', self.supervisor_code(self.detached_child())])
        self.wait_file(self.pidfile)
        self.assertEqual(process.wait(timeout=15), scrape_runner.CLEAN_TIMEOUT)
        self.assert_gone()

    def test_success_reaps_detached_orphan_before_confirmation(self):
        process = subprocess.Popen([sys.executable, '-c', self.supervisor_code(self.detached_child(exit_parent=True))], stdout=subprocess.PIPE)
        stdout, _ = process.communicate(timeout=15)
        self.assertEqual(process.returncode, 0)
        self.assertEqual(json.loads(stdout), [])
        self.assert_gone()

    def test_parent_death_reaps_detached_grandchild(self):
        code = self.supervisor_code(self.detached_child(), seconds=30)
        launcher = f'''
import subprocess,sys,time
p = subprocess.Popen([sys.executable, '-c', {code!r}])
time.sleep(60)
'''
        parent = subprocess.Popen([sys.executable, '-c', launcher])
        try:
            self.wait_file(self.pidfile)
            parent.kill()
            parent.wait(timeout=5)
            self.wait_file(self.confirmed)
            self.assert_gone()
        finally:
            if parent.poll() is None:
                parent.kill()
                parent.wait()

    def test_termination_reaps_detached_grandchild(self):
        process = subprocess.Popen([sys.executable, '-c', self.supervisor_code(self.detached_child(), seconds=30)])
        self.wait_file(self.pidfile)
        process.terminate()
        self.assertEqual(process.wait(timeout=15), scrape_runner.CLEAN_TIMEOUT)
        self.assert_gone()

    def test_rejected_barrier_never_clears_another_supervisor(self):
        code = f"""
import os,sys,time
from pathlib import Path
from app.jobs.scrape_runner import supervise
code, _ = supervise(os.getppid(), time.monotonic()+1, [sys.executable, '-c', 'raise RuntimeError()'],
    b'', lambda: False, lambda: Path({str(self.confirmed)!r}).write_text('wrong'))
sys.exit(code)
"""
        result = subprocess.run([sys.executable, '-c', code], timeout=5)
        self.assertEqual(result.returncode, scrape_runner.CLEAN_ERROR)
        self.assertFalse(self.confirmed.exists())

    def test_real_chromium_detached_processes_die_before_confirmation(self):
        try:
            import playwright  # noqa: F401
        except ImportError:
            self.skipTest('Playwright unavailable in this image')
        child = f'''
import json,os,time
from pathlib import Path
from playwright.sync_api import sync_playwright
p = sync_playwright().start()
b = p.chromium.launch(headless=True, args=['--no-sandbox', '--disable-background-networking'])
page = b.new_page()
page.goto('about:blank')
from app.jobs.scrape_runner import _descendants, _processes
Path({str(self.pidfile)!r}).write_text(json.dumps(list(_descendants(_processes(), os.getpid()))))
time.sleep(60)
'''
        import textwrap
        errorfile = self.root / 'browser-error'
        child = 'try:\n' + textwrap.indent(child, '    ') + f'\nexcept Exception:\n    import traceback\n    from pathlib import Path\n    Path({str(errorfile)!r}).write_text(traceback.format_exc())\n    raise\n'
        process = subprocess.Popen([sys.executable, '-c', self.supervisor_code(child, seconds=5)])
        try:
            self.wait_file(self.pidfile)
        except AssertionError:
            if errorfile.exists():
                self.fail(errorfile.read_text())
            raise
        self.assertTrue(json.loads(self.pidfile.read_text()), 'expected actual Chromium descendants')
        self.assertEqual(process.wait(timeout=15), scrape_runner.CLEAN_TIMEOUT)
        self.assert_gone()


if __name__ == '__main__':
    unittest.main()

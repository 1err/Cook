"""Isolated video-text fetcher with a process-level deadline/parent-death watchdog.

The watchdog starts before provider imports. It does not depend on cancellation
of requests/urllib work and kills the isolated process group on deadline.
"""
import os
import signal
import sys
import threading
import time


def _watch(parent_pid, deadline):
    while True:
        if os.getppid() != parent_pid or time.monotonic() >= deadline:
            os.killpg(os.getpgrp(), signal.SIGKILL)
        time.sleep(.05)


def main():
    parent_pid, deadline = int(sys.argv[1]), float(sys.argv[2])
    if os.getpgrp() != os.getpid():
        raise RuntimeError('Video worker requires an isolated process group')
    if os.getppid() != parent_pid or time.monotonic() >= deadline:
        os.killpg(os.getpgrp(), signal.SIGKILL)
    threading.Thread(target=_watch, args=(parent_pid, deadline), daemon=True).start()
    import json
    from app.video_import import parse_video_source, fetch_youtube_text, fetch_tiktok_text

    request = json.loads(sys.stdin.buffer.read(8192))
    source = parse_video_source(request['url'])
    fetcher = fetch_youtube_text if source.provider == 'youtube' else fetch_tiktok_text
    result = fetcher(source)
    payload = json.dumps({name: getattr(result, name) for name in
                          ('status', 'text', 'message', 'title', 'thumbnail_url')})
    if len(payload.encode()) > 512_000:
        payload = json.dumps({'status':'fetch_failed', 'text':'',
                              'message':'Video text is too large. Paste a shorter transcript instead.'})
    sys.stdout.write(payload)
    sys.stdout.flush()


if __name__ == '__main__':
    main()

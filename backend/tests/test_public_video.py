import asyncio
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest

from app.services import public_video


@pytest.mark.asyncio
async def test_preparation_timeout_kills_and_reaps_its_child(tmp_path):
    pidfile = tmp_path / 'child.pid'
    script = 'import os,time,pathlib;pathlib.Path(__import__("sys").argv[1]).write_text(str(os.getpid()));time.sleep(20)'
    with pytest.raises(TimeoutError):
        await public_video._run(sys.executable, '-c', script, str(pidfile), timeout=.2)
    with pytest.raises(ProcessLookupError):
        os.kill(int(pidfile.read_text()), 0)


@pytest.mark.asyncio
@pytest.mark.skipif(not shutil.which('ffmpeg'), reason='ffmpeg runtime checked separately in release image')
async def test_real_compression_preserves_playable_video_and_bound(tmp_path, monkeypatch):
    source = tmp_path / 'source.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15',
        '-t', '2', '-c:v', 'mpeg4', '-q:v', '2', str(source)], check=True)
    monkeypatch.setattr(public_video, 'MAX_MEDIA_BYTES', 100_000)
    assert source.stat().st_size > 100_000
    result = await public_video.compress_public_video(source, 'video/mp4')
    assert 0 < len(result) <= 100_000
    assert result[4:8] == b'ftyp'
    subprocess.run(['ffmpeg', '-v', 'error', '-i', str(tmp_path / 'prepared.mp4'), '-f', 'null', '-'], check=True)


@pytest.mark.asyncio
@pytest.mark.skipif(not shutil.which('ffmpeg'), reason='ffmpeg runtime checked separately in release image')
async def test_malformed_public_video_is_not_prepared(tmp_path):
    source = tmp_path / 'source.mp4'
    source.write_bytes(b'\0\0\0\x18ftypisom' + b'\0'*32)
    with pytest.raises(ValueError):
        await public_video.compress_public_video(source, 'video/mp4')

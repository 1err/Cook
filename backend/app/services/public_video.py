"""Bounded local compression for public recipe videos above the inline AI limit."""
import asyncio
import json
import math
from pathlib import Path

from app.core.media_limits import MAX_MEDIA_BYTES
from app.core.video_process import _kill_and_reap


async def _run(*args, timeout):
    spawning = asyncio.create_task(asyncio.create_subprocess_exec(*args,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        start_new_session=True))
    cancelled = False
    while not spawning.done():
        try:
            await asyncio.shield(spawning)
        except asyncio.CancelledError:
            cancelled = True
    process = spawning.result()
    try:
        if cancelled:
            raise asyncio.CancelledError
        async with asyncio.timeout(timeout):
            output, _ = await process.communicate()
        if process.returncode or len(output) > 65536:
            raise ValueError('Video preparation failed')
        return output
    finally:
        cleanup = asyncio.create_task(_kill_and_reap(process))
        while not cleanup.done():
            try:
                await asyncio.shield(cleanup)
            except asyncio.CancelledError:
                cancelled = True
        cleanup.result()
        if cancelled:
            raise asyncio.CancelledError


async def compress_public_video(source: Path, media_type: str) -> bytes:
    # Only the validated container and local files reach ffmpeg, never a shell,
    # playlist, remote URL, account cookie, or share token.
    container = 'matroska' if media_type == 'video/webm' else 'mov'
    options = ['-protocol_whitelist', 'file,pipe', '-f', container, '-i', str(source)]
    probe = json.loads(await _run('ffprobe', '-v', 'error', *options,
        '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration',
        '-of', 'json', timeout=10))
    duration = float(probe.get('format', {}).get('duration', 0))
    stream = (probe.get('streams') or [{}])[0]
    pixels = int(stream.get('width', 0)) * int(stream.get('height', 0))
    if not math.isfinite(duration) or not 0 < duration <= 600 or not 0 < pixels <= 3840*2160:
        raise ValueError('Use a recipe video up to 10 minutes and 4K resolution')
    target = source.with_name('prepared.mp4')
    bitrate = min(1600, int((MAX_MEDIA_BYTES * 0.85 * 8 / duration) / 1000) - 96)
    # The production task has half a CPU. Bound decoding/filter threads too,
    # and retain 15 fps plus audio so recipe evidence fits the preparation limit.
    await _run('ffmpeg', '-v', 'error', '-nostdin', '-y', '-filter_threads', '1',
        '-threads', '1', *options,
        '-map', '0:v:0', '-map', '0:a:0?', '-vf', "fps=15,scale='min(720,iw)':-2",
        '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-crf', '24',
        '-maxrate', f'{bitrate}k', '-bufsize', f'{bitrate*2}k',
        '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', str(target), timeout=180)
    if not 0 < target.stat().st_size <= MAX_MEDIA_BYTES:
        raise ValueError('Prepared video is too large')
    return target.read_bytes()

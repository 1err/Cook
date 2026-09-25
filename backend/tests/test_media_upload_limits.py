"""Real byte boundaries for multipart ingestion; no database or paid provider calls."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from app.api import routes_imports
from app.api.auth import get_current_user
from app.core.http_security import HTTPGuardMiddleware
from app.db.session import get_session

MIB = 1024 * 1024
MP4_HEADER = b'\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isommp42'


def application(monkeypatch):
    app = FastAPI()
    app.add_middleware(HTTPGuardMiddleware, trusted_origins=[])
    app.include_router(routes_imports.router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id='fixture')
    app.dependency_overrides[get_session] = lambda: object()
    monkeypatch.setattr(routes_imports, 'video_analysis_available', lambda: True)
    admit = AsyncMock(return_value={'id':'fixture', 'status':'queued'})
    monkeypatch.setattr(routes_imports, '_admit_queue', admit)
    return app, admit


@pytest.mark.asyncio
@pytest.mark.parametrize('size', [15*MIB, 30*MIB], ids=['old-envelope-now-accepted','exact-file-limit'])
async def test_upload_accepts_bounded_file_and_preserves_bytes(monkeypatch, size):
    app, admit = application(monkeypatch)
    media = MP4_HEADER + b'\x00'*(size-len(MP4_HEADER))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/recipes/import-jobs/media',
            files={'file':('recipe.mp4',media,'video/mp4')})
    assert response.status_code == 202
    admit.assert_awaited_once()
    assert admit.await_args.kwargs['media_data'] == media
    assert admit.await_args.kwargs['media_type'] == 'video/mp4'


@pytest.mark.asyncio
async def test_file_one_byte_over_limit_rejected_before_queue_admission(monkeypatch):
    app, admit = application(monkeypatch)
    media = MP4_HEADER + b'\x00'*(30*MIB+1-len(MP4_HEADER))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/recipes/import-jobs/media',
            files={'file':('recipe.mp4',media,'video/mp4')})
    assert response.status_code == 422
    assert '30 MB' in response.json()['detail']
    admit.assert_not_awaited()


@pytest.mark.asyncio
async def test_capabilities_report_actual_file_limit(monkeypatch):
    app, _ = application(monkeypatch)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.get('/recipes/import-capabilities')
    assert response.json() == {'video_analysis':True,'media_upload':True,'max_media_bytes':30*MIB}


async def guard_result(*, path='/recipes/import-jobs/media', content_type='multipart/form-data; boundary=fixture',
                       size=0, declared=None):
    # Feed chunks without retaining a second full-size request buffer in the test.
    headers = [(b'content-type',content_type.encode())]
    if declared is not None:
        headers.append((b'content-length',str(declared).encode()))
    reads = received = 0
    sent = []
    called = False
    remaining = size
    block = b'x'*MIB
    async def receive():
        nonlocal reads,remaining
        reads += 1
        count = min(remaining,MIB)
        remaining -= count
        return {'type':'http.request','body':block[:count],'more_body':remaining>0}
    async def downstream(scope,receive,send):
        nonlocal called,received
        called = True
        while True:
            chunk = await receive()
            received += len(chunk['body'])
            if not chunk.get('more_body'):
                break
        await send({'type':'http.response.start','status':204,'headers':[]})
        await send({'type':'http.response.body','body':b''})
    async def send(message):
        sent.append(message)
    await HTTPGuardMiddleware(downstream, trusted_origins=[])(
        {'type':'http','method':'POST','path':path,'headers':headers},receive,send)
    return next(item['status'] for item in sent if item['type']=='http.response.start'),called,reads,received


@pytest.mark.asyncio
@pytest.mark.parametrize('declared', [None,31*MIB], ids=['chunked','declared'])
async def test_media_envelope_accepts_exact_31_mib(declared):
    status,called,reads,received = await guard_result(size=31*MIB,declared=declared)
    assert status == 204 and called and received == 31*MIB


@pytest.mark.asyncio
async def test_declared_media_overflow_is_rejected_without_reading_body():
    status,called,reads,_ = await guard_result(size=0,declared=31*MIB+1)
    assert status == 413 and not called and reads == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('declared',[None,1],ids=['chunked','lying-content-length'])
async def test_actual_media_overflow_never_reaches_downstream(declared):
    status,called,reads,_ = await guard_result(size=31*MIB+1,declared=declared)
    assert status == 413 and not called and reads > 0


@pytest.mark.asyncio
@pytest.mark.parametrize('path,content_type', [
    ('/recipes/upload-image','multipart/form-data; boundary=fixture'),
    ('/recipes/parse/video','multipart/form-data; boundary=fixture'),
    ('/recipes/import-jobs/media','application/json'),
    ('/recipes/import-jobs','application/json'),
])
async def test_larger_envelope_does_not_expand_other_uploads_or_json(path,content_type):
    status,called,reads,_ = await guard_result(path=path,content_type=content_type,size=0,declared=15*MIB)
    assert status == 413 and not called and reads == 0

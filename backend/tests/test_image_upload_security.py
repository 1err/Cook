from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.datastructures import Headers, UploadFile
from starlette.requests import Request

from app.api import routes_recipes
from app.services import storage_service


def request():
    return Request({"type": "http", "method": "POST", "path": "/recipes/upload-image",
                    "headers": [], "scheme": "http", "server": ("localhost", 8000)})


@pytest.mark.asyncio
async def test_an_image_content_type_cannot_disguise_html(monkeypatch, tmp_path):
    monkeypatch.setattr(routes_recipes.settings, "AWS_REGION", "")
    monkeypatch.setattr(routes_recipes.settings, "S3_BUCKET_NAME", "")
    monkeypatch.setattr(routes_recipes.settings, "LOCAL_IMAGE_UPLOAD_DIR", str(tmp_path))
    file = UploadFile(BytesIO(b"<html><script>alert(1)</script></html>"),
                      headers=Headers({"content-type": "image/jpeg"}))
    with pytest.raises(HTTPException) as result:
        await routes_recipes.upload_recipe_image(request(), file, SimpleNamespace(id=uuid4()))
    assert result.value.status_code == 400
    assert not list(tmp_path.rglob("*.jpg"))


@pytest.mark.asyncio
async def test_s3_receives_only_the_validated_bytes_not_an_unbounded_upload_capability(monkeypatch):
    monkeypatch.setattr(routes_recipes.settings, "AWS_REGION", "us-east-1")
    monkeypatch.setattr(routes_recipes.settings, "S3_BUCKET_NAME", "test-bucket")
    s3 = Mock()
    monkeypatch.setattr(storage_service.boto3, "client", lambda *a, **kw: s3)
    data = b"\x89PNG\r\n\x1a\n" + b"test-image-content"
    user = SimpleNamespace(id=uuid4(), auth_version=0)
    key = f"recipes/{user.id}/{uuid4().hex}.png"
    monkeypatch.setattr(routes_recipes, "reserve_owned_image", AsyncMock(return_value={
        "id": uuid4(), "storage_kind": "s3", "object_key": key,
        "file_url": f"https://test-bucket.s3.us-east-1.amazonaws.com/{key}",
    }))
    monkeypatch.setattr(routes_recipes, "finish_owned_upload", AsyncMock())
    file = UploadFile(BytesIO(data), headers=Headers({"content-type": "image/png"}))
    result = await routes_recipes.upload_recipe_image(
        request(), file, user, session=SimpleNamespace(close=AsyncMock()),
    )
    assert result.upload_url == ""
    assert s3.put_object.call_args.kwargs["Body"] == data
    assert s3.put_object.call_args.kwargs["ContentLength"] == len(data)
    assert f"recipes/{user.id}/" in result.file_url
    s3.generate_presigned_url.assert_not_called()

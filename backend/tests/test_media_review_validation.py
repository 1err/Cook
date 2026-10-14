"""Only canonical immutable media locations qualify for shared approval."""
import pytest
from app.core.config import settings
from app.services.media_review_service import is_immutable_app_media_url


@pytest.mark.parametrize('url', ['https://[bad/cover.png', 'https://evil.test/uploads/recipes/10000000-0000-0000-0000-000000000001/'+('a'*32)+'.png'])
def test_malformed_or_external_media_cannot_become_eligible(monkeypatch, url):
    monkeypatch.setattr(settings, 'PUBLIC_API_ORIGIN', 'http://api')
    assert not is_immutable_app_media_url(url)

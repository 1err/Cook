"""Pure validation helpers for browser-navigable Weee product links."""
from __future__ import annotations

import re
from urllib.parse import urljoin, urlsplit, urlunsplit


def normalize_weee_product_url(raw: str, *, base_url: str | None = None) -> str | None:
    value = (raw or "").strip()
    if not value:
        return None
    if base_url is not None:
        value = urljoin(base_url, value)
    try:
        parsed = urlsplit(value)
        hostname = (parsed.hostname or "").lower()
        port = parsed.port
    except ValueError:
        return None
    if parsed.scheme.lower() != "https":
        return None
    official_hosts = ("sayweee.com", "weee.com")
    if not any(hostname == host or hostname.endswith(f".{host}") for host in official_hosts):
        return None
    if parsed.username or parsed.password:
        return None
    if port not in (None, 443):
        return None
    path = re.sub(r"/+", "/", parsed.path or "/")
    if "/product/" not in path.lower():
        return None
    return urlunsplit(("https", hostname, path, parsed.query, parsed.fragment))

"""Pure validation helpers for browser-navigable Weee product links."""
from __future__ import annotations

import re
from urllib.parse import urljoin, urlsplit, urlunsplit


MAX_STORE_PRODUCTS = 3


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


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
    if parsed.username is not None or parsed.password is not None:
        return None
    if port not in (None, 443):
        return None
    path = re.sub(r"/+", "/", parsed.path or "/")
    if "/product/" not in path.lower():
        return None
    return urlunsplit(("https", hostname, path, parsed.query, parsed.fragment))


def normalize_store_products(data: object) -> list[dict[str, str]]:
    """Mechanically sanitize, deduplicate, order, and cap public products."""
    if not isinstance(data, list):
        return []
    products: list[dict[str, str]] = []
    seen_names: set[str] = set()
    seen_urls: set[str] = set()
    for row in data:
        if not isinstance(row, dict):
            continue
        values = tuple(row.get(field) for field in ("name", "price", "image", "url"))
        if not all(isinstance(value, str) for value in values):
            continue
        name, price, image, raw_url = (_normalize_space(value) for value in values)
        url = normalize_weee_product_url(raw_url)
        if not (1 <= len(name) <= 120) or url is None:
            continue
        name_key = name.casefold()
        url_key = url.casefold()
        if name_key in seen_names or url_key in seen_urls:
            continue
        seen_names.add(name_key)
        seen_urls.add(url_key)
        products.append({"name": name, "price": price, "image": image, "url": url})
        if len(products) == MAX_STORE_PRODUCTS:
            break
    return products

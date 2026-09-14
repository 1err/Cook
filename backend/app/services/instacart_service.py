"""Official Instacart shopping-page creation; no cart access or checkout."""
import asyncio
from fractions import Fraction
import math
import re
from typing import Protocol, Sequence
from urllib.parse import urlsplit

import httpx

from app.core.config import settings


class ShoppingItem(Protocol):
    name: str
    quantity: str


class ShoppingRequest(Protocol):
    title: str
    items: Sequence[ShoppingItem]


class InstacartError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 502):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


_UNITS = {
    "cup": "cup", "cups": "cup", "tbsp": "tablespoon", "tablespoon": "tablespoon", "tablespoons": "tablespoon",
    "tsp": "teaspoon", "teaspoon": "teaspoon", "teaspoons": "teaspoon",
    "ml": "ml", "milliliter": "ml", "milliliters": "ml", "l": "liter", "liter": "liter", "liters": "liter",
    "g": "g", "gram": "g", "grams": "g", "kg": "kg", "kilogram": "kg", "kilograms": "kg",
    "oz": "oz", "ounce": "oz", "ounces": "oz", "lb": "lb", "lbs": "lb", "pound": "lb", "pounds": "lb",
    "each": "each", "bunch": "bunch", "bunches": "bunch", "can": "can", "cans": "can",
    "head": "head", "heads": "head", "package": "package", "packages": "package",
}
_FRACTIONS = {"½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8"}


def parse_measurement(text: str) -> tuple[float, str] | None:
    normalized = text.strip().lower()
    for symbol, fraction in _FRACTIONS.items():
        normalized = normalized.replace(symbol, " " + fraction)
    match = re.fullmatch(r"\s*(\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?)\s*([a-z]*)\s*", normalized)
    if not match:
        return None
    unit = _UNITS.get(match[2]) if match[2] else "each"
    if unit is None:
        return None
    try:
        quantity = float(sum(Fraction(part) for part in match[1].split()))
    except (ValueError, ZeroDivisionError, OverflowError):
        return None
    return (quantity, unit) if math.isfinite(quantity) and 0 < quantity <= 1_000_000 else None


def is_safe_link(value: object) -> bool:
    if not isinstance(value, str) or not value or re.search(r"[\s\\]", value):
        return False
    try:
        url = urlsplit(value)
        return (url.scheme == "https" and url.hostname in {"www.instacart.com", "instacart.com"}
                and not url.username and not url.password and url.port in {None, 443} and len(url.path) > 1)
    except ValueError:
        return False


def provider_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0), follow_redirects=False)


async def create_shopping_link(body: ShoppingRequest) -> str:
    key = settings.INSTACART_API_KEY
    if not key or not key.get_secret_value().strip():
        raise InstacartError("instacart_not_configured", "Instacart is not connected yet. Please try again after setup.", 503)
    origin = "https://connect.instacart.com" if settings.INSTACART_ENVIRONMENT == "production" else "https://connect.dev.instacart.tools"
    line_items = []
    for item in body.items:
        line = {"name": item.name, "display_text": f"{item.name} — {item.quantity}" if item.quantity else item.name}
        measurement = parse_measurement(item.quantity)
        if measurement:
            line["line_item_measurements"] = [{"quantity": measurement[0], "unit": measurement[1]}]
        line_items.append(line)
    try:
        async with asyncio.timeout(20):
            async with provider_client() as client:
                response = await client.post(
                    f"{origin}/idp/v1/products/products_link",
                    headers={"Authorization": f"Bearer {key.get_secret_value().strip()}", "Accept": "application/json", "Accept-Language": "en-US"},
                    json={"title": body.title, "link_type": "shopping_list", "expires_in": 7, "line_items": line_items},
                )
    except (httpx.TimeoutException, TimeoutError):
        raise InstacartError("instacart_timeout", "Instacart took too long to respond. Please try again.", 504) from None
    except httpx.RequestError:
        raise InstacartError("instacart_unavailable", "Could not reach Instacart. Please try again.") from None
    if response.status_code in {401, 403}:
        raise InstacartError("instacart_not_configured", "Instacart is not connected yet. Please try again after setup.", 503)
    if response.status_code == 429:
        raise InstacartError("instacart_rate_limited", "Instacart is busy. Please wait a moment and try again.", 429)
    if not response.is_success:
        raise InstacartError("instacart_unavailable", "Could not create an Instacart shopping link. Please try again.")
    try:
        result = response.json()
        url = result.get("products_link_url") if isinstance(result, dict) else None
    except ValueError:
        url = None
    if not is_safe_link(url):
        raise InstacartError("instacart_invalid_response", "Instacart returned an unusable shopping link. Please try again.")
    return url

"""Observe completed requests; never change a business response."""

from uuid import UUID, uuid4, uuid5, NAMESPACE_URL
from starlette.datastructures import Headers
from app.analytics.repository import safe_record
from app.analytics.schema import ClientEvent, normalize_referrer


def classify_operation(method, route, status):
    if not 200 <= status < 300:
        return None
    return {
        ("POST", "/auth/register"): "registered",
        ("POST", "/auth/login"): "login",
        ("POST", "/auth/google"): "login",
        ("POST", "/recipes"): "recipe_saved",
        ("POST", "/recipes/catalog/{recipe_id}/copy"): "recipe_saved",
        ("POST", "/users/{user_id}/recipes/{recipe_id}/copy"): "recipe_saved",
        ("PUT", "/meal-plan/{date}"): "meal_planned",
        ("POST", "/cooking-session"): "cooking_started",
        ("POST", "/cooking-session/{session_id}/finish"): "cooking_completed",
        ("POST", "/shopping-list/instacart"): "retailer_link_created",
    }.get((method, route))


def browser_context(headers):
    result = {}
    if headers.get("dnt") == "1" or headers.get("sec-gpc") == "1":
        return result
    for key in ("visitor", "session"):
        try:
            result[key + "_id"] = UUID(headers.get("x-cw-" + key, ""))
        except ValueError:
            pass
    for key in ("source", "medium", "campaign"):
        value = headers.get("x-cw-" + key)
        try:
            result[key] = ClientEvent.campaign_identifier(value)
        except ValueError:
            pass
    result["referrer"] = normalize_referrer(headers.get("x-cw-referrer"))
    return result


class AnalyticsMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        status = 500

        async def observe(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        await self.app(scope, receive, observe)
        state = scope.get("state", {})
        route = getattr(scope.get("route"), "path", "")
        name = classify_operation(scope["method"], route, status)
        actor = state.get("analytics_user_id")
        if not name or not actor or state.get("analytics_skip"):
            return
        headers = Headers(scope=scope)
        try:
            supplied = UUID(headers.get("x-cw-event-id", ""))
        except ValueError:
            supplied = uuid4()
        await safe_record(
            {
                "id": uuid5(NAMESPACE_URL, f"chef-world:{actor}:{name}:{supplied}"),
                "name": name,
                "user_id": UUID(str(actor)),
                "is_client": False,
                "platform": "mobile"
                if headers.get("authorization", "").lower().startswith("bearer ")
                else "web",
                **browser_context(headers),
            }
        )

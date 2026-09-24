"""Browser mutation protection and bounded request ingestion before FastAPI parses bodies."""
from collections import deque

from starlette.datastructures import Headers
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class HTTPGuardMiddleware:
    def __init__(self, app: ASGIApp, trusted_origins: list[str],
                 json_limit: int = 1_048_576, upload_limit: int = 12_582_912):
        self.app = app
        self.trusted_origins = set(trusted_origins)
        self.json_limit = json_limit
        self.upload_limit = upload_limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in {"GET", "HEAD", "OPTIONS"}:
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        origin = headers.get("origin")
        scheme, _, token = headers.get("authorization", "").partition(" ")
        bearer = scheme.lower() == "bearer" and bool(token.strip())
        cookie = Request(scope).cookies.get("access_token")
        if not bearer and ((origin is not None and origin not in self.trusted_origins)
                           or (cookie and origin not in self.trusted_origins)):
            await JSONResponse({"detail": "Untrusted request origin"}, status_code=403)(scope, receive, send)
            return

        limit = self.upload_limit if headers.get("content-type", "").lower().startswith("multipart/form-data") else self.json_limit
        if scope.get('path') == '/analytics/events':
            limit = min(limit, 4096)
        try:
            declared = int(headers.get("content-length", "0"))
        except ValueError:
            declared = -1
        if declared < 0 or declared > limit:
            await JSONResponse({"detail": "Request body too large or invalid"}, status_code=413)(scope, receive, send)
            return

        # Validate actual bytes too: chunked bodies and false Content-Length values
        # cannot make the downstream JSON/multipart parser allocate without a cap.
        messages = deque()
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > limit:
                await JSONResponse({"detail": "Request body too large"}, status_code=413)(scope, receive, send)
                return
            messages.append(message)
            if not message.get("more_body", False):
                break

        async def bounded_receive():
            return messages.popleft() if messages else await receive()

        await self.app(scope, bounded_receive, send)

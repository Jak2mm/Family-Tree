"""Upload size limit for photos, applied before the form is spooled to disk."""
import re

from starlette.responses import JSONResponse

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
FORM_OVERHEAD = 64 * 1024
TOO_LARGE = "That picture is too large. The limit is 15 MB."
UPLOAD_PATH = re.compile(r"^/api/albums/[^/]+/photos/?$")


class UploadSizeLimit:
    """ASGI middleware: stop oversized photo uploads before the form is spooled to disk.

    Applies only to POST /api/albums/{id}/photos. Rejects on Content-Length, and counts bytes
    when there is none. The exact 15 MB check on the file itself stays in the handler.
    """

    limit = MAX_UPLOAD_BYTES + FORM_OVERHEAD

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST" or not UPLOAD_PATH.match(scope["path"]):
            return await self.app(scope, receive, send)
        declared = dict(scope["headers"]).get(b"content-length")
        reject = JSONResponse({"detail": TOO_LARGE}, status_code=413)
        if declared is not None:
            try:
                length = int(declared)
            except ValueError:
                length = None  # not a valid integer: count the bytes instead
            if length is not None:
                if length > self.limit:
                    return await reject(scope, receive, send)
                return await self.app(scope, receive, send)

        total, rejected = 0, False

        async def counting_receive():
            nonlocal total, rejected
            if rejected:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > self.limit:
                    rejected = True
                    await reject(scope, receive, send)
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message):
            if not rejected:
                await send(message)

        await self.app(scope, counting_receive, guarded_send)

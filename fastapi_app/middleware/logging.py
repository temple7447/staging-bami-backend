import time, logging, uuid
from fastapi import Request

logger = logging.getLogger("bamihustle")


async def logging_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())
    start = time.time()
    auth_present = "present" if request.headers.get("authorization") else "none"

    logger.info(
        "Incoming request",
        extra={
            "request_id": request_id,
            "method":     request.method,
            "url":        str(request.url),
            "auth":       auth_present,
        },
    )

    response = await call_next(request)
    duration_ms = round((time.time() - start) * 1000)

    logger.info(
        "Request completed",
        extra={
            "request_id":  request_id,
            "method":      request.method,
            "url":         str(request.url),
            "status_code": response.status_code,
            "duration_ms": duration_ms,
        },
    )
    response.headers["X-Request-ID"] = request_id
    return response

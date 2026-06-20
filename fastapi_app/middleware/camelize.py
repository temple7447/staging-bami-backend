import json
from fastapi import Request, Response


def _snake_to_camel(name: str) -> str:
    if name.startswith("_"):
        return name
    parts = name.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


def _camelize(obj):
    if isinstance(obj, dict):
        return {_snake_to_camel(k): _camelize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_camelize(i) for i in obj]
    return obj


async def camelize_response_middleware(request: Request, call_next):
    response = await call_next(request)
    if "application/json" not in response.headers.get("content-type", ""):
        return response
    body = b""
    async for chunk in response.body_iterator:
        body += chunk
    try:
        data = json.loads(body)
        new_body = json.dumps(_camelize(data), default=str).encode()
        headers = dict(response.headers)
        headers["content-length"] = str(len(new_body))
        return Response(
            content=new_body,
            status_code=response.status_code,
            headers=headers,
            media_type="application/json",
        )
    except Exception:
        return Response(
            content=body,
            status_code=response.status_code,
            headers=dict(response.headers),
        )

"""Shared SSE streaming helper over the Anthropic Messages API.

Used by the Coach chat (services/ai_coach.py) and the Ops Manager chat
(api/v1/endpoints/ops_manager.py) so both share one wire format and one
frontend parser (src/lib/streamChat.ts).
"""
import json
import logging
from typing import AsyncGenerator

from services.ai_coach import _get_client

logger = logging.getLogger(__name__)


async def stream_claude(
    system_blocks: list[dict],
    messages: list[dict],
    model: str = "claude-sonnet-4-6",
    max_tokens: int = 1024,
) -> AsyncGenerator[bytes, None]:
    """Yield Server-Sent-Events frames: `data: {"delta": "..."}\\n\\n` per token,
    terminated by `data: [DONE]\\n\\n`. Errors are surfaced as a single
    `data: {"error": "..."}\\n\\n` frame so the frontend can show a toast instead
    of hanging.
    """
    try:
        async with _get_client().messages.stream(
            model=model,
            max_tokens=max_tokens,
            system=system_blocks,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield f"data: {json.dumps({'delta': text})}\n\n".encode()
    except Exception as e:
        logger.error(f"stream_claude failed: {e}", exc_info=True)
        yield f"data: {json.dumps({'error': str(e)})}\n\n".encode()
    yield b"data: [DONE]\n\n"

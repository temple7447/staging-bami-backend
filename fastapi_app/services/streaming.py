"""Shared SSE streaming helper over the configured LLM provider.

Used by the Coach chat (services/ai_coach.py) and the Ops Manager chat
(api/v1/endpoints/ops_manager.py) so both share one wire format and one
frontend parser (src/lib/streamChat.ts). Provider (DeepSeek/Claude) is chosen
by AI_PROVIDER via services/llm.py — this file is provider-agnostic.
"""
import json
import logging
from typing import AsyncGenerator

from services import llm

logger = logging.getLogger(__name__)


async def stream_claude(
    system_blocks,
    messages: list[dict],
    max_tokens: int = 1024,
) -> AsyncGenerator[bytes, None]:
    """Yield Server-Sent-Events frames: `data: {"delta": "..."}\\n\\n` per token,
    terminated by `data: [DONE]\\n\\n`. Errors are surfaced as a single
    `data: {"error": "..."}\\n\\n` frame so the frontend can show a toast instead
    of hanging. (Name kept for backward compatibility; provider is configurable.)
    """
    try:
        async for delta in llm.stream_text(system_blocks, messages, tier=llm.DEEP, max_tokens=max_tokens):
            yield f"data: {json.dumps({'delta': delta})}\n\n".encode()
    except Exception as e:
        logger.error(f"stream_claude failed: {e}", exc_info=True)
        yield f"data: {json.dumps({'error': str(e)})}\n\n".encode()
    yield b"data: [DONE]\n\n"

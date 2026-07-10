"""Provider-agnostic LLM wrapper.

Every text/reasoning call in the app goes through here so the backend can switch
between DeepSeek (OpenAI-compatible) and Anthropic Claude with a single env var,
`AI_PROVIDER` (see core/config.py). Image generation is NOT handled here — it
stays on Gemini (utils/image_gen.py), because DeepSeek has no image model.

Call sites use three entry points:
  - text(system, prompt, tier, max_tokens)                  -> str
  - complete(system, messages, tier, max_tokens, tools=...) -> LLMResult
  - stream_text(system, messages, tier, max_tokens)         -> async str deltas

`system` may be a plain string OR a list of Anthropic-style content blocks
(e.g. [{"type": "text", "text": "...", "cache_control": {...}}]); the list is
flattened to a single string for both providers. Anthropic prompt-cache markers
are dropped for DeepSeek, which does automatic server-side context caching.

Tools use the Anthropic tool shape ({name, description, input_schema}) as the
canonical form; it's translated to OpenAI's function shape for DeepSeek.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import AsyncGenerator

from core.config import settings

logger = logging.getLogger(__name__)

# Model tiers → concrete model id per provider. "fast" for cheap/latency-sensitive
# work, "deep" for heavier reasoning.
FAST = "fast"
DEEP = "deep"

_MODELS = {
    "deepseek":  {FAST: "deepseek-chat", DEEP: "deepseek-chat"},
    "anthropic": {FAST: "claude-haiku-4-5", DEEP: "claude-sonnet-4-6"},
}

# Cached singleton clients (constructing per-call churns the HTTP pool).
_anthropic = None
_openai = None


def _provider() -> str:
    p = (settings.AI_PROVIDER or "deepseek").lower()
    return p if p in _MODELS else "deepseek"


def _model(tier: str) -> str:
    prov = _provider()
    return _MODELS[prov].get(tier, _MODELS[prov][FAST])


def _anthropic_client():
    global _anthropic
    if _anthropic is None:
        import anthropic
        _anthropic = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _anthropic


def _openai_client():
    global _openai
    if _openai is None:
        from openai import AsyncOpenAI
        _openai = AsyncOpenAI(
            api_key=settings.DEEPSEEK_API_KEY,
            base_url=settings.DEEPSEEK_BASE_URL,
        )
    return _openai


def _normalize_system(system) -> str:
    """Accept a string or a list of Anthropic content blocks; return a string."""
    if not system:
        return ""
    if isinstance(system, str):
        return system
    parts = []
    for block in system:
        if isinstance(block, dict):
            parts.append(block.get("text", ""))
        elif isinstance(block, str):
            parts.append(block)
    return "\n\n".join(p for p in parts if p)


def _to_openai_tool(tool: dict) -> dict:
    """Anthropic tool {name, description, input_schema} → OpenAI function tool."""
    return {
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool.get("description", ""),
            "parameters": tool.get("input_schema", tool.get("parameters", {})),
        },
    }


@dataclass
class LLMResult:
    text: str = ""
    tool_input: dict | None = None


async def complete(
    system,
    messages: list[dict],
    tier: str = FAST,
    max_tokens: int = 400,
    tools: list[dict] | None = None,
    tool_choice_name: str | None = None,
) -> LLMResult:
    """One-shot completion. Returns text and, if a tool was forced, its parsed input."""
    system_str = _normalize_system(system)
    model = _model(tier)

    if _provider() == "anthropic":
        kwargs = dict(model=model, max_tokens=max_tokens, system=system_str, messages=messages)
        if tools:
            kwargs["tools"] = tools
            if tool_choice_name:
                kwargs["tool_choice"] = {"type": "tool", "name": tool_choice_name}
        resp = await _anthropic_client().messages.create(**kwargs)
        text, tool_input = "", None
        for block in resp.content or []:
            btype = getattr(block, "type", None)
            if btype == "text":
                text += block.text
            elif btype == "tool_use":
                tool_input = block.input
        return LLMResult(text=text.strip(), tool_input=tool_input)

    # DeepSeek / OpenAI-compatible
    oai_messages = [{"role": "system", "content": system_str}] + messages if system_str else list(messages)
    kwargs = dict(model=model, max_tokens=max_tokens, messages=oai_messages)
    if tools:
        kwargs["tools"] = [_to_openai_tool(t) for t in tools]
        if tool_choice_name:
            kwargs["tool_choice"] = {"type": "function", "function": {"name": tool_choice_name}}
    resp = await _openai_client().chat.completions.create(**kwargs)
    msg = resp.choices[0].message
    tool_input = None
    if getattr(msg, "tool_calls", None):
        try:
            tool_input = json.loads(msg.tool_calls[0].function.arguments or "{}")
        except (json.JSONDecodeError, TypeError):
            tool_input = None
    return LLMResult(text=(msg.content or "").strip(), tool_input=tool_input)


async def text(system, prompt: str, tier: str = FAST, max_tokens: int = 400) -> str:
    """Convenience: single user prompt in, text out."""
    result = await complete(system, [{"role": "user", "content": prompt}], tier, max_tokens)
    return result.text


async def stream_text(
    system,
    messages: list[dict],
    tier: str = DEEP,
    max_tokens: int = 1024,
) -> AsyncGenerator[str, None]:
    """Yield text deltas as they arrive."""
    system_str = _normalize_system(system)
    model = _model(tier)

    if _provider() == "anthropic":
        async with _anthropic_client().messages.stream(
            model=model, max_tokens=max_tokens, system=system_str, messages=messages,
        ) as stream:
            async for delta in stream.text_stream:
                yield delta
        return

    # DeepSeek / OpenAI-compatible
    oai_messages = [{"role": "system", "content": system_str}] + messages if system_str else list(messages)
    stream = await _openai_client().chat.completions.create(
        model=model, max_tokens=max_tokens, messages=oai_messages, stream=True,
    )
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta

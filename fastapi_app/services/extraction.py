"""Plain-text extraction for Project Space instruction items — URLs and
uploaded files (PDF/DOCX/Markdown/text). Mirrors echo-web-heart's
extract-instruction edge function: strip to plain text, cap at 80,000 chars.
"""
import io
import logging
import re

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

MAX_CHARS = 80_000


def _cap(text: str) -> str:
    text = text.strip()
    if len(text) > MAX_CHARS:
        return text[:MAX_CHARS] + "\n\n[…truncated]"
    return text


async def extract_from_url(url: str) -> str:
    async with httpx.AsyncClient(
        timeout=15.0,
        headers={"User-Agent": "Mozilla/5.0 (compatible; BamiHostCoachBot/1.0)"},
        follow_redirects=True,
    ) as client:
        resp = await client.get(url)
        resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return _cap(text)


def extract_from_file(data: bytes, file_name: str, mime: str | None) -> str:
    name = (file_name or "").lower()

    if name.endswith(".pdf") or mime == "application/pdf":
        import pdfplumber

        parts = []
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages[:50]:
                page_text = page.extract_text() or ""
                if page_text:
                    parts.append(page_text)
        return _cap("\n\n".join(parts))

    if name.endswith(".docx") or mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        import docx

        doc = docx.Document(io.BytesIO(data))
        return _cap("\n".join(p.text for p in doc.paragraphs))

    if name.endswith((".md", ".markdown", ".txt")) or (mime or "").startswith("text/"):
        return _cap(data.decode("utf-8", errors="replace"))

    raise ValueError("Unsupported file type — use PDF, DOCX, Markdown, or plain text")

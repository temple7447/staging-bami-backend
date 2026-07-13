"""A single searchable chunk of the owner's Google knowledge (Drive file or Gmail
message), with its embedding for semantic (RAG) retrieval.

Embeddings are stored as a JSON array of floats so this works on both Postgres
(production/Neon) and SQLite (local) without the pgvector extension. Similarity
is computed in-process (numpy cosine) at query time — fine for a single owner's
corpus; swap to pgvector later if the corpus grows very large.
"""
from sqlalchemy import String, DateTime, Text, JSON, Index
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from models.base import Base, gen_uuid
from utils.time_utils import utcnow


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)
    source: Mapped[str] = mapped_column(String(12))            # "drive" | "gmail"
    source_id: Mapped[str] = mapped_column(String(255), index=True)  # file id / message id
    chunk_index: Mapped[int] = mapped_column(default=0)        # nth chunk of the doc
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    text: Mapped[str] = mapped_column(Text, default="")
    embedding: Mapped[list] = mapped_column(JSON, default=list)   # list[float]
    meta: Mapped[dict] = mapped_column(JSON, default=dict)        # sender, date, mime, etc.
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# Fast "wipe this doc's old chunks before re-ingesting" and per-owner scans.
Index("ix_knowledge_owner_source", KnowledgeChunk.owner_id, KnowledgeChunk.source)
Index("ix_knowledge_owner_sourceid", KnowledgeChunk.owner_id, KnowledgeChunk.source_id)

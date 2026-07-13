"""Per-owner Google (Drive + Gmail) OAuth connection.

The owner clicks "Connect Google" once; we store their refresh token (encrypted
at rest via utils/crypto) so the backend can read their Drive and Gmail headlessly
to build the knowledge index. One connection per owner.
"""
from sqlalchemy import String, DateTime, Text, Integer
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from models.base import Base, gen_uuid
from utils.time_utils import utcnow


class GoogleConnection(Base):
    __tablename__ = "google_connections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    google_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Encrypted (Fernet) refresh token — never stored in plaintext.
    refresh_token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    scopes: Mapped[str | None] = mapped_column(Text, nullable=True)  # space-separated
    status: Mapped[str] = mapped_column(String(20), default="connected")  # connected | revoked | error
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Sync bookkeeping
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_sync_status: Mapped[str | None] = mapped_column(String(20), nullable=True)  # running | done | error
    drive_synced: Mapped[int] = mapped_column(Integer, default=0)
    gmail_synced: Mapped[int] = mapped_column(Integer, default=0)
    connected_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

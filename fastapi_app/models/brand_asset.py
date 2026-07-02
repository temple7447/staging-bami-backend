from sqlalchemy import String, Text, JSON, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, gen_uuid
from datetime import datetime
from utils.time_utils import utcnow


class BrandAsset(Base):
    __tablename__ = "brand_assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    owner_id: Mapped[str] = mapped_column(String(36), index=True)

    # Identity
    asset_type: Mapped[str] = mapped_column(String(50))  # logo, color, font, template, image, document
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Storage
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    public_id: Mapped[str | None] = mapped_column(String(255), nullable=True)  # Cloudinary ID
    file_type: Mapped[str | None] = mapped_column(String(50), nullable=True)   # png, svg, pdf …

    # Brand metadata (colors carry hex; fonts carry family+weight)
    extra_data: Mapped[dict] = mapped_column(JSON, default=dict)

    # Grouping
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)   # primary, secondary, social …
    tags: Mapped[list] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

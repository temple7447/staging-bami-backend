from beanie import Document
from pydantic import Field
from typing import Optional, Any
from datetime import datetime
from bson import ObjectId


class Setting(Document):
    """Stub — full fields to be added in the relevant phase."""
    data: Optional[Any] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "settings"

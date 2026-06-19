from beanie import Document
from pydantic import Field
from typing import Optional
from datetime import datetime
from bson import ObjectId


class Notification(Document):
    user:       Optional[ObjectId] = None
    title:      str = ""
    message:    str = ""
    type:       Optional[str] = None  # payment | issue | system | etc.
    link:       Optional[str] = None
    is_read:    bool = False
    read_at:    Optional[datetime] = None
    is_active:  bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "notifications"
        indexes = [
            [("user", 1), ("is_active", 1), ("is_read", 1)],
            [("created_at", -1)],
        ]

from beanie import Document
from pydantic import Field
from typing import Optional
from datetime import datetime
from bson import ObjectId


class ServiceRequest(Document):
    title:       str = ""
    description: str = ""
    category:    str = "general"
    priority:    str = "medium"
    status:      str = "pending"  # pending | assigned | in_progress | completed | cancelled
    requester:   Optional[ObjectId] = None
    assigned_to: Optional[ObjectId] = None
    estate:      Optional[ObjectId] = None
    unit:        Optional[ObjectId] = None
    tenant:      Optional[ObjectId] = None
    note:        Optional[str] = None
    updated_by:  Optional[ObjectId] = None
    is_active:   bool = True
    created_at:  datetime = Field(default_factory=datetime.utcnow)
    updated_at:  datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "service-requests"
        indexes = [
            [("requester", 1), ("is_active", 1)],
            [("assigned_to", 1), ("status", 1)],
            [("estate", 1)],
        ]

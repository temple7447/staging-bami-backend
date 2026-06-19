from beanie import Document
from pydantic import Field
from typing import Optional
from datetime import datetime
from bson import ObjectId


class Enquiry(Document):
    name:         str = ""
    email:        str = ""
    phone:        Optional[str] = None
    subject:      Optional[str] = None
    message:      str = ""
    enquiry_type: str = "general"
    status:       str = "pending"  # pending | in_review | responded | closed
    estate:       Optional[ObjectId] = None
    unit:         Optional[ObjectId] = None
    note:         Optional[str] = None
    updated_by:   Optional[ObjectId] = None
    is_active:    bool = True
    created_at:   datetime = Field(default_factory=datetime.utcnow)
    updated_at:   datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "enquiries"
        indexes = [
            [("email", 1)],
            [("status", 1), ("created_at", -1)],
            [("estate", 1)],
        ]

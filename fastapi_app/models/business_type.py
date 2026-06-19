from beanie import Document
from pydantic import Field
from typing import Optional
from datetime import datetime
from bson import ObjectId


class BusinessType(Document):
    name:        str = ""
    description: Optional[str] = None
    icon:        Optional[str] = None
    is_active:   bool = True
    created_by:  Optional[ObjectId] = None
    created_at:  datetime = Field(default_factory=datetime.utcnow)
    updated_at:  datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "business-types"

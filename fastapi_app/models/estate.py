from beanie import Document
from pydantic import Field
from typing import Optional, List
from datetime import datetime
from bson import ObjectId


class Estate(Document):
    name:        str
    address:     Optional[str] = None
    description: Optional[str] = None
    owner:       Optional[ObjectId] = None
    managers:    List[ObjectId] = Field(default_factory=list)
    is_active:   bool = True
    created_by:  Optional[ObjectId] = None
    created_at:  datetime = Field(default_factory=datetime.utcnow)
    updated_at:  datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "estates"

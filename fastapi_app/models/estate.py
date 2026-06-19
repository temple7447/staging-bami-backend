from beanie import Document, before_event, Insert, Replace, SaveChanges
from pydantic import Field
from typing import Optional, List
from datetime import datetime
from bson import ObjectId
import re


class EstateImage(Document):
    url:       str
    public_id: Optional[str] = None
    caption:   Optional[str] = None

    class Settings:
        name = "estate_images"


class Estate(Document):
    name:        str
    slug:        Optional[str] = None
    description: Optional[str] = None
    total_units: int = 0
    owner:       Optional[ObjectId] = None
    managers:    List[ObjectId] = Field(default_factory=list)
    images:      List[dict]     = Field(default_factory=list)   # [{url, public_id, caption}]
    is_active:   bool = True
    created_by:  Optional[ObjectId] = None
    updated_by:  Optional[ObjectId] = None
    created_at:  datetime = Field(default_factory=datetime.utcnow)
    updated_at:  datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "estates"
        indexes = [
            [("is_active", 1), ("created_at", -1)],
            [("owner", 1),     ("is_active", 1)],
            [("managers", 1),  ("is_active", 1)],
        ]

    def set_slug(self):
        slug = self.name.lower()
        slug = re.sub(r'[^a-z0-9]+', '-', slug)
        slug = slug.strip('-')
        self.slug = slug

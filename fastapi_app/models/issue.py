from beanie import Document
from pydantic import Field
from typing import Optional, List
from datetime import datetime
from bson import ObjectId


class Issue(Document):
    title:       str = ""
    description: str = ""
    category:    str = "other"
    priority:    str = "medium"  # low | medium | high | urgent
    status:      str = "open"    # open | in_progress | resolved | cancelled
    stage:       str = "review"  # review | started | inprogress | completed
    reporter:    Optional[ObjectId] = None
    assigned_to: Optional[ObjectId] = None
    estate:      Optional[ObjectId] = None
    unit:        Optional[ObjectId] = None
    tenant:      Optional[ObjectId] = None
    media:       List[dict] = Field(default_factory=list)
    timeline:    List[dict] = Field(default_factory=list)
    is_active:   bool = True
    created_at:  datetime = Field(default_factory=datetime.utcnow)
    updated_at:  datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "issues"
        indexes = [
            [("reporter", 1), ("is_active", 1)],
            [("estate", 1), ("status", 1)],
            [("assigned_to", 1)],
        ]

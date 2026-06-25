from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List


# ── Signal missions ─────────────────────────────────────────────────────────────

class MissionCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    title:        str           = Field(...)
    deadline:     Optional[str] = None
    mission_date: Optional[str] = Field(None, alias="missionDate")   # "YYYY-MM-DD"


class MissionUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    title:     Optional[str]  = None
    deadline:  Optional[str]  = None
    completed: Optional[bool] = None


# ── Time-audit blocks ───────────────────────────────────────────────────────────

class TimeBlockCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    block_date: Optional[str] = Field(None, alias="blockDate")       # "YYYY-MM-DD"
    time_label: str           = Field(..., alias="timeLabel")        # "4:00 AM"
    activity:   str
    block_type: str           = Field("neutral", alias="blockType")  # signal|noise|reminder|neutral
    note:       Optional[str] = None


class TimeBlockUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    time_label: Optional[str] = Field(None, alias="timeLabel")
    activity:   Optional[str] = None
    block_type: Optional[str] = Field(None, alias="blockType")
    note:       Optional[str] = None


class SeedRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    block_date: Optional[str] = Field(None, alias="blockDate")


# ── King's audit (80/20 worksheet) ──────────────────────────────────────────────

class KingsAuditCreate(BaseModel):
    bucket: str            # 'low' | 'high'
    text:   str


# ── Time-value profile ──────────────────────────────────────────────────────────

class TimeValueUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    weekly_hours:  Optional[float]      = Field(None, alias="weeklyHours")
    weekly_income: Optional[float]      = Field(None, alias="weeklyIncome")
    delegate:      Optional[List[str]]  = None
    outsource:     Optional[List[str]]  = None
    automate:      Optional[List[str]]  = None
    delete:        Optional[List[str]]  = None

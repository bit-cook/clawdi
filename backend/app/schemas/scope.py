import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ScopeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ScopeOut(BaseModel):
    id: uuid.UUID
    name: str
    owner_user_id: uuid.UUID
    visibility: Literal["private", "shared"]
    created_at: datetime
    role: Literal["owner", "writer", "reader"] | None = None
    is_personal: bool = False


class ScopeUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ScopeMemberOut(BaseModel):
    user_id: uuid.UUID
    role: Literal["owner", "writer", "reader"]
    added_at: datetime


class ScopeMemberAdd(BaseModel):
    user_id: uuid.UUID
    role: Literal["writer", "reader"] = "writer"

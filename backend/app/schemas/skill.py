from pydantic import BaseModel


class SkillCreate(BaseModel):
    skill_key: str
    name: str
    content: str
    agent_types: list[str] | None = None


class SkillBatchRequest(BaseModel):
    skills: list[SkillCreate]

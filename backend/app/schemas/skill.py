from pydantic import BaseModel


class SkillInstallRequest(BaseModel):
    repo: str          # owner/repo
    path: str | None = None  # subdirectory within repo
    scope_id: str | None = None  # attach installed skill to a Scope (optional)

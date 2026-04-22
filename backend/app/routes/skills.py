import hashlib
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, get_auth
from app.core.config import settings
from app.core.database import get_session
from app.models.scope import ScopeMembership
from app.models.skill import Skill
from app.models.skill_scope import SkillScope
from app.schemas.skill import SkillInstallRequest
from app.services.file_store import LocalFileStore
from app.services.permissions import (
    can_edit_shared_object,
    can_view_shared_object,
    can_write_scope,
    scopes_of_skill,
)
from app.services.tar_utils import (
    TarValidationError,
    extract_skill_md,
    parse_frontmatter,
    tar_from_content,
    validate_tar,
)

router = APIRouter(prefix="/api/skills", tags=["skills"])

file_store = LocalFileStore(settings.file_store_local_path)


def _content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _file_key(user_id, skill_key: str) -> str:
    return f"skills/{user_id}/{skill_key}.tar.gz"


async def _resolve_target_scope(
    db: AsyncSession,
    scope_id_str: str | None,
    user_id: uuid.UUID,
    fallback_default: uuid.UUID | None = None,
) -> uuid.UUID | None:
    """Resolve a client-supplied scope_id to a UUID (validated as writer+), or
    None for explicit private / unresolvable default.
    """
    if scope_id_str is None:
        sid = fallback_default
        if sid is None:
            return None
    elif scope_id_str in ("", "private", "none"):
        return None
    else:
        try:
            sid = uuid.UUID(scope_id_str)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid scope_id")

    if not await can_write_scope(db, user_id, sid):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You need writer or owner role on this scope",
        )
    return sid


async def _bulk_scope_ids_for_skills(
    db: AsyncSession, skill_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    if not skill_ids:
        return {}
    result = await db.execute(
        select(SkillScope).where(SkillScope.skill_id.in_(skill_ids))
    )
    out: dict[uuid.UUID, list[uuid.UUID]] = {sid: [] for sid in skill_ids}
    for row in result.scalars().all():
        out.setdefault(row.skill_id, []).append(row.scope_id)
    return out


# ---------------------------------------------------------------------------
# List / Get
# ---------------------------------------------------------------------------


@router.get("")
async def list_skills(
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
    include_content: bool = Query(default=False),
):
    """Skills the caller can see: own private + scopes they're member of.
    Further narrowed by env subscriptions if the env header is present.
    """
    member_scope_ids_result = await db.execute(
        select(ScopeMembership.scope_id).where(ScopeMembership.user_id == auth.user_id)
    )
    member_scope_ids = [r[0] for r in member_scope_ids_result.all()]

    # 1. Scoped skills visible via membership
    scoped_ids_result = await db.execute(
        select(SkillScope.skill_id)
        .where(SkillScope.scope_id.in_(member_scope_ids))
        .distinct()
    )
    scoped_ids = {r[0] for r in scoped_ids_result.all()}

    # 2. Private skills (no SkillScope rows) created by caller
    private_ids_result = await db.execute(
        select(Skill.id).where(
            Skill.user_id == auth.user_id,
            ~exists().where(SkillScope.skill_id == Skill.id),
        )
    )
    private_ids = {r[0] for r in private_ids_result.all()}

    visible_ids = scoped_ids | private_ids
    if not visible_ids:
        return []

    query = select(Skill).where(
        Skill.id.in_(visible_ids),
        Skill.is_active == True,
    )

    # Optional env-bound filter (narrow scoped skills to env subscriptions)
    if auth.environment_id:
        if auth.subscribed_scope_ids:
            subscribed = set(auth.subscribed_scope_ids)
            env_scoped_ids_result = await db.execute(
                select(SkillScope.skill_id)
                .where(SkillScope.scope_id.in_(subscribed))
                .distinct()
            )
            env_scoped_ids = {r[0] for r in env_scoped_ids_result.all()}
            allowed = env_scoped_ids | private_ids
        else:
            allowed = private_ids
        query = query.where(Skill.id.in_(allowed))

    query = query.order_by(Skill.skill_key)
    result = await db.execute(query)
    skills = list(result.scalars().all())

    scope_map = await _bulk_scope_ids_for_skills(db, [s.id for s in skills])

    items = []
    for s in skills:
        scope_ids = [str(x) for x in scope_map.get(s.id, [])]
        item = {
            "id": str(s.id),
            "skill_key": s.skill_key,
            "creator_user_id": str(s.user_id),
            "name": s.name,
            "description": s.description,
            "version": s.version,
            "source": s.source,
            "source_repo": s.source_repo,
            "agent_types": s.agent_types,
            "file_count": s.file_count,
            "content_hash": s.content_hash,
            "is_active": s.is_active,
            "scope_ids": scope_ids,
            "created_at": s.created_at.isoformat(),
            "updated_at": s.updated_at.isoformat(),
        }
        if include_content and s.file_key:
            try:
                tar_bytes = await file_store.get(s.file_key)
                item["content"] = extract_skill_md(tar_bytes)
            except Exception:
                item["content"] = None
        items.append(item)

    return items


async def _load_visible_skill(
    db: AsyncSession, skill_key: str, auth: AuthContext
) -> Skill:
    """Resolve a skill_key the caller can see. Same-key from another creator
    requires creator_user_id param on the request (Phase 2). For now, keyed
    on (caller is creator) OR (caller can see via scope membership)."""
    # First try creator-owned
    result = await db.execute(
        select(Skill).where(
            Skill.user_id == auth.user_id,
            Skill.skill_key == skill_key,
            Skill.is_active == True,
        )
    )
    skill = result.scalar_one_or_none()
    if skill:
        return skill

    # Fall back: any skill with this key the caller can see via scope membership
    result = await db.execute(
        select(Skill)
        .join(SkillScope, SkillScope.skill_id == Skill.id)
        .join(ScopeMembership, ScopeMembership.scope_id == SkillScope.scope_id)
        .where(
            Skill.skill_key == skill_key,
            Skill.is_active == True,
            ScopeMembership.user_id == auth.user_id,
        )
        .limit(1)
    )
    skill = result.scalar_one_or_none()
    if not skill:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Skill not found")
    return skill


@router.get("/{skill_key}")
async def get_skill(
    skill_key: str,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    skill = await _load_visible_skill(db, skill_key, auth)

    content = None
    if skill.file_key:
        try:
            tar_bytes = await file_store.get(skill.file_key)
            content = extract_skill_md(tar_bytes)
        except Exception:
            pass

    scope_ids = await scopes_of_skill(db, skill.id)

    return {
        "id": str(skill.id),
        "skill_key": skill.skill_key,
        "creator_user_id": str(skill.user_id),
        "name": skill.name,
        "description": skill.description,
        "version": skill.version,
        "source": skill.source,
        "source_repo": skill.source_repo,
        "file_count": skill.file_count,
        "content": content,
        "agent_types": skill.agent_types,
        "scope_ids": [str(s) for s in scope_ids],
        "created_at": skill.created_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# Upload (tar.gz)
# ---------------------------------------------------------------------------


@router.post("/upload")
async def upload_skill(
    skill_key: str = Form(...),
    file: UploadFile = File(...),
    scope_id: str | None = Form(default=None),
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    """Upload a skill (single scope at upload time; manage additional scopes
    via PATCH /skills/{key}/scopes)."""
    scope_uuid = await _resolve_target_scope(
        db, scope_id, auth.user_id, fallback_default=auth.default_write_scope_id
    )

    data = await file.read()

    try:
        file_count = validate_tar(data)
    except TarValidationError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    skill_md = extract_skill_md(data)
    if not skill_md:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Archive must contain a SKILL.md")

    fm = parse_frontmatter(skill_md)
    name = fm.get("name", skill_key)
    description = fm.get("description", "")

    content_hash = _content_hash(data)
    fk = _file_key(auth.user_id, skill_key)
    await file_store.put(fk, data)

    skill = await _upsert_skill(
        db,
        user_id=auth.user_id,
        skill_key=skill_key,
        name=name,
        description=description,
        content_hash=content_hash,
        file_key=fk,
        file_count=file_count,
        source="local",
        source_repo=None,
    )
    # Attach to scope_uuid on initial upload (if any). Subsequent uploads of
    # the same skill preserve existing scope associations unless caller uses
    # the manage endpoints.
    if scope_uuid:
        await _ensure_scope_association(db, skill.id, scope_uuid)

    scope_ids = await scopes_of_skill(db, skill.id)

    return {
        "skill_key": skill.skill_key,
        "name": skill.name,
        "version": skill.version,
        "file_count": file_count,
        "scope_ids": [str(s) for s in scope_ids],
    }


# ---------------------------------------------------------------------------
# Download (tar.gz)
# ---------------------------------------------------------------------------


@router.get("/{skill_key}/download")
async def download_skill(
    skill_key: str,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    skill = await _load_visible_skill(db, skill_key, auth)
    if not skill.file_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Skill archive not found")

    try:
        data = await file_store.get(skill.file_key)
    except Exception:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Skill archive not found")

    if skill.file_key.endswith(".md"):
        content = data.decode("utf-8")
        data, _ = tar_from_content(skill_key, content)

    return Response(
        content=data,
        media_type="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="{skill_key}.tar.gz"'},
    )


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


@router.delete("/{skill_key}")
async def delete_skill(
    skill_key: str,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    skill = await _load_visible_skill(db, skill_key, auth)
    scope_ids = await scopes_of_skill(db, skill.id)
    can_edit = await can_edit_shared_object(db, auth.user_id, skill.user_id, scope_ids)
    if not can_edit:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You need writer/owner role in at least one of this skill's scopes to delete it",
        )
    skill.is_active = False
    await db.commit()
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Manage scopes
# ---------------------------------------------------------------------------


class ScopeListBody(BaseModel):
    scope_ids: list[str]


async def _ensure_scope_association(
    db: AsyncSession, skill_id: uuid.UUID, scope_id: uuid.UUID
) -> bool:
    """Idempotent add. Returns True if a row was created."""
    existing = await db.execute(
        select(SkillScope).where(
            SkillScope.skill_id == skill_id, SkillScope.scope_id == scope_id
        )
    )
    if existing.scalar_one_or_none():
        return False
    db.add(SkillScope(skill_id=skill_id, scope_id=scope_id))
    await db.commit()
    return True


@router.put("/{skill_key}/scopes")
async def replace_skill_scopes(
    skill_key: str,
    body: ScopeListBody,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    """Replace the full scope set for a skill.

    Permissions:
    - Caller must be able to edit the skill (writer+ in at least one existing scope,
      or creator if private)
    - Caller must be writer+ in EVERY scope being added
    - Caller must be writer+ in EVERY scope being removed
    """
    skill = await _load_visible_skill(db, skill_key, auth)
    current_ids = set(await scopes_of_skill(db, skill.id))

    can_edit = await can_edit_shared_object(db, auth.user_id, skill.user_id, list(current_ids))
    if not can_edit:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot edit this skill")

    new_ids: set[uuid.UUID] = set()
    for s in body.scope_ids:
        try:
            new_ids.add(uuid.UUID(s))
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid scope id: {s}")

    to_add = new_ids - current_ids
    to_remove = current_ids - new_ids

    for sid in to_add | to_remove:
        if not await can_write_scope(db, auth.user_id, sid):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"You need writer/owner on scope {sid} to change this assignment",
            )

    for sid in to_add:
        db.add(SkillScope(skill_id=skill.id, scope_id=sid))
    if to_remove:
        await db.execute(
            SkillScope.__table__.delete().where(
                SkillScope.skill_id == skill.id,
                SkillScope.scope_id.in_(to_remove),
            )
        )
    await db.commit()

    return {
        "skill_key": skill.skill_key,
        "scope_ids": [str(x) for x in new_ids],
        "added": [str(x) for x in to_add],
        "removed": [str(x) for x in to_remove],
    }


@router.post("/{skill_key}/scopes/{scope_id}", status_code=status.HTTP_201_CREATED)
async def add_skill_scope(
    skill_key: str,
    scope_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    skill = await _load_visible_skill(db, skill_key, auth)
    if not await can_write_scope(db, auth.user_id, scope_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Need writer/owner in target scope")
    # Caller should also have edit rights on the skill
    current_ids = await scopes_of_skill(db, skill.id)
    if not await can_edit_shared_object(db, auth.user_id, skill.user_id, current_ids):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot edit this skill")

    created = await _ensure_scope_association(db, skill.id, scope_id)
    return {"status": "added" if created else "already_attached"}


@router.delete(
    "/{skill_key}/scopes/{scope_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_skill_scope(
    skill_key: str,
    scope_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    skill = await _load_visible_skill(db, skill_key, auth)
    if not await can_write_scope(db, auth.user_id, scope_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Need writer/owner in the scope being removed"
        )
    await db.execute(
        SkillScope.__table__.delete().where(
            SkillScope.skill_id == skill.id,
            SkillScope.scope_id == scope_id,
        )
    )
    await db.commit()


# ---------------------------------------------------------------------------
# Install from GitHub
# ---------------------------------------------------------------------------


@router.post("/install")
async def install_skill(
    body: SkillInstallRequest,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    from app.services.skill_installer import fetch_skill_from_github

    scope_uuid = await _resolve_target_scope(
        db, body.scope_id, auth.user_id, fallback_default=auth.default_write_scope_id
    )

    try:
        fetched = await fetch_skill_from_github(body.repo, body.path)
    except ValueError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))

    content_hash = _content_hash(fetched.tar_bytes)
    skill_key = fetched.name.lower().replace(" ", "-")
    fk = _file_key(auth.user_id, skill_key)
    await file_store.put(fk, fetched.tar_bytes)

    skill = await _upsert_skill(
        db,
        user_id=auth.user_id,
        skill_key=skill_key,
        name=fetched.name,
        description=fetched.description,
        content_hash=content_hash,
        file_key=fk,
        file_count=fetched.file_count,
        source="marketplace",
        source_repo=body.repo,
    )
    if scope_uuid:
        await _ensure_scope_association(db, skill.id, scope_uuid)

    scope_ids = await scopes_of_skill(db, skill.id)
    return {
        "skill_key": skill_key,
        "name": fetched.name,
        "description": fetched.description,
        "version": skill.version,
        "file_count": fetched.file_count,
        "repo": body.repo,
        "scope_ids": [str(s) for s in scope_ids],
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _upsert_skill(
    db: AsyncSession,
    *,
    user_id,
    skill_key: str,
    name: str,
    description: str,
    content_hash: str,
    file_key: str,
    file_count: int,
    source: str,
    source_repo: str | None,
) -> Skill:
    result = await db.execute(
        select(Skill).where(Skill.user_id == user_id, Skill.skill_key == skill_key)
    )
    skill = result.scalar_one_or_none()

    if skill:
        skill.name = name
        skill.description = description
        skill.content_hash = content_hash
        skill.file_key = file_key
        skill.file_count = file_count
        skill.source = source
        if source_repo is not None:
            skill.source_repo = source_repo
        skill.is_active = True
        skill.version = skill.version + 1
    else:
        skill = Skill(
            user_id=user_id,
            skill_key=skill_key,
            name=name,
            description=description,
            content_hash=content_hash,
            file_key=file_key,
            file_count=file_count,
            source=source,
            source_repo=source_repo,
        )
        db.add(skill)

    await db.commit()
    await db.refresh(skill)
    return skill

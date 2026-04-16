"""Install skills from GitHub repositories (skills.sh format)."""

import re
from dataclasses import dataclass

import httpx


@dataclass
class SkillContent:
    name: str
    description: str
    content: str
    repo: str


def _parse_frontmatter(content: str) -> dict:
    """Extract YAML frontmatter from SKILL.md."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
    if not match:
        return {}

    fm = {}
    for line in match.group(1).splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            fm[key.strip()] = value.strip()
    return fm


async def fetch_skill_from_github(repo: str, path: str | None = None) -> SkillContent:
    """Fetch SKILL.md from a GitHub repo.

    Args:
        repo: owner/repo format (e.g. "anthropics/skills")
        path: optional subdirectory within the repo (e.g. "frontend-design")
    """
    # Build search paths in priority order
    search_paths: list[str] = []
    if path:
        search_paths.append(f"skills/{path}/SKILL.md")
        search_paths.append(f"{path}/SKILL.md")
        search_paths.append(f".claude/skills/{path}/SKILL.md")
        search_paths.append(f".agents/skills/{path}/SKILL.md")
    search_paths.append("SKILL.md")

    branches = ["main", "master"]

    async with httpx.AsyncClient(follow_redirects=True) as client:
        content = None
        for sp in search_paths:
            for branch in branches:
                # Use refs/heads/ prefix for reliable raw access
                url = f"https://raw.githubusercontent.com/{repo}/refs/heads/{branch}/{sp}"
                resp = await client.get(url)
                if resp.status_code == 200:
                    content = resp.text
                    break
            if content:
                break

        if not content:
            raise ValueError(f"No SKILL.md found in {repo}" + (f"/{path}" if path else ""))

    fm = _parse_frontmatter(content)
    name = fm.get("name", path or repo.split("/")[-1])
    description = fm.get("description", "")

    return SkillContent(
        name=name,
        description=description,
        content=content,
        repo=repo,
    )

"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Download,
  ExternalLink,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { FEATURED_SKILLS } from "@clawdi-cloud/shared/consts";
import { toast } from "sonner";
import { ManageScopesSheet } from "@/components/manage-scopes-sheet";
import { RowActions, DropdownMenuItem, DropdownMenuSeparator } from "@/components/row-actions";
import { ScopeChips } from "@/components/scope-chips";
import { ScopeFilterBar } from "@/components/scope-filter-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function SkillsPage() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [customRepo, setCustomRepo] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<string>("all"); // "all" | "private" | <scope_id>

  const { data: skills, isLoading } = useQuery({
    queryKey: ["skills"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any[]>("/api/skills", token);
    },
  });

  const { data: scopes } = useQuery({
    queryKey: ["scopes"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Array<{ id: string; name: string; is_personal: boolean; role: string | null }>>(
        "/api/scopes",
        token,
      );
    },
  });

  const scopeById = new Map((scopes ?? []).map((s) => [s.id, s.name]));
  const filteredSkills = (skills ?? []).filter((s) => {
    const sids: string[] = s.scope_ids ?? [];
    if (scopeFilter === "all") return true;
    if (scopeFilter === "private") return sids.length === 0;
    return sids.includes(scopeFilter);
  });

  const deleteSkill = useMutation({
    mutationFn: async (key: string) => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>(`/api/skills/${key}`, token, { method: "DELETE" });
    },
    onSuccess: (_, key) => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      toast.success(`Removed skill ${key}`);
    },
    onError: (e: ApiError) => toast.error("Delete failed", { description: e.detail }),
  });

  const [installScope, setInstallScope] = useState<string>("");

  const installSkill = async (repo: string, path?: string) => {
    const key = `${repo}/${path || ""}`;
    setInstalling(key);
    setInstallError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const result = await apiFetch<{ skill_key: string; scope_id?: string | null }>(
        "/api/skills/install",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            repo,
            path,
            scope_id: installScope === "__private"
              ? "private"
              : installScope || null,
          }),
        },
      );
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      const where = result.scope_id
        ? `Installed to ${scopeById.get(result.scope_id) ?? "scope"}`
        : "Installed (Private)";
      toast.success(`${result.skill_key}`, { description: where });
    } catch (e: any) {
      const detail = e instanceof ApiError ? e.detail : e.message;
      setInstallError(detail);
      toast.error("Install failed", { description: detail });
    } finally {
      setInstalling(null);
    }
  };

  const handleCustomInstall = async () => {
    if (!customRepo.trim()) return;
    const clean = customRepo
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\/$/, "");
    const parts = clean.split("/");
    if (parts.length < 2) return;
    const repo = `${parts[0]}/${parts[1]}`;
    const path = parts.length > 2 ? parts.slice(2).join("/") : undefined;
    await installSkill(repo, path);
    if (!installError) setCustomRepo("");
  };

  const installedKeys = new Set(skills?.map((s: any) => s.skill_key) ?? []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Skills</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Portable agent instructions synced across machines.
          </p>
        </div>
        {skills && (
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            {skills.length} skill{skills.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Scope filter */}
      {scopes && scopes.length > 0 && (
        <ScopeFilterBar
          scopes={scopes}
          value={scopeFilter}
          onChange={setScopeFilter}
        />
      )}

      {/* My Skills */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Installed
        </h2>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border bg-card p-4 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
        ) : filteredSkills.length ? (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {filteredSkills.map((s: any) => (
              <SkillRow
                key={s.id}
                skill={s}
                scopes={scopes ?? []}
                onDelete={() => {
                  if (confirm(`Delete skill "${s.skill_key}"?`)) {
                    deleteSkill.mutate(s.skill_key);
                  }
                }}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No skills installed yet. Install from below or run{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              clawdi skill install owner/repo
            </code>
          </div>
        )}
      </section>

      {/* Marketplace */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Marketplace
          </h2>
          <a
            href="https://skills.sh"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 transition-colors"
          >
            skills.sh <ExternalLink className="size-3" />
          </a>
        </div>

        {/* Custom install */}
        <div className="flex gap-2 mb-2 flex-wrap">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              value={customRepo}
              onChange={(e) => {
                setCustomRepo(e.target.value);
                setInstallError(null);
              }}
              placeholder="Install from GitHub: owner/repo/path..."
              className="w-full border border-input bg-background rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCustomInstall();
              }}
            />
          </div>
          <select
            value={installScope || "__personal"}
            onChange={(e) => setInstallScope(e.target.value === "__personal" ? "" : e.target.value)}
            className="border border-input bg-background rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            title="Install into scope"
          >
            {(scopes ?? [])
              .filter((s) => s.role !== "reader")
              .map((s) => (
                <option
                  key={s.id}
                  value={s.is_personal ? "__personal" : s.id}
                >
                  {s.name}{s.is_personal ? " (default)" : ""}
                </option>
              ))}
            <option value="__private">Private (only you)</option>
          </select>
          <button
            type="button"
            onClick={handleCustomInstall}
            disabled={!customRepo.trim() || !!installing}
            className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {installing && customRepo ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Install
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mb-3">
          Installed skills land in the selected scope. Leave as default to save to Personal.
        </p>
        {installError && (
          <p className="text-xs text-destructive mb-3">{installError}</p>
        )}

        {/* Featured skills */}
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {FEATURED_SKILLS.map((skill) => {
            const key = `${skill.repo}/${skill.path || ""}`;
            const skillKey = skill.name.toLowerCase().replace(/\s+/g, "-");
            const isInstalled = installedKeys.has(skillKey);
            const isInstalling = installing === key;
            return (
              <div
                key={key}
                className="flex items-start justify-between rounded-lg border bg-card p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-3.5 text-primary shrink-0" />
                    <span className="font-medium text-sm">{skill.name}</span>
                    <span className="text-[10px] rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">
                      {skill.installs}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {skill.description}
                  </p>
                  <div className="text-[10px] text-muted-foreground mt-1.5">
                    {skill.repo}
                    {skill.path ? `/${skill.path}` : ""}
                  </div>
                </div>
                {isInstalled ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400 px-2 py-1 shrink-0 ml-3">
                    <Check className="size-3" />
                    Installed
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => installSkill(skill.repo, skill.path)}
                    disabled={isInstalling}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border rounded-md hover:bg-muted transition-colors shrink-0 ml-3 disabled:opacity-50"
                  >
                    {isInstalling ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Download className="size-3" />
                    )}
                    Install
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SkillRow({
  skill,
  scopes,
  onDelete,
}: {
  skill: any;
  scopes: Array<{ id: string; name: string; is_personal: boolean; role: string | null }>;
  onDelete: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <div className="group flex items-start justify-between rounded-lg border bg-card p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="size-3.5 text-primary shrink-0" />
          <span className="font-medium text-sm">{skill.skill_key}</span>
          <span className="text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
            v{skill.version}
          </span>
          <ScopeChips scopeIds={skill.scope_ids ?? []} scopes={scopes} readonly />
          {skill.file_count && (
            <span className="text-[10px] text-muted-foreground">
              {skill.file_count} file{skill.file_count === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {skill.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {skill.description}
          </p>
        )}
        <div className="text-[10px] text-muted-foreground mt-1.5">
          {skill.source}
          {skill.source_repo && <span> · {skill.source_repo}</span>}
        </div>
      </div>
      <div className="shrink-0 ml-2">
        <RowActions alwaysVisible>
          <DropdownMenuItem onClick={() => setSheetOpen(true)}>
            Manage scopes…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} className="text-destructive">
            <Trash2 className="size-3.5" />
            Delete skill
          </DropdownMenuItem>
        </RowActions>
      </div>
      {sheetOpen && (
        <ManageScopesSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          currentScopeIds={skill.scope_ids ?? []}
          scopes={scopes}
          mutateEndpoint={`/api/skills/${skill.skill_key}/scopes`}
        />
      )}
    </div>
  );
}

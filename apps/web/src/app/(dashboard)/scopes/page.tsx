"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Loader2, Plus, Shield, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/utils";

interface Scope {
  id: string;
  name: string;
  owner_user_id: string;
  visibility: "private" | "shared";
  created_at: string;
  role: "owner" | "writer" | "reader" | null;
  is_personal: boolean;
}

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  writer: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  reader: "bg-slate-500/10 text-slate-700 dark:text-slate-400",
};

export default function ScopesPage() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const { data: scopes, isLoading } = useQuery({
    queryKey: ["scopes"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Scope[]>("/api/scopes", token);
    },
  });

  // Derive counts per scope from existing queries (no new API)
  const { data: skills } = useQuery({
    queryKey: ["skills"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Array<{ scope_ids: string[] }>>("/api/skills", token);
    },
  });
  const { data: memories } = useQuery({
    queryKey: ["memories-all"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Array<{ scope_ids: string[] }>>("/api/memories?limit=200", token);
    },
  });
  const { data: vaults } = useQuery({
    queryKey: ["vaults"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Array<{ scope_id: string | null }>>("/api/vault", token);
    },
  });
  const { data: envs } = useQuery({
    queryKey: ["environments"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Array<{ subscribed_scope_ids: string[] }>>("/api/environments", token);
    },
  });

  const countByMultiScope = (items?: Array<{ scope_ids: string[] }>) => {
    const m = new Map<string, number>();
    for (const it of items ?? []) {
      for (const sid of it.scope_ids ?? []) {
        m.set(sid, (m.get(sid) ?? 0) + 1);
      }
    }
    return m;
  };
  const countBySingleScope = (items?: Array<{ scope_id: string | null }>) => {
    const m = new Map<string, number>();
    for (const it of items ?? []) {
      if (!it.scope_id) continue;
      m.set(it.scope_id, (m.get(it.scope_id) ?? 0) + 1);
    }
    return m;
  };
  const skillCount = countByMultiScope(skills);
  const memoryCount = countByMultiScope(memories);
  const vaultCount = countBySingleScope(vaults);
  const agentCount = new Map<string, number>();
  for (const e of envs ?? []) {
    for (const sid of e.subscribed_scope_ids) {
      agentCount.set(sid, (agentCount.get(sid) ?? 0) + 1);
    }
  }

  const createScope = useMutation({
    mutationFn: async (name: string) => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Scope>("/api/scopes", token, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
    },
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ["scopes"] });
      setCreating(false);
      setNewName("");
      toast.success(`Scope "${s.name}" created`);
    },
    onError: (e: ApiError) =>
      toast.error("Failed to create scope", { description: e.detail }),
  });

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FolderKanban className="size-6" />
            Scopes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Resource containers you can share with other users. Agents subscribe to scopes to see the skills, memories, and vaults inside.
          </p>
        </div>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium"
          >
            <Plus className="size-4" />
            New Scope
          </button>
        )}
      </div>

      {creating && (
        <div className="mb-6 p-4 border rounded-lg bg-card">
          <h3 className="text-sm font-medium mb-3">Create new Scope</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. work, personal, project-x"
              autoFocus
              className="flex-1 px-3 py-2 border rounded-md bg-background text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) createScope.mutate(newName.trim());
                if (e.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                }
              }}
            />
            <button
              type="button"
              disabled={!newName.trim() || createScope.isPending}
              onClick={() => createScope.mutate(newName.trim())}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium disabled:opacity-50"
            >
              {createScope.isPending ? <Loader2 className="size-4 animate-spin" /> : "Create"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
              className="px-4 py-2 rounded-md border text-sm hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !scopes || scopes.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FolderKanban className="size-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No scopes yet. Create one to start organizing resources.</p>
        </div>
      ) : (
        <div className="border rounded-lg bg-card divide-y">
          {scopes.map((s) => {
            const itemCount =
              (skillCount.get(s.id) ?? 0) +
              (memoryCount.get(s.id) ?? 0) +
              (vaultCount.get(s.id) ?? 0);
            const agentsIn = agentCount.get(s.id) ?? 0;
            return (
              <Link
                key={s.id}
                href={`/scopes/${s.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {s.is_personal ? (
                    <Star className="size-4 text-primary fill-primary shrink-0" />
                  ) : (
                    <Shield className="size-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{s.name}</span>
                      {s.is_personal && (
                        <span className="text-[10px] rounded bg-primary/10 text-primary px-1.5 py-0.5 font-medium">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {itemCount} item{itemCount === 1 ? "" : "s"} · {agentsIn} agent
                      {agentsIn === 1 ? "" : "s"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {s.role && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-medium ${ROLE_COLORS[s.role] ?? ""}`}
                    >
                      {s.role}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {relativeTime(s.created_at)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

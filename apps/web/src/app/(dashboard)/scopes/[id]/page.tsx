"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Brain,
  Check,
  Cpu,
  Key,
  Loader2,
  Pencil,
  Share2,
  Shield,
  Sparkles,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShareScopeDialog } from "@/components/share-scope-dialog";
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

interface Member {
  user_id: string;
  role: "owner" | "writer" | "reader";
  added_at: string;
}

interface Skill {
  id: string;
  skill_key: string;
  name: string;
  version: number;
  scope_ids: string[];
}

interface Memory {
  id: string;
  content: string;
  category: string;
  scope_ids: string[];
  created_at: string;
}

interface Vault {
  id: string;
  slug: string;
  name: string;
  scope_id: string | null;
  created_at: string;
}

interface Env {
  id: string;
  machine_name: string;
  agent_type: string;
  os: string;
  subscribed_scope_ids: string[];
}

const AGENT_LABELS: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  hermes: "Hermes",
  openclaw: "OpenClaw",
};

export default function ScopeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const { data: scope, isLoading } = useQuery({
    queryKey: ["scope", id],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Scope>(`/api/scopes/${id}`, token);
    },
  });

  const { data: members } = useQuery({
    queryKey: ["scope", id, "members"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Member[]>(`/api/scopes/${id}/members`, token);
    },
  });

  const { data: skills } = useQuery({
    queryKey: ["skills"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Skill[]>("/api/skills", token);
    },
  });

  const { data: memories } = useQuery({
    queryKey: ["memories"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Memory[]>("/api/memories?limit=200", token);
    },
  });

  const { data: vaults } = useQuery({
    queryKey: ["vaults"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Vault[]>("/api/vault", token);
    },
  });

  const { data: envs } = useQuery({
    queryKey: ["environments"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Env[]>("/api/environments", token);
    },
  });

  const toggleAgent = useMutation({
    mutationFn: async ({ envId, included }: { envId: string; included: boolean }) => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>(
        `/api/environments/${envId}/scopes/${id}`,
        token,
        { method: included ? "DELETE" : "POST" },
      );
    },
    onSuccess: (_, { envId, included }) => {
      queryClient.invalidateQueries({ queryKey: ["environments"] });
      const env = envs?.find((e) => e.id === envId);
      const envLabel = env?.machine_name ?? "agent";
      toast.success(
        included ? `Removed ${envLabel} from ${scope?.name}` : `Added ${envLabel} to ${scope?.name}`,
      );
    },
    onError: (e: ApiError) => {
      if (e.status === 409) {
        toast.error("Can't remove from this scope", {
          description:
            "This is the agent's default write target. Change its default first on the Agents page.",
        });
      } else {
        toast.error("Failed to update", { description: e.detail });
      }
    },
  });

  const leaveScope = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>(`/api/scopes/${id}/leave`, token, { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scopes"] });
      toast.success(`You left "${scope?.name}"`);
      router.push("/scopes");
    },
    onError: (e: ApiError) =>
      toast.error("Couldn't leave", { description: e.detail }),
  });

  const deleteScope = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>(`/api/scopes/${id}`, token, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scopes"] });
      toast.success(`Scope "${scope?.name}" deleted`, {
        description: "Items it contained are now Private.",
      });
      router.push("/scopes");
    },
    onError: (e: ApiError) => toast.error("Can't delete scope", { description: e.detail }),
  });

  const renameScope = useMutation({
    mutationFn: async (name: string) => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Scope>(`/api/scopes/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["scopes"] });
      queryClient.invalidateQueries({ queryKey: ["scope", id] });
      toast.success(`Renamed to "${updated.name}"`, {
        description: scope?.is_personal
          ? "Note: CLI scripts that reference this scope by name need updating."
          : undefined,
      });
    },
    onError: (e: ApiError) => toast.error("Failed to rename", { description: e.detail }),
  });

  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [shareOpen, setShareOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Skeleton className="h-10 w-64 mb-4" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!scope) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Link href="/scopes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="size-4" />
          Back to scopes
        </Link>
        <p className="text-red-500">Scope not found or no access.</p>
      </div>
    );
  }

  const scopeSkills = skills?.filter((s) => (s.scope_ids ?? []).includes(id)) ?? [];
  const scopeMemories = memories?.filter((m) => (m.scope_ids ?? []).includes(id)) ?? [];
  const scopeVaults = vaults?.filter((v) => v.scope_id === id) ?? []; // vault stays single-scope

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <Link
        href="/scopes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="size-4" />
        Back to scopes
      </Link>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Shield className="size-6 shrink-0" />
            {editingName ? (
              <input
                type="text"
                value={newName}
                autoFocus
                onChange={(e) => setNewName(e.target.value)}
                onBlur={() => {
                  if (newName.trim() && newName.trim() !== scope.name) {
                    renameScope.mutate(newName.trim());
                  }
                  setEditingName(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (newName.trim() && newName.trim() !== scope.name) {
                      renameScope.mutate(newName.trim());
                    }
                    setEditingName(false);
                  }
                  if (e.key === "Escape") {
                    setEditingName(false);
                  }
                }}
                className="text-2xl font-semibold bg-background border rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <>
                <h1 className="text-2xl font-semibold">{scope.name}</h1>
                {scope.role === "owner" && (
                  <button
                    type="button"
                    title="Rename"
                    onClick={() => {
                      setNewName(scope.name);
                      setEditingName(true);
                    }}
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                )}
                {scope.is_personal && (
                  <span className="inline-flex items-center gap-1 text-[10px] rounded bg-primary/10 text-primary px-1.5 py-0.5 font-medium">
                    <Star className="size-3" />
                    Default
                  </span>
                )}
              </>
            )}
          </div>
          <div className="text-xs font-mono text-muted-foreground mt-1">{scope.id}</div>
          <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
            <span>Created {relativeTime(scope.created_at)}</span>
            {scope.role && (
              <span className="px-2 py-0.5 rounded bg-muted text-xs font-medium">
                your role: {scope.role}
              </span>
            )}
            {scope.is_personal && (
              <span className="text-xs italic">
                auto-created; new agents subscribe and write here by default
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium"
          >
            <Share2 className="size-4" />
            Share
          </button>
          {scope.role === "owner" && !scope.is_personal && (
            <button
              type="button"
              onClick={() => {
                const totalItems = scopeSkills.length + scopeMemories.length + scopeVaults.length;
                const msg = totalItems
                  ? `Delete scope "${scope.name}"?\n\n${totalItems} items will be removed from this scope (becoming Private if they're in no other scope):\n  • ${scopeSkills.length} skill(s)\n  • ${scopeMemories.length} memor(ies)\n  • ${scopeVaults.length} vault(s)`
                  : `Delete scope "${scope.name}"? (no items inside)`;
                if (confirm(msg)) deleteScope.mutate();
              }}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-red-600 hover:bg-red-500/10"
            >
              {deleteScope.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete scope
            </button>
          )}
          {scope.role && !scope.is_personal && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`Leave "${scope.name}"?\n\nYou'll lose access to items in this scope. Any of your agents subscribed to it will be unsubscribed.`)) {
                  leaveScope.mutate();
                }
              }}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-muted-foreground hover:bg-muted"
            >
              {leaveScope.isPending ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />}
              Leave scope
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Members summary (full management in Share dialog) */}
        <section className="border rounded-lg bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium flex items-center gap-2">
              <Users className="size-4" />
              Members ({members?.length ?? 0})
            </h2>
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="text-xs text-primary hover:underline"
            >
              Manage →
            </button>
          </div>
          <div className="space-y-1">
            {(members ?? []).slice(0, 5).map((m) => (
              <div key={m.user_id} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs">{m.user_id.slice(0, 8)}…</span>
                <span className="text-xs text-muted-foreground">{m.role}</span>
              </div>
            ))}
            {members && members.length > 5 && (
              <p className="text-xs text-muted-foreground pt-1">
                +{members.length - 5} more
              </p>
            )}
            {(!members || members.length === 0) && (
              <p className="text-xs text-muted-foreground">No members.</p>
            )}
          </div>
        </section>

        {/* Stats */}
        <section className="border rounded-lg bg-card p-4">
          <h2 className="text-sm font-medium mb-3">Contents</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-2xl font-semibold">{scopeSkills.length}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                <Sparkles className="size-3" />
                skills
              </div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{scopeMemories.length}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                <Brain className="size-3" />
                memories
              </div>
            </div>
            <div>
              <div className="text-2xl font-semibold">{scopeVaults.length}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                <Key className="size-3" />
                vaults
              </div>
            </div>
          </div>
        </section>

        {/* Agents — which envs include this scope */}
        <section className="border rounded-lg bg-card p-4 md:col-span-2">
          <h2 className="text-sm font-medium flex items-center gap-2 mb-3">
            <Cpu className="size-4" />
            Agents in this scope
            <span className="text-xs text-muted-foreground font-normal ml-1">
              (click to include / exclude)
            </span>
          </h2>
          {!envs || envs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No agents connected. Run <code className="text-xs bg-muted px-1 rounded">clawdi setup --agent &lt;type&gt;</code> first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {envs.map((e) => {
                const included = e.subscribed_scope_ids.includes(id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    disabled={toggleAgent.isPending}
                    onClick={() => toggleAgent.mutate({ envId: e.id, included })}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs transition-colors ${
                      included
                        ? "bg-primary/10 border-primary text-primary font-medium"
                        : "bg-background border-border hover:bg-accent"
                    }`}
                  >
                    {included && <Check className="size-3" />}
                    <span className="font-medium">
                      {AGENT_LABELS[e.agent_type] ?? e.agent_type}
                    </span>
                    <span className="text-muted-foreground">· {e.machine_name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Skills */}
        <section className="border rounded-lg bg-card p-4 md:col-span-2">
          <h2 className="text-sm font-medium flex items-center gap-2 mb-3">
            <Sparkles className="size-4" />
            Skills
            <span className="text-xs text-muted-foreground font-normal">
              ({scopeSkills.length})
            </span>
          </h2>
          {scopeSkills.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No skills in this scope yet. Upload one with{" "}
              <code className="bg-muted px-1 rounded">clawdi skill add ./path --scope {scope.name}</code>
              , or{" "}
              <Link href="/skills" className="underline">
                browse skills
              </Link>
              .
            </p>
          ) : (
            <div className="divide-y">
              {scopeSkills.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium">{s.skill_key}</span>
                  <span className="text-xs text-muted-foreground">v{s.version}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Memories */}
        <section className="border rounded-lg bg-card p-4 md:col-span-2">
          <h2 className="text-sm font-medium flex items-center gap-2 mb-3">
            <Brain className="size-4" />
            Memories
            <span className="text-xs text-muted-foreground font-normal">
              ({scopeMemories.length})
            </span>
          </h2>
          {scopeMemories.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No memories in this scope yet.
            </p>
          ) : (
            <div className="divide-y">
              {scopeMemories.slice(0, 20).map((m) => (
                <div key={m.id} className="py-2">
                  <div className="text-sm">{m.content}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {m.category} · {relativeTime(m.created_at)}
                  </div>
                </div>
              ))}
              {scopeMemories.length > 20 && (
                <Link
                  href={`/memories?scope=${id}`}
                  className="block py-2 text-xs text-primary hover:underline"
                >
                  View all {scopeMemories.length} memories →
                </Link>
              )}
            </div>
          )}
        </section>

        {/* Vaults */}
        <section className="border rounded-lg bg-card p-4 md:col-span-2">
          <h2 className="text-sm font-medium flex items-center gap-2 mb-3">
            <Key className="size-4" />
            Vaults
            <span className="text-xs text-muted-foreground font-normal">
              ({scopeVaults.length})
            </span>
          </h2>
          {scopeVaults.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No vaults in this scope yet.
            </p>
          ) : (
            <div className="divide-y">
              {scopeVaults.map((v) => (
                <div key={v.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium">{v.name}</span>
                  <span className="text-xs text-muted-foreground font-mono">{v.slug}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <ShareScopeDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        scopeId={id}
        scopeName={scope.name}
        callerIsOwner={scope.role === "owner"}
        callerUserId={scope.owner_user_id}
      />
    </div>
  );
}

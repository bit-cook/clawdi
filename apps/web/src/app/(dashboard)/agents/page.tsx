"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Cpu, Star, Trash2 } from "lucide-react";
import { RowActions, DropdownMenuItem } from "@/components/row-actions";
import Link from "next/link";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/utils";

interface Env {
  id: string;
  machine_name: string;
  agent_type: string;
  agent_version: string | null;
  os: string;
  last_seen_at: string | null;
  created_at: string;
  subscribed_scope_ids: string[];
  default_write_scope_id: string | null;
}

interface Scope {
  id: string;
  name: string;
  role: string | null;
  is_personal: boolean;
}

const AGENT_LABELS: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  hermes: "Hermes",
  openclaw: "OpenClaw",
};

const AGENT_COLORS: Record<string, string> = {
  claude_code: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  codex: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  hermes: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  openclaw: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

/** Is this env stale (not seen in 30+ days)? */
function isStale(env: Env): boolean {
  if (!env.last_seen_at) return true;
  const diff = Date.now() - new Date(env.last_seen_at).getTime();
  return diff > 30 * 24 * 60 * 60 * 1000;
}

export default function AgentsPage() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const { data: envs, isLoading } = useQuery({
    queryKey: ["environments"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Env[]>("/api/environments", token);
    },
  });

  const { data: scopes } = useQuery({
    queryKey: ["scopes"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Scope[]>("/api/scopes", token);
    },
  });

  const scopeById = new Map((scopes ?? []).map((s) => [s.id, s]));

  const setDefaultWrite = useMutation({
    mutationFn: async ({ envId, scopeValue }: { envId: string; scopeValue: string }) => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<{ default_write_scope_id: string | null; auto_subscribed: boolean }>(
        `/api/environments/${envId}/default-write-scope`,
        token,
        { method: "PATCH", body: JSON.stringify({ scope_id: scopeValue }) },
      );
    },
    onSuccess: (result, { scopeValue }) => {
      queryClient.invalidateQueries({ queryKey: ["environments"] });
      const label = result.default_write_scope_id
        ? scopeById.get(result.default_write_scope_id)?.name ?? "scope"
        : "Private";
      if (result.auto_subscribed) {
        const scopeName = scopeById.get(scopeValue)?.name ?? "scope";
        toast.success(`Default write → ${label}`, {
          description: `Also added this agent to ${scopeName} so it can read what it writes.`,
        });
      } else {
        toast.success(`Default write → ${label}`);
      }
    },
    onError: (e: ApiError) => toast.error("Failed to update default", { description: e.detail }),
  });

  const unregister = useMutation({
    mutationFn: async (envId: string) => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<void>(`/api/environments/${envId}`, token, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["environments"] });
      toast.success("Agent unregistered");
    },
    onError: (e: ApiError) => toast.error("Couldn't unregister", { description: e.detail }),
  });

  const toggleSub = useMutation({
    mutationFn: async ({
      envId,
      scopeId,
      included,
    }: { envId: string; scopeId: string; included: boolean }) => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>(
        `/api/environments/${envId}/scopes/${scopeId}`,
        token,
        { method: included ? "DELETE" : "POST" },
      );
    },
    onSuccess: (_, { scopeId, included }) => {
      queryClient.invalidateQueries({ queryKey: ["environments"] });
      const scopeName = scopeById.get(scopeId)?.name ?? "scope";
      toast.success(included ? `Removed from ${scopeName}` : `Added to ${scopeName}`);
    },
    onError: (e: ApiError) => toast.error("Can't update subscription", { description: e.detail }),
  });

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Cpu className="size-6" />
          Agents
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          All agent instances connected to your account. Configure where each
          agent saves new items by default, and which scopes it can see.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : !envs || envs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Cpu className="size-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            No agents connected yet. Run{" "}
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
              clawdi setup --agent &lt;type&gt;
            </code>{" "}
            in your terminal to connect one.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {envs.map((e) => {
            const stale = isStale(e);
            const subscribedSet = new Set(e.subscribed_scope_ids);
            return (
              <div key={e.id} className="border rounded-lg bg-card p-4">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-medium ${AGENT_COLORS[e.agent_type] ?? ""}`}
                      >
                        {AGENT_LABELS[e.agent_type] ?? e.agent_type}
                      </span>
                      <span className="text-sm font-medium">{e.machine_name}</span>
                      {e.agent_version && (
                        <span className="text-xs text-muted-foreground">{e.agent_version}</span>
                      )}
                      <span className="text-xs text-muted-foreground">· {e.os}</span>
                      {stale && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          Stale
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-1">
                      {e.id.slice(0, 8)}…
                    </div>
                  </div>
                  <div className="flex items-start gap-2 shrink-0">
                    <div className="text-right text-xs text-muted-foreground">
                      {e.last_seen_at ? `seen ${relativeTime(e.last_seen_at)}` : "never seen"}
                    </div>
                    <RowActions alwaysVisible>
                      <DropdownMenuItem
                        onClick={() => {
                          if (
                            confirm(
                              `Unregister "${e.machine_name}"?\n\nIt will disappear from the Agents list. The CLI on that machine will re-register on the next \`clawdi setup\`.`,
                            )
                          ) {
                            unregister.mutate(e.id);
                          }
                        }}
                        className="text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                        Unregister agent
                      </DropdownMenuItem>
                    </RowActions>
                  </div>
                </div>

                {/* Default write scope */}
                <div className="flex items-center gap-3 pb-4 mb-4 border-b">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">Default location for new items</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      If a command doesn't specify a scope, this agent saves here.
                    </div>
                  </div>
                  <select
                    value={e.default_write_scope_id ?? "private"}
                    disabled={setDefaultWrite.isPending}
                    onChange={(ev) =>
                      setDefaultWrite.mutate({ envId: e.id, scopeValue: ev.target.value })
                    }
                    className="border border-input bg-background rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[200px]"
                  >
                    <option value="private">Private (only you)</option>
                    {(scopes ?? [])
                      .filter((s) => s.role !== "reader")
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.is_personal ? " · Default" : ""}
                        </option>
                      ))}
                  </select>
                </div>

                {/* Subscribed scopes (toggleable) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium">In scopes</span>
                    <span className="text-xs text-muted-foreground">
                      click to add / remove
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(scopes ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground italic">
                        No scopes yet. Create one on the <Link href="/scopes" className="underline">Scopes</Link> page.
                      </span>
                    ) : (
                      (scopes ?? []).map((s) => {
                        const included = subscribedSet.has(s.id);
                        const isDefault = s.id === e.default_write_scope_id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            disabled={toggleSub.isPending}
                            onClick={() =>
                              toggleSub.mutate({
                                envId: e.id,
                                scopeId: s.id,
                                included,
                              })
                            }
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs transition-colors ${
                              included
                                ? "bg-primary/10 border-primary text-primary font-medium"
                                : "bg-background border-border hover:bg-accent"
                            }`}
                            title={
                              isDefault
                                ? "Default write target — change default before removing"
                                : undefined
                            }
                          >
                            {included && <Check className="size-3" />}
                            {s.name}
                            {isDefault && <Star className="size-2.5 fill-current" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-6">
        To connect a new agent, run{" "}
        <code className="text-xs bg-muted px-1 rounded">clawdi setup --agent &lt;type&gt;</code>.
        To remove an agent, unregister it from the CLI host or delete the record via backend (UI removal coming soon).
      </p>
    </div>
  );
}

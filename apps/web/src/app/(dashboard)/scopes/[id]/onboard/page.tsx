"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Cpu, Shield, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api";

interface Env {
  id: string;
  machine_name: string;
  agent_type: string;
  subscribed_scope_ids: string[];
}

interface Scope {
  id: string;
  name: string;
  is_personal: boolean;
  role: string | null;
}

const AGENT_LABELS: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  hermes: "Hermes",
  openclaw: "OpenClaw",
};

export default function ScopeOnboardPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: scope } = useQuery({
    queryKey: ["scope", id],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Scope>(`/api/scopes/${id}`, token);
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

  // Preview content of the scope so user knows what they're about to gain
  const { data: skills } = useQuery({
    queryKey: ["scope-skills-preview", id],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Array<{ skill_key: string; scope_ids: string[] }>>(
        "/api/skills",
        token,
      );
    },
  });
  const { data: memories } = useQuery({
    queryKey: ["scope-memories-preview", id],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Array<{ content: string; scope_ids: string[] }>>(
        "/api/memories?limit=100",
        token,
      );
    },
  });

  const scopeSkills = (skills ?? []).filter((s) => s.scope_ids.includes(id));
  const scopeMemories = (memories ?? []).filter((m) => m.scope_ids.includes(id));

  const subscribeEnvs = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const results = await Promise.allSettled(
        Array.from(selected).map((envId) =>
          apiFetch<any>(`/api/environments/${envId}/scopes/${id}`, token, {
            method: "POST",
          }),
        ),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const fail = results.length - ok;
      return { ok, fail };
    },
    onSuccess: ({ ok, fail }) => {
      queryClient.invalidateQueries({ queryKey: ["environments"] });
      if (fail > 0) {
        toast.warning(`Subscribed ${ok} agent(s); ${fail} failed`);
      } else if (ok > 0) {
        toast.success(`Subscribed ${ok} agent(s) to ${scope?.name}`);
      }
      router.push(`/scopes/${id}`);
    },
    onError: (e: ApiError) =>
      toast.error("Couldn't update subscriptions", { description: e.detail }),
  });

  const toggle = (envId: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(envId)) next.delete(envId);
      else next.add(envId);
      return next;
    });
  };

  if (!scope) return null;

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
      <div className="text-center">
        <div className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 mb-3">
          <Shield className="size-6 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold">
          Welcome to <span className="text-primary">{scope.name}</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Which of your agents should see items in this scope?
        </p>
      </div>

      {/* Preview of contents — for trust/safety */}
      <div className="border rounded-lg bg-card p-4">
        <div className="text-xs font-medium text-muted-foreground mb-2">
          This scope contains
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Sparkles className="size-3.5" />
              <span className="font-medium">{scopeSkills.length}</span>
              <span className="text-muted-foreground">
                skill{scopeSkills.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              {scopeSkills.slice(0, 3).map((s) => (
                <div key={s.skill_key}>· {s.skill_key}</div>
              ))}
              {scopeSkills.length > 3 && <div>… +{scopeSkills.length - 3} more</div>}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="font-medium">{scopeMemories.length}</span>
              <span className="text-muted-foreground">
                memor{scopeMemories.length === 1 ? "y" : "ies"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              {scopeMemories.slice(0, 2).map((m, i) => (
                <div key={i} className="truncate">
                  · {m.content.slice(0, 40)}…
                </div>
              ))}
              {scopeMemories.length > 2 && (
                <div>… +{scopeMemories.length - 2} more</div>
              )}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t">
          ⚠ Subscribed agents gain access to these items and any new items the
          scope's owners or writers add later. Only subscribe agents you want
          exposed to this content.
        </p>
      </div>

      {/* Agents selector */}
      <div className="border rounded-lg bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Cpu className="size-4" />
          <h2 className="text-sm font-medium">Your agents</h2>
        </div>
        {(envs ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No agents connected yet. Run{" "}
            <code className="bg-muted px-1 rounded">clawdi setup --agent &lt;type&gt;</code>{" "}
            then come back here.
          </p>
        ) : (
          <div className="space-y-1.5">
            {(envs ?? []).map((e) => {
              const already = e.subscribed_scope_ids.includes(id);
              const on = selected.has(e.id) || already;
              return (
                <button
                  key={e.id}
                  type="button"
                  disabled={already}
                  onClick={() => !already && toggle(e.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md border transition-colors text-left ${
                    on
                      ? "bg-primary/10 border-primary"
                      : "bg-background border-border hover:bg-accent"
                  } ${already ? "opacity-60 cursor-default" : ""}`}
                >
                  <div
                    className={`flex size-4 items-center justify-center rounded border ${
                      on ? "bg-primary border-primary" : "border-border"
                    }`}
                  >
                    {on && <Check className="size-3 text-primary-foreground" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{e.machine_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {AGENT_LABELS[e.agent_type] ?? e.agent_type}
                    </div>
                  </div>
                  {already && (
                    <span className="text-[10px] text-muted-foreground">
                      already in
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <Link
          href={`/scopes/${id}`}
          className="px-4 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent"
        >
          Skip — I'll decide later
        </Link>
        <button
          type="button"
          disabled={selected.size === 0 || subscribeEnvs.isPending}
          onClick={() => subscribeEnvs.mutate()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium disabled:opacity-50"
        >
          Subscribe {selected.size} agent{selected.size === 1 ? "" : "s"}
          <ArrowRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

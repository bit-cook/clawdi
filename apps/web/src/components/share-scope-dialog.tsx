"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Check,
  Copy,
  Link as LinkIcon,
  Loader2,
  Mail,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Member {
  user_id: string;
  role: "owner" | "writer" | "reader";
  added_at: string;
  email?: string | null;
}

interface Invitation {
  id: string;
  scope_id: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  invitee_email: string | null;
  created_at: string;
}

export function ShareScopeDialog({
  open,
  onClose,
  scopeId,
  scopeName,
  callerIsOwner,
  callerUserId,
}: {
  open: boolean;
  onClose: () => void;
  scopeId: string;
  scopeName: string;
  callerIsOwner: boolean;
  callerUserId: string;
}) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [emailInput, setEmailInput] = useState("");
  const [role, setRole] = useState<"writer" | "reader">("writer");
  const [generated, setGenerated] = useState<{
    url: string;
    email: string | null;
  } | null>(null);
  const [linkFormat, setLinkFormat] = useState<"url" | "agent">("url");

  const { data: members } = useQuery({
    queryKey: ["scope", scopeId, "members"],
    queryFn: async () => {
      const t = await getToken();
      if (!t) throw new Error("Not authenticated");
      return apiFetch<Member[]>(`/api/scopes/${scopeId}/members`, t);
    },
    enabled: open,
  });

  const { data: invitations } = useQuery({
    queryKey: ["scope-invitations", scopeId],
    queryFn: async () => {
      const t = await getToken();
      if (!t) throw new Error("Not authenticated");
      return apiFetch<Invitation[]>(`/api/scopes/${scopeId}/invitations`, t);
    },
    enabled: open,
  });

  const createInvite = useMutation({
    mutationFn: async (args: { invitee_email?: string }) => {
      const t = await getToken();
      if (!t) throw new Error("Not authenticated");
      return apiFetch<{ token: string; role: string; expires_at: string; invitee_email: string | null }>(
        `/api/scopes/${scopeId}/invitations`,
        t,
        {
          method: "POST",
          body: JSON.stringify({ role, invitee_email: args.invitee_email }),
        },
      );
    },
    onSuccess: (data) => {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setGenerated({
        url: `${origin}/join/${data.token}`,
        email: data.invitee_email,
      });
      queryClient.invalidateQueries({ queryKey: ["scope-invitations", scopeId] });
    },
    onError: (e: ApiError) =>
      toast.error("Couldn't create invitation", { description: e.detail }),
  });

  const addByEmail = useMutation({
    mutationFn: async (email: string) => {
      const t = await getToken();
      if (!t) throw new Error("Not authenticated");
      try {
        const user = await apiFetch<{ id: string; email: string }>(
          `/api/auth/users/search?email=${encodeURIComponent(email)}`,
          t,
        );
        await apiFetch(`/api/scopes/${scopeId}/members`, t, {
          method: "POST",
          body: JSON.stringify({ user_id: user.id, role }),
        });
        return { kind: "added" as const, email: user.email };
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          return { kind: "invited" as const, email };
        }
        throw e;
      }
    },
    onSuccess: (result) => {
      if (result.kind === "added") {
        queryClient.invalidateQueries({ queryKey: ["scope", scopeId, "members"] });
        toast.success(`Added ${result.email} to ${scopeName}`);
        setEmailInput("");
      } else {
        createInvite.mutate({ invitee_email: result.email });
        setEmailInput("");
      }
    },
    onError: (e: ApiError) =>
      toast.error("Couldn't add user", { description: e.detail }),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      const t = await getToken();
      if (!t) throw new Error("Not authenticated");
      return apiFetch<void>(
        `/api/scopes/${scopeId}/members/${userId}`,
        t,
        { method: "DELETE" },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scope", scopeId, "members"] });
      toast.success("Removed member");
    },
    onError: (e: ApiError) => toast.error("Couldn't remove", { description: e.detail }),
  });

  const changeRole = useMutation({
    mutationFn: async ({ userId, role: newRole }: { userId: string; role: string }) => {
      const t = await getToken();
      if (!t) throw new Error("Not authenticated");
      return apiFetch(
        `/api/scopes/${scopeId}/members/${userId}`,
        t,
        {
          method: "PATCH",
          body: JSON.stringify({ role: newRole }),
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scope", scopeId, "members"] });
      toast.success("Role updated");
    },
    onError: (e: ApiError) =>
      toast.error("Couldn't change role", { description: e.detail }),
  });

  const revokeInvite = useMutation({
    mutationFn: async (invId: string) => {
      const t = await getToken();
      if (!t) throw new Error("Not authenticated");
      return apiFetch<void>(
        `/api/scopes/${scopeId}/invitations/${invId}`,
        t,
        { method: "DELETE" },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scope-invitations", scopeId] });
      toast.success("Invitation revoked");
    },
  });

  const buildAgentPrompt = (url: string, email: string | null) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const tokenMatch = url.match(/\/join\/(clawdi_inv_[A-Za-z0-9_-]+)/);
    const token = tokenMatch ? tokenMatch[1] : url;
    const emailLine = email
      ? `\nThis invitation is bound to ${email} — sign up / log in with that email.\n`
      : "";
    return `I received a Clawdi Cloud invitation. Accept it with:

  clawdi accept ${token}
${emailLine}
If I don't have the clawdi CLI yet, first read ${origin}/skill.md and follow its install steps, then run the command above.

After joining, help me pick which agents should see this scope with:
  clawdi agent scope add <agent-type> <scope-name>`;
  };

  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  if (!open) return null;

  const active = (invitations ?? []).filter(
    (i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at).getTime() > Date.now(),
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-start justify-center pt-24 px-4"
      onClick={onClose}
    >
      <div
        className="bg-card border rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-sm font-semibold">Share {scopeName}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Invite by email */}
          {callerIsOwner && (
            <div className="px-5 py-4 border-b space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="Email, separated by commas"
                  className="flex-1 border border-input bg-background rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && emailInput.trim()) {
                      addByEmail.mutate(emailInput.trim());
                    }
                  }}
                />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as "writer" | "reader")}
                  className="border border-input bg-background rounded-md px-2 py-1.5 text-xs"
                >
                  <option value="writer">Writer</option>
                  <option value="reader">Reader</option>
                </select>
                <button
                  type="button"
                  disabled={!emailInput.trim() || addByEmail.isPending || createInvite.isPending}
                  onClick={() => addByEmail.mutate(emailInput.trim())}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium disabled:opacity-50"
                >
                  {addByEmail.isPending || createInvite.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Invite"
                  )}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Registered email → added instantly. New email → we'll generate an email-bound link.
              </p>

              {/* Generated invite output (email-bound) */}
              {generated?.email && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                  <p className="text-xs">
                    <strong>{generated.email}</strong> isn't registered yet. Send them this:
                  </p>
                  <InviteArtifact
                    url={generated.url}
                    prompt={buildAgentPrompt(generated.url, generated.email)}
                    format={linkFormat}
                    onFormatChange={setLinkFormat}
                    onCopy={copyText}
                  />
                  <button
                    type="button"
                    onClick={() => setGenerated(null)}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline"
                  >
                    Clear and invite someone else
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Members */}
          <div className="px-5 py-4 border-b">
            <h4 className="text-xs font-medium text-muted-foreground mb-2">
              People with access
            </h4>
            <div className="space-y-1.5">
              {(members ?? []).map((m) => {
                const isSelf = m.user_id === callerUserId;
                return (
                  <div
                    key={m.user_id}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="size-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Users className="size-3.5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {isSelf ? "You" : `User ${m.user_id.slice(0, 8)}`}
                        </div>
                        {m.email && (
                          <div className="text-xs text-muted-foreground truncate">
                            {m.email}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 text-xs">
                      {callerIsOwner && !isSelf ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="px-2 py-1 rounded hover:bg-accent flex items-center gap-1"
                            >
                              {m.role}
                              <span className="text-muted-foreground">▾</span>
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {(["owner", "writer", "reader"] as const).map((r) => (
                              <DropdownMenuItem
                                key={r}
                                disabled={m.role === r}
                                onClick={() =>
                                  changeRole.mutate({ userId: m.user_id, role: r })
                                }
                              >
                                {r === m.role && <Check className="size-3.5" />}
                                {r}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuItem
                              onClick={() => {
                                if (confirm(`Remove this user from ${scopeName}?`)) {
                                  removeMember.mutate(m.user_id);
                                }
                              }}
                              className="text-destructive border-t mt-1 pt-2"
                            >
                              Remove from scope
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="px-2 py-1 text-muted-foreground">
                          {m.role}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pending invites */}
          {callerIsOwner && active.length > 0 && (
            <div className="px-5 py-4 border-b">
              <h4 className="text-xs font-medium text-muted-foreground mb-2">
                Pending ({active.length})
              </h4>
              <div className="space-y-1.5">
                {active.map((i) => (
                  <div
                    key={i.id}
                    className="flex items-center justify-between text-xs bg-muted/30 rounded px-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Mail className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">
                        {i.invitee_email ?? "Anyone with the link"}
                      </span>
                      <span className="text-muted-foreground shrink-0">· {i.role}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("Revoke this invitation?")) {
                          revokeInvite.mutate(i.id);
                        }
                      }}
                      className="text-[11px] text-red-600 hover:underline shrink-0 ml-2"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* General access: anonymous share link */}
          {callerIsOwner && (
            <div className="px-5 py-4">
              <h4 className="text-xs font-medium text-muted-foreground mb-2">
                General access
              </h4>
              {generated && !generated.email ? (
                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    Anyone with this invitation can join as {role} · expires in 48h
                  </div>
                  <InviteArtifact
                    url={generated.url}
                    prompt={buildAgentPrompt(generated.url, null)}
                    format={linkFormat}
                    onFormatChange={setLinkFormat}
                    onCopy={copyText}
                  />
                  <button
                    type="button"
                    onClick={() => setGenerated(null)}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={createInvite.isPending}
                  onClick={() => createInvite.mutate({})}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm hover:bg-accent"
                >
                  {createInvite.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <LinkIcon className="size-3.5" />
                  )}
                  Generate share link
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t">
          <a
            href="https://github.com/clawdi-ai/clawdi-cloud#scopes"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Learn about sharing
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-sm hover:bg-accent"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function InviteArtifact({
  url,
  prompt,
  format,
  onFormatChange,
  onCopy,
}: {
  url: string;
  prompt: string;
  format: "url" | "agent";
  onFormatChange: (f: "url" | "agent") => void;
  onCopy: (text: string, label: string) => void;
}) {
  const value = format === "url" ? url : prompt;
  const label = format === "url" ? "Link" : "Agent prompt";
  return (
    <>
      <div className="flex items-center gap-1 text-[11px]">
        <button
          type="button"
          onClick={() => onFormatChange("url")}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded border transition-colors ${
            format === "url"
              ? "bg-primary/10 border-primary text-primary font-medium"
              : "bg-background border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          <LinkIcon className="size-3" /> For a human
        </button>
        <button
          type="button"
          onClick={() => onFormatChange("agent")}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded border transition-colors ${
            format === "agent"
              ? "bg-primary/10 border-primary text-primary font-medium"
              : "bg-background border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          <Bot className="size-3" /> For their AI agent
        </button>
      </div>
      {format === "url" ? (
        <div className="flex items-center gap-2">
          <code className="flex-1 text-[11px] font-mono break-all bg-background border rounded px-2 py-1.5">
            {url}
          </code>
          <button
            type="button"
            onClick={() => onCopy(url, "Link")}
            className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-[11px] font-medium bg-background border hover:bg-muted shrink-0"
          >
            <Copy className="size-3" /> Copy
          </button>
        </div>
      ) : (
        <div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-background border rounded px-2 py-1.5 max-h-40 overflow-auto">
            {prompt}
          </pre>
          <button
            type="button"
            onClick={() => onCopy(prompt, "Agent prompt")}
            className="mt-1 inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-background border hover:bg-muted"
          >
            <Copy className="size-3" /> Copy prompt
          </button>
        </div>
      )}
    </>
  );
}

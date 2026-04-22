"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Key,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RowActions, DropdownMenuItem, DropdownMenuSeparator } from "@/components/row-actions";
import { ScopeFilterBar } from "@/components/scope-filter-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function VaultPage() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [newVaultSlug, setNewVaultSlug] = useState("");
  const [newVaultScope, setNewVaultScope] = useState<string>("");
  const [scopeFilter, setScopeFilter] = useState("all");

  const { data: vaults, isLoading } = useQuery({
    queryKey: ["vaults"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any[]>("/api/vault", token);
    },
  });

  const { data: scopes } = useQuery({
    queryKey: ["scopes"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Array<{ id: string; name: string; role: string | null; is_personal: boolean }>>(
        "/api/scopes",
        token,
      );
    },
  });
  const scopeById = new Map((scopes ?? []).map((s) => [s.id, s.name]));

  // Default the new-vault scope dropdown to Personal once scopes arrive.
  useEffect(() => {
    if (newVaultScope) return;
    const personal = scopes?.find((s) => s.is_personal);
    if (personal) setNewVaultScope(personal.id);
  }, [scopes, newVaultScope]);

  const createVault = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>("/api/vault", token, {
        method: "POST",
        body: JSON.stringify({
          slug: newVaultSlug,
          name: newVaultSlug,
          scope_id: newVaultScope === "__private" ? "private" : newVaultScope,
        }),
      });
    },
    onSuccess: (result) => {
      const slug = newVaultSlug;
      setNewVaultSlug("");
      const personal = scopes?.find((s) => s.is_personal);
      setNewVaultScope(personal?.id ?? "");
      queryClient.invalidateQueries({ queryKey: ["vaults"] });
      const where = result.scope_id
        ? `Created "${slug}" in ${scopeById.get(result.scope_id) ?? "scope"}`
        : `Created "${slug}" as Private`;
      toast.success(where);
    },
    onError: (e: ApiError) => toast.error("Failed to create vault", { description: e.detail }),
  });

  const deleteVault = useMutation({
    mutationFn: async (slug: string) => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>(`/api/vault/${slug}`, token, { method: "DELETE" });
    },
    onSuccess: (_, slug) => {
      queryClient.invalidateQueries({ queryKey: ["vaults"] });
      toast.success(`Deleted vault "${slug}"`);
    },
    onError: (e: ApiError) => toast.error("Delete failed", { description: e.detail }),
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vault</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Encrypted secrets synced to your agents via{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              clawdi run
            </code>
            . Values are AES-256-GCM encrypted at rest.
          </p>
        </div>
        {vaults && (
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            {vaults.length} vault{vaults.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Create vault */}
      <div className="flex gap-2 flex-wrap">
        <input
          type="text"
          value={newVaultSlug}
          onChange={(e) =>
            setNewVaultSlug(
              e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
            )
          }
          placeholder="New vault name (e.g. ai-keys, prod)"
          className="flex-1 min-w-[200px] border border-input bg-background rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          onKeyDown={(e) => {
            if (e.key === "Enter" && newVaultSlug) createVault.mutate();
          }}
        />
        <select
          value={newVaultScope || "__private"}
          onChange={(e) => setNewVaultScope(e.target.value)}
          className="border border-input bg-background rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          title="Scope"
        >
          {(scopes ?? [])
            .filter((s) => s.role !== "reader")
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.is_personal ? " (default)" : ""}
              </option>
            ))}
          <option value="__private">Private (only you)</option>
        </select>
        <button
          type="button"
          onClick={() => newVaultSlug && createVault.mutate()}
          disabled={!newVaultSlug || createVault.isPending}
          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Plus className="size-4" />
          Create
        </button>
      </div>

      {/* Scope filter */}
      {scopes && scopes.length > 0 && (
        <ScopeFilterBar scopes={scopes} value={scopeFilter} onChange={setScopeFilter} />
      )}

      <div className="rounded-md border border-dashed border-muted-foreground/30 px-3 py-2 text-xs text-muted-foreground">
        Secret values are never shown in the web UI. Use{" "}
        <code className="bg-muted px-1 rounded">clawdi vault set KEY</code> in a
        terminal to add values, or{" "}
        <code className="bg-muted px-1 rounded">clawdi run -- your-cmd</code> to
        inject them into a subprocess.
      </div>

      {/* Vault list */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4 space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      ) : (() => {
        const visible = (vaults ?? []).filter((v: any) => {
          if (scopeFilter === "all") return true;
          if (scopeFilter === "private") return v.scope_id == null;
          return v.scope_id === scopeFilter;
        });
        return visible.length ? (
        <div className="space-y-3">
          {visible.map((v: any) => (
            <VaultCard
              key={v.id}
              vault={v}
              scopes={scopes ?? []}
              scopeName={v.scope_id ? scopeById.get(v.scope_id) : undefined}
              onDelete={() => {
                if (confirm(`Delete vault "${v.slug}"? All stored secrets will be lost.`)) {
                  deleteVault.mutate(v.slug);
                }
              }}
              isDeleting={deleteVault.isPending}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {scopeFilter === "all"
            ? <>No vaults yet. Create one above or run{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                clawdi vault set KEY
              </code></>
            : "No vaults match this filter."}
        </div>
      );
      })()}
    </div>
  );
}

function VaultCard({
  vault,
  scopes,
  scopeName,
  onDelete,
  isDeleting,
}: {
  vault: any;
  scopes: Array<{ id: string; name: string; is_personal: boolean; role: string | null }>;
  scopeName?: string;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const changeScope = useMutation({
    mutationFn: async (newScopeId: string | null) => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>(
        `/api/vault/${vault.slug}/scope`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({
            scope_id: newScopeId === null ? "private" : newScopeId,
          }),
        },
      );
    },
    onSuccess: (_, newScopeId) => {
      queryClient.invalidateQueries({ queryKey: ["vaults"] });
      const label =
        newScopeId === null
          ? "Private"
          : scopes.find((s) => s.id === newScopeId)?.name ?? "scope";
      toast.success(`Moved "${vault.slug}" → ${label}`);
    },
    onError: (e: ApiError) => toast.error("Move failed", { description: e.detail }),
  });

  const { data: items } = useQuery({
    queryKey: ["vault-items", vault.slug],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Record<string, string[]>>(
        `/api/vault/${vault.slug}/items`,
        token,
      );
    },
  });

  const upsertItem = useMutation({
    mutationFn: async ({
      key,
      value,
    }: {
      key: string;
      value: string;
    }) => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>(`/api/vault/${vault.slug}/items`, token, {
        method: "PUT",
        body: JSON.stringify({ section: "", fields: { [key]: value } }),
      });
    },
    onSuccess: () => {
      setNewKey("");
      setNewValue("");
      setAdding(false);
      queryClient.invalidateQueries({
        queryKey: ["vault-items", vault.slug],
      });
    },
  });

  const deleteItem = useMutation({
    mutationFn: async (fieldName: string) => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>(`/api/vault/${vault.slug}/items`, token, {
        method: "DELETE",
        body: JSON.stringify({ section: "", fields: [fieldName] }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["vault-items", vault.slug],
      });
    },
  });

  const allFields = items
    ? Object.entries(items).flatMap(([section, fields]) =>
        fields.map((f) => ({
          key: section === "(default)" ? f : `${section}/${f}`,
          name: f,
          section: section === "(default)" ? "" : section,
        })),
      )
    : [];

  return (
    <div className="group/vault rounded-lg border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2 flex-wrap">
          <Key className="size-4 text-primary" />
          <span className="font-medium text-sm">{vault.slug}</span>
          {scopeName ? (
            <span className="text-[10px] rounded bg-primary/10 text-primary px-1.5 py-0.5 font-medium">
              {scopeName}
            </span>
          ) : (
            <span className="text-[10px] rounded bg-muted/50 text-muted-foreground px-1.5 py-0.5">
              private
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {allFields.length} {allFields.length === 1 ? "key" : "keys"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAdding(!adding)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
          >
            <Plus className="size-3.5" />
            Add Key
          </button>
          <RowActions alwaysVisible>
            {scopes.filter((s) => s.role !== "reader").map((s) => (
              <DropdownMenuItem
                key={s.id}
                disabled={vault.scope_id === s.id}
                onClick={() => changeScope.mutate(s.id)}
              >
                Move to {s.name}{s.is_personal ? " (default)" : ""}
                {vault.scope_id === s.id ? " ✓" : ""}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              disabled={vault.scope_id == null}
              onClick={() => changeScope.mutate(null)}
            >
              Move to Private
              {vault.scope_id == null ? " ✓" : ""}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="size-3.5" />
              Delete vault
            </DropdownMenuItem>
          </RowActions>
        </div>
      </div>

      {/* Add key form */}
      {adding && (
        <div className="px-4 py-3 border-b bg-muted/30">
          <div className="flex gap-2">
            <input
              type="text"
              value={newKey}
              onChange={(e) =>
                setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))
              }
              placeholder="KEY_NAME"
              className="flex-1 border border-input bg-background rounded-md px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
            <input
              type="password"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="secret value"
              className="flex-1 border border-input bg-background rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newKey && newValue)
                  upsertItem.mutate({ key: newKey, value: newValue });
              }}
            />
            <button
              type="button"
              onClick={() =>
                newKey &&
                newValue &&
                upsertItem.mutate({ key: newKey, value: newValue })
              }
              disabled={!newKey || !newValue || upsertItem.isPending}
              className="inline-flex items-center gap-1 bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {upsertItem.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Plus className="size-3" />
              )}
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNewKey("");
                setNewValue("");
              }}
              className="p-1.5 text-muted-foreground hover:bg-muted rounded-md transition-colors"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Keys list */}
      {allFields.length > 0 ? (
        <div>
          {allFields.map((f, i) => (
            <div
              key={f.key}
              className={cn(
                "group flex items-center justify-between px-4 py-2.5",
                i > 0 && "border-t",
              )}
            >
              <span className="font-mono text-xs">{f.key}</span>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground mr-1">
                  ••••••••
                </span>
                <button
                  type="button"
                  onClick={() => deleteItem.mutate(f.name)}
                  disabled={deleteItem.isPending}
                  className="p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive rounded transition-all disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        !adding && (
          <div className="px-4 py-4 text-center text-xs text-muted-foreground">
            No keys yet. Click "Add Key" to add one.
          </div>
        )
      )}
    </div>
  );
}

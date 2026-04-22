"use client";

import { useAuth } from "@clerk/nextjs";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Brain,
  Database,
  Key,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import { toast } from "sonner";
import { ManageScopesSheet } from "@/components/manage-scopes-sheet";
import { RowActions, DropdownMenuItem, DropdownMenuSeparator } from "@/components/row-actions";
import { ScopeChips } from "@/components/scope-chips";
import { ScopeFilterBar } from "@/components/scope-filter-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiError } from "@/lib/api";
import { cn, relativeTime } from "@/lib/utils";

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "fact", label: "Fact" },
  { value: "preference", label: "Preference" },
  { value: "pattern", label: "Pattern" },
  { value: "decision", label: "Decision" },
  { value: "context", label: "Context" },
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  fact: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  preference: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  pattern: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  decision: "bg-green-500/10 text-green-700 dark:text-green-400",
  context: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

export default function MemoriesPage() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [category, setCategory] = useState("");
  const [scopeFilter, setScopeFilter] = useState("all");
  const deferredQuery = useDeferredValue(searchQuery);

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

  // --- Settings (provider) ---
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<Record<string, any>>("/api/settings", token);
    },
  });

  const provider = settings?.memory_provider || "builtin";
  const hasMem0Key = settings?.mem0_api_key && settings.mem0_api_key !== "";

  const updateSettings = useMutation({
    mutationFn: async (patch: Record<string, string>) => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>("/api/settings", token, {
        method: "PATCH",
        body: JSON.stringify({ settings: patch }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
  });

  // --- Memories ---
  const { data: memories, isLoading } = useQuery({
    queryKey: ["memories", deferredQuery, category],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const params = new URLSearchParams();
      if (deferredQuery) params.set("q", deferredQuery);
      if (category) params.set("category", category);
      const qs = params.toString();
      return apiFetch<any[]>(`/api/memories${qs ? `?${qs}` : ""}`, token);
    },
  });

  const deleteMemory = useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>(`/api/memories/${id}`, token, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      queryClient.invalidateQueries({ queryKey: ["memories-all"] });
      toast.success("Memory deleted");
    },
    onError: (e: ApiError) => toast.error("Delete failed", { description: e.detail }),
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Memories</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cross-agent recall. Memories are searchable from any agent
            via MCP.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {memories && (
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              {memories.length} memor{memories.length === 1 ? "y" : "ies"}
            </span>
          )}
          <ProviderSwitch
            provider={provider}
            hasMem0Key={!!hasMem0Key}
            onSwitch={(p) =>
              updateSettings.mutate({ memory_provider: p })
            }
            isPending={updateSettings.isPending}
          />
        </div>
      </div>

      {/* Mem0 API Key config */}
      {provider === "mem0" && !hasMem0Key && (
        <Mem0KeyForm
          onSave={(key) => updateSettings.mutate({ mem0_api_key: key })}
          isPending={updateSettings.isPending}
        />
      )}

      {/* Add memory */}
      <AddMemoryForm />

      {/* Search + Category filter */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search memories..."
            className="w-full border border-input bg-background rounded-xl pl-9 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 size-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                category === c.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        {scopes && scopes.length > 0 && (
          <ScopeFilterBar
            scopes={scopes}
            value={scopeFilter}
            onChange={setScopeFilter}
          />
        )}
      </div>

      {/* Memory list */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border bg-card px-4 py-3 space-y-2"
            >
              <Skeleton className="h-4 w-3/4" />
              <div className="flex gap-2">
                <Skeleton className="h-3 w-14 rounded-full" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : (() => {
        const visible = (memories ?? []).filter((m: any) => {
          const sids: string[] = m.scope_ids ?? [];
          if (scopeFilter === "all") return true;
          if (scopeFilter === "private") return sids.length === 0;
          return sids.includes(scopeFilter);
        });
        return visible.length ? (
        <div className="space-y-2">
          {visible.map((m: any) => (
            <MemoryRow
              key={m.id}
              memory={m}
              scopes={(scopes ?? []) as any}
              onDelete={() => {
                if (confirm("Delete this memory?")) {
                  deleteMemory.mutate(m.id);
                }
              }}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {searchQuery || category || scopeFilter !== "all"
            ? "No memories match your filters."
            : 'No memories yet. Add one above or use `clawdi memory add "..."`'}
        </div>
      );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MemoryRow({
  memory,
  scopes,
  onDelete,
}: {
  memory: any;
  scopes: Array<{ id: string; name: string; is_personal: boolean; role: string | null }>;
  onDelete: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <div className="group flex items-start justify-between gap-3 rounded-lg border bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{memory.content}</p>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span
            className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
              CATEGORY_COLORS[memory.category] || "bg-muted text-muted-foreground",
            )}
          >
            {memory.category}
          </span>
          <ScopeChips scopeIds={memory.scope_ids ?? []} scopes={scopes} readonly />
          <span className="text-xs text-muted-foreground">{memory.source}</span>
          {memory.tags?.map((t: string) => (
            <span key={t} className="text-xs text-muted-foreground">
              #{t}
            </span>
          ))}
          <span className="text-xs text-muted-foreground">
            {relativeTime(memory.created_at)}
          </span>
        </div>
      </div>
      <div className="shrink-0">
        <RowActions alwaysVisible>
          <DropdownMenuItem onClick={() => setSheetOpen(true)}>
            Manage scopes…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} className="text-destructive">
            <Trash2 className="size-3.5" />
            Delete memory
          </DropdownMenuItem>
        </RowActions>
      </div>
      {sheetOpen && (
        <ManageScopesSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          currentScopeIds={memory.scope_ids ?? []}
          scopes={scopes}
          mutateEndpoint={`/api/memories/${memory.id}/scopes`}
        />
      )}
    </div>
  );
}

function ProviderSwitch({
  provider,
  hasMem0Key,
  onSwitch,
  isPending,
}: {
  provider: string;
  hasMem0Key: boolean;
  onSwitch: (p: string) => void;
  isPending: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border p-0.5">
      <button
        type="button"
        onClick={() => onSwitch("builtin")}
        disabled={isPending}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors",
          provider === "builtin"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted",
        )}
      >
        <Database className="size-3" />
        Built-in
      </button>
      <button
        type="button"
        onClick={() => onSwitch("mem0")}
        disabled={isPending}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors",
          provider === "mem0"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted",
        )}
      >
        <Brain className="size-3" />
        Mem0
      </button>
    </div>
  );
}

function Mem0KeyForm({
  onSave,
  isPending,
}: {
  onSave: (key: string) => void;
  isPending: boolean;
}) {
  const [apiKey, setApiKey] = useState("");

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
        <Key className="size-3.5" />
        Mem0 Configuration
      </h3>
      <p className="text-xs text-muted-foreground mb-3">
        Enter your Mem0 API key to use semantic memory search.
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="m0-..."
          className="flex-1 border border-input bg-background rounded-md px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
          onKeyDown={(e) => {
            if (e.key === "Enter" && apiKey) onSave(apiKey);
          }}
        />
        <button
          type="button"
          onClick={() => apiKey && onSave(apiKey)}
          disabled={!apiKey || isPending}
          className="inline-flex items-center gap-1 bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Key className="size-3" />
          )}
          Save
        </button>
      </div>
    </div>
  );
}

function AddMemoryForm() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [addCategory, setAddCategory] = useState("fact");
  // "" sentinel means "haven't picked yet → use Personal".
  // After scopes load, we pre-select the Personal scope id so the dropdown
  // shows the real default instead of misleadingly reading "private".
  const [addScope, setAddScope] = useState<string>("");

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
    enabled: open,
  });

  // Default the scope selector to Personal once scopes are loaded.
  useEffect(() => {
    if (!open) return;
    if (addScope) return;
    const personal = scopes?.find((s) => s.is_personal);
    if (personal) setAddScope(personal.id);
  }, [open, scopes, addScope]);

  const scopeById = new Map((scopes ?? []).map((s) => [s.id, s.name]));

  const createMemory = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>("/api/memories", token, {
        method: "POST",
        body: JSON.stringify({
          content,
          category: addCategory,
          source: "web",
          // "__private" sentinel → explicit private; anything else is a UUID.
          scope_id: addScope === "__private" ? "private" : addScope,
        }),
      });
    },
    onSuccess: (saved) => {
      setContent("");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      queryClient.invalidateQueries({ queryKey: ["memories-all"] });
      const where = saved?.scope_id
        ? `Saved to ${scopeById.get(saved.scope_id) ?? "scope"}`
        : "Saved as Private";
      toast.success(where);
    },
    onError: (e: ApiError) =>
      toast.error("Failed to save memory", { description: e.detail }),
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
      >
        <Plus className="size-4" />
        Add Memory
      </button>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What should your agents remember?"
        rows={3}
        className="w-full border border-input bg-background rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        autoFocus
      />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Category:</span>
            <select
              value={addCategory}
              onChange={(e) => setAddCategory(e.target.value)}
              className="border border-input bg-background rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {CATEGORIES.filter((c) => c.value).map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Save to:</span>
            <select
              value={addScope || "__private"}
              onChange={(e) => setAddScope(e.target.value)}
              className="border border-input bg-background rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
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
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setContent("");
            }}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => content.trim() && createMemory.mutate()}
            disabled={!content.trim() || createMemory.isPending}
            className="inline-flex items-center gap-1 bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {createMemory.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Plus className="size-3" />
            )}
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

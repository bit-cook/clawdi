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
  Sparkles,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
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
  const deferredQuery = useDeferredValue(searchQuery);

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
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["memories"] }),
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

      {/* Semantic search (Builtin only — Mem0 has its own semantic layer) */}
      {provider === "builtin" && (
        <SemanticSearchCard
          settings={settings || {}}
          onPatch={(patch) => updateSettings.mutate(patch)}
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
      ) : memories?.length ? (
        <div className="space-y-2">
          {memories.map((m: any) => (
            <div
              key={m.id}
              className="group flex items-start justify-between gap-3 rounded-lg border bg-card px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">{m.content}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span
                    className={cn(
                      "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                      CATEGORY_COLORS[m.category] ||
                        "bg-muted text-muted-foreground",
                    )}
                  >
                    {m.category}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {m.source}
                  </span>
                  {m.tags?.map((t: string) => (
                    <span
                      key={t}
                      className="text-xs text-muted-foreground"
                    >
                      #{t}
                    </span>
                  ))}
                  <span className="text-xs text-muted-foreground">
                    {relativeTime(m.created_at)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteMemory.mutate(m.id)}
                disabled={deleteMemory.isPending}
                className="p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-muted rounded-md transition-all shrink-0 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {searchQuery || category
            ? "No memories match your search."
            : 'No memories yet. Add one above or use `clawdi memory add "..."`'}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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

function SemanticSearchCard({
  settings,
  onPatch,
  isPending,
}: {
  settings: Record<string, any>;
  onPatch: (patch: Record<string, string>) => void;
  isPending: boolean;
}) {
  const { getToken } = useAuth();
  const mode = (settings.memory_embedding as string) || "off";
  const hasApiKey =
    settings.memory_embedding_api_key && settings.memory_embedding_api_key !== "";
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(
    (settings.memory_embedding_base_url as string) || "",
  );
  const [model, setModel] = useState(
    (settings.memory_embedding_model as string) || "",
  );
  const [backfillResult, setBackfillResult] = useState<string | null>(null);

  const backfill = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<{ processed: number; failed: number }>(
        "/api/memories/embed-backfill",
        token,
        { method: "POST", body: JSON.stringify({}) },
      );
    },
    onSuccess: (r) => {
      setBackfillResult(
        `Embedded ${r.processed} memor${r.processed === 1 ? "y" : "ies"}` +
          (r.failed ? `, ${r.failed} failed` : ""),
      );
    },
    onError: (e: any) => {
      setBackfillResult(`Failed: ${e.message}`);
    },
  });

  const saveApi = () => {
    const patch: Record<string, string> = { memory_embedding: "api" };
    if (apiKey) patch.memory_embedding_api_key = apiKey;
    if (baseUrl !== (settings.memory_embedding_base_url || ""))
      patch.memory_embedding_base_url = baseUrl;
    if (model !== (settings.memory_embedding_model || ""))
      patch.memory_embedding_model = model;
    onPatch(patch);
    setApiKey("");
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="size-3.5" />
          Semantic Search
        </h3>
        <div className="flex items-center gap-0.5 rounded-lg border p-0.5">
          <ModeButton
            active={mode === "off"}
            onClick={() => onPatch({ memory_embedding: "off" })}
            disabled={isPending}
          >
            Off
          </ModeButton>
          <ModeButton
            active={mode === "local"}
            onClick={() => onPatch({ memory_embedding: "local" })}
            disabled={isPending}
          >
            <Zap className="size-3" /> Local
          </ModeButton>
          <ModeButton
            active={mode === "api"}
            onClick={() => onPatch({ memory_embedding: "api" })}
            disabled={isPending}
          >
            <Key className="size-3" /> API
          </ModeButton>
        </div>
      </div>

      {mode === "off" && (
        <p className="text-xs text-muted-foreground">
          Using full-text + fuzzy search only (zero config, fast).
          Switch to <strong>Local</strong> for on-device semantic search (~130MB model download on first use),
          or <strong>API</strong> to use OpenAI or OpenRouter embeddings.
        </p>
      )}

      {mode === "local" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Using <code className="text-xs">BAAI/bge-small-en-v1.5</code> (ONNX, 384 dim).
            First <code>memory_add</code> after switching will download ~130MB to the backend.
          </p>
          <button
            type="button"
            onClick={() => {
              setBackfillResult(null);
              backfill.mutate();
            }}
            disabled={backfill.isPending}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-muted transition-colors disabled:opacity-50"
          >
            {backfill.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Sparkles className="size-3" />
            )}
            Backfill existing memories
          </button>
          {backfillResult && (
            <p className="text-xs text-muted-foreground">{backfillResult}</p>
          )}
        </div>
      )}

      {mode === "api" && (
        <div className="space-y-2">
          <div className="grid gap-2">
            <label className="text-xs text-muted-foreground">
              API key
              {hasApiKey && (
                <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                  ✓ set
                </span>
              )}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasApiKey ? "Leave blank to keep current key" : "sk-..."}
              className="border border-input bg-background rounded-md px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <label className="text-xs text-muted-foreground mt-1">
              Base URL (optional)
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1  (or https://openrouter.ai/api/v1)"
              className="border border-input bg-background rounded-md px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex flex-wrap gap-1 text-xs">
              <button
                type="button"
                onClick={() => setBaseUrl("https://api.openai.com/v1")}
                className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted transition-colors"
              >
                OpenAI
              </button>
              <button
                type="button"
                onClick={() => setBaseUrl("https://openrouter.ai/api/v1")}
                className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted transition-colors"
              >
                OpenRouter
              </button>
            </div>
            <label className="text-xs text-muted-foreground mt-1">
              Model (default <code>text-embedding-3-small</code>)
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="text-embedding-3-small"
              className="border border-input bg-background rounded-md px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveApi}
              disabled={isPending || (!apiKey && !hasApiKey)}
              className="inline-flex items-center gap-1 bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Key className="size-3" />
              )}
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setBackfillResult(null);
                backfill.mutate();
              }}
              disabled={backfill.isPending || !hasApiKey}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-muted transition-colors disabled:opacity-50"
            >
              {backfill.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Sparkles className="size-3" />
              )}
              Backfill existing
            </button>
            {backfillResult && (
              <span className="text-xs text-muted-foreground">{backfillResult}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Embeddings are truncated to 384 dim via the OpenAI <code>dimensions</code> parameter,
            matching the Local model so the on-disk vector column is shared.
          </p>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function AddMemoryForm() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [addCategory, setAddCategory] = useState("fact");

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
        }),
      });
    },
    onSuccess: () => {
      setContent("");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
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
      <div className="flex items-center justify-between">
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

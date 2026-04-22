"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api";

interface Scope {
  id: string;
  name: string;
  role: string | null;
  is_personal: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  currentScopeIds: string[];
  scopes: Scope[];
  /** Endpoint used for PUT replace, e.g. "/api/skills/python-style/scopes" */
  mutateEndpoint?: string;
  onUpdated?: (newScopeIds: string[]) => void;
}

/**
 * Modal sheet for managing which scopes an item belongs to.
 * Simple overlay — not using radix dialog to keep deps minimal.
 */
export function ManageScopesSheet({
  open,
  onClose,
  currentScopeIds,
  scopes,
  mutateEndpoint,
  onUpdated,
}: Props) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set(currentScopeIds));

  useEffect(() => {
    setSelected(new Set(currentScopeIds));
  }, [currentScopeIds, open]);

  const save = useMutation({
    mutationFn: async () => {
      if (!mutateEndpoint) throw new Error("No mutate endpoint");
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<{ scope_ids: string[]; added: string[]; removed: string[] }>(
        mutateEndpoint,
        token,
        {
          method: "PUT",
          body: JSON.stringify({ scope_ids: Array.from(selected) }),
        },
      );
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      queryClient.invalidateQueries({ queryKey: ["memories-all"] });
      const msg =
        result.added.length && result.removed.length
          ? `Added ${result.added.length}, removed ${result.removed.length}`
          : result.added.length
            ? `Added to ${result.added.length} scope(s)`
            : result.removed.length
              ? `Removed from ${result.removed.length} scope(s)`
              : "No changes";
      toast.success(msg);
      onUpdated?.(result.scope_ids);
      onClose();
    },
    onError: (e: ApiError) => toast.error("Failed to update scopes", { description: e.detail }),
  });

  if (!open) return null;

  const toggle = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const writable = scopes.filter((s) => s.role !== "reader");

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border rounded-xl shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-sm font-semibold">Manage scopes</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-accent text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-4 max-h-[50vh] overflow-y-auto">
          <p className="text-xs text-muted-foreground mb-3">
            Pick the scopes this item should belong to. An item with zero scopes
            is private (only its creator sees it).
          </p>

          {writable.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              You don't have writer/owner access on any scope. Create one on the
              Scopes page, or ask an existing owner to invite you as writer.
            </p>
          ) : (
            <div className="space-y-1">
              {writable.map((s) => {
                const on = selected.has(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggle(s.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md border transition-colors text-left ${
                      on
                        ? "bg-primary/10 border-primary"
                        : "bg-background border-border hover:bg-accent"
                    }`}
                  >
                    <div
                      className={`flex size-4 items-center justify-center rounded border ${
                        on ? "bg-primary border-primary" : "border-border"
                      }`}
                    >
                      {on && <Check className="size-3 text-primary-foreground" />}
                    </div>
                    <span className="text-sm font-medium">{s.name}</span>
                    {s.is_personal && (
                      <span className="text-[10px] rounded bg-primary/10 text-primary px-1 py-0.5 ml-auto">
                        Default
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={save.isPending || !mutateEndpoint}
            onClick={() => save.mutate()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

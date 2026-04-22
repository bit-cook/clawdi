"use client";

import { useState } from "react";
import { ManageScopesSheet } from "@/components/manage-scopes-sheet";

interface Scope {
  id: string;
  name: string;
  role: string | null;
  is_personal: boolean;
}

interface Props {
  scopeIds: string[];
  scopes: Scope[];
  maxChips?: number;
  /** Callback after scopes are updated. Used to invalidate lists. */
  onUpdated?: (newScopeIds: string[]) => void;
  /** Target for the PUT endpoint, e.g. "/api/skills/python-style-guide/scopes" */
  mutateEndpoint?: string;
  /** Disable editing (read-only display) */
  readonly?: boolean;
  /** Show "Private" chip when scopeIds empty */
  showPrivate?: boolean;
}

/**
 * Display up to `maxChips` scope chips inline; overflow as "+N".
 * Click opens a sheet where the user can add/remove scopes.
 */
export function ScopeChips({
  scopeIds,
  scopes,
  maxChips = 2,
  onUpdated,
  mutateEndpoint,
  readonly = false,
  showPrivate = true,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const scopeById = new Map(scopes.map((s) => [s.id, s]));
  const attached = scopeIds.map((id) => scopeById.get(id)).filter(Boolean) as Scope[];

  if (attached.length === 0) {
    if (!showPrivate) return null;
    const privateChip = (
      <span className="text-[10px] rounded bg-muted/50 text-muted-foreground px-1.5 py-0.5">
        private
      </span>
    );
    if (readonly || !mutateEndpoint) return privateChip;
    return (
      <>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSheetOpen(true);
          }}
          className="inline-flex items-center gap-1 text-[10px] rounded bg-muted/50 text-muted-foreground px-1.5 py-0.5 hover:bg-muted transition-colors"
          title="Click to add to a scope"
        >
          private
        </button>
        {sheetOpen && (
          <ManageScopesSheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            currentScopeIds={scopeIds}
            scopes={scopes}
            mutateEndpoint={mutateEndpoint}
            onUpdated={onUpdated}
          />
        )}
      </>
    );
  }

  const shown = attached.slice(0, maxChips);
  const overflow = attached.length - shown.length;

  return (
    <>
      <div className="inline-flex items-center gap-1 flex-wrap">
        {shown.map((s) => (
          <span
            key={s.id}
            className="text-[10px] rounded bg-primary/10 text-primary px-1.5 py-0.5 font-medium"
          >
            {s.name}
          </span>
        ))}
        {overflow > 0 && (
          <span className="text-[10px] rounded bg-muted text-muted-foreground px-1.5 py-0.5">
            +{overflow}
          </span>
        )}
        {!readonly && mutateEndpoint && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSheetOpen(true);
            }}
            className="text-[10px] rounded border border-dashed border-border px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:border-solid transition-colors"
            title="Manage scopes"
          >
            ⋯
          </button>
        )}
      </div>
      {sheetOpen && (
        <ManageScopesSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          currentScopeIds={scopeIds}
          scopes={scopes}
          mutateEndpoint={mutateEndpoint}
          onUpdated={onUpdated}
        />
      )}
    </>
  );
}

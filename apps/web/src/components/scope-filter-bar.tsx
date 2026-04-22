"use client";

import { cn } from "@/lib/utils";

interface Scope {
  id: string;
  name: string;
  is_personal?: boolean;
}

interface Props {
  scopes: Scope[];
  value: string; // "all" | "private" | scope_id
  onChange: (v: string) => void;
  /** Over this threshold, switch from pill bar to dropdown to avoid overflow. */
  pillThreshold?: number;
}

/**
 * Scope filter used on Skills / Memories / Vault pages.
 * Shows a pill bar for few scopes, collapses to a select for many.
 */
export function ScopeFilterBar({
  scopes,
  value,
  onChange,
  pillThreshold = 5,
}: Props) {
  const options: Array<{ v: string; label: string }> = [
    { v: "all", label: "All" },
    { v: "private", label: "Private" },
    ...scopes.map((s) => ({
      v: s.id,
      label: s.is_personal ? `${s.name} (default)` : s.name,
    })),
  ];

  // Pill layout for a small number of scopes — fastest interaction.
  if (scopes.length <= pillThreshold) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Scope:</span>
        {options.map((opt) => (
          <button
            key={opt.v}
            type="button"
            onClick={() => onChange(opt.v)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
              value === opt.v
                ? "bg-primary/10 border-primary text-primary"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  // Dropdown layout for many scopes — avoids wrap noise.
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Scope:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-input bg-background rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[180px]"
      >
        {options.map((opt) => (
          <option key={opt.v} value={opt.v}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

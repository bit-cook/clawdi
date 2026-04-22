"use client";

import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  children: ReactNode;
  /** Always visible (not just on hover). Defaults to hover-only. */
  alwaysVisible?: boolean;
  /** Button size class override */
  triggerClassName?: string;
}

/**
 * Row-level actions dropdown. Wraps shadcn/radix dropdown-menu with a
 * consistent trigger icon for table-like lists.
 *
 * Usage:
 * <RowActions>
 *   <DropdownMenuItem onClick={...}>Manage scopes</DropdownMenuItem>
 *   <DropdownMenuSeparator />
 *   <DropdownMenuItem onClick={...} className="text-destructive">Delete</DropdownMenuItem>
 * </RowActions>
 */
export function RowActions({ children, alwaysVisible, triggerClassName }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={
            triggerClassName ??
            `p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-all ${
              alwaysVisible ? "" : "opacity-0 group-hover:opacity-100"
            }`
          }
          aria-label="Row actions"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { DropdownMenuItem, DropdownMenuSeparator };

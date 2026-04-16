"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { apiFetch } from "@/lib/api";

export default function MemoriesPage() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");

  const { data: memories, isLoading } = useQuery({
    queryKey: ["memories", searchQuery],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const params = searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : "";
      return apiFetch<any[]>(`/api/memories${params}`, token);
    },
  });

  const deleteMemory = useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>(`/api/memories/${id}`, token, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["memories"] }),
  });

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold">Memories</h1>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search memories..."
          className="w-full border border-input bg-background rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : memories?.length ? (
        <div className="space-y-2">
          {memories.map((m: any) => (
            <div
              key={m.id}
              className="bg-card border border-border rounded-lg px-4 py-3 flex items-start justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">{m.content}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{m.category}</span>
                  <span className="text-xs text-muted-foreground">{m.source}</span>
                  {m.tags?.map((t: string) => (
                    <span key={t} className="text-xs text-muted-foreground">#{t}</span>
                  ))}
                  <span className="text-xs text-muted-foreground">
                    {new Date(m.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteMemory.mutate(m.id)}
                className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-muted rounded-md transition-colors shrink-0"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground text-sm">
          {searchQuery
            ? `No memories matching "${searchQuery}".`
            : "No memories yet. Use `clawdi memories add \"...\"` to add one."}
        </div>
      )}
    </div>
  );
}

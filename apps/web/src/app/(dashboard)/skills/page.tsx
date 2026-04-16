"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function SkillsPage() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const { data: skills, isLoading } = useQuery({
    queryKey: ["skills"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any[]>("/api/skills", token);
    },
  });

  const deleteSkill = useMutation({
    mutationFn: async (key: string) => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>(`/api/skills/${key}`, token, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skills"] }),
  });

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold">Skills</h1>
      <p className="text-sm text-muted-foreground">
        Portable agent instruction packages synced from your agents.
      </p>

      {isLoading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : skills?.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {skills.map((s: any) => (
            <div
              key={s.id}
              className="bg-card border border-border rounded-lg p-4 flex items-start justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-primary" />
                  <span className="font-medium text-sm">{s.skill_key}</span>
                  <span className="text-xs text-muted-foreground">v{s.version}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {s.source} · {new Date(s.created_at).toLocaleDateString()}
                </div>
              </div>
              <button
                type="button"
                onClick={() => deleteSkill.mutate(s.skill_key)}
                className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-muted rounded-md transition-colors"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground text-sm">
          No skills yet. Run{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
            clawdi sync up --modules skills
          </code>{" "}
          or{" "}
          <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
            clawdi skills add ./my-skill.md
          </code>
        </div>
      )}
    </div>
  );
}

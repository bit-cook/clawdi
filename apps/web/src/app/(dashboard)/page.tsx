"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { ContributionGraph } from "@/components/dashboard/contribution-graph";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { apiFetch } from "@/lib/api";

export default function DashboardPage() {
  const { getToken } = useAuth();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any>("/api/dashboard/stats", token);
    },
  });

  const { data: contribution, isLoading: contribLoading } = useQuery({
    queryKey: ["dashboard-contribution"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any[]>("/api/dashboard/contribution", token);
    },
  });

  const { data: sessions } = useQuery({
    queryKey: ["recent-sessions"],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      return apiFetch<any[]>("/api/sessions?limit=10", token);
    },
  });

  return (
    <div className="max-w-5xl space-y-8">
      <h1 className="text-2xl font-bold">Overview</h1>

      {statsLoading ? (
        <div className="text-neutral-400">Loading stats...</div>
      ) : stats ? (
        <StatsCards stats={stats} />
      ) : null}

      <div>
        <h2 className="text-sm font-medium text-neutral-500 mb-3">
          Activity
        </h2>
        {contribLoading ? (
          <div className="text-neutral-400">Loading...</div>
        ) : contribution ? (
          <ContributionGraph data={contribution} />
        ) : null}
      </div>

      <div>
        <h2 className="text-sm font-medium text-neutral-500 mb-3">
          Recent Sessions
        </h2>
        {sessions?.length ? (
          <div className="space-y-2">
            {sessions.map((s: any) => (
              <div
                key={s.id}
                className="flex items-center justify-between border border-neutral-200 rounded-lg px-4 py-3 bg-white text-sm"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {s.summary || s.local_session_id}
                  </div>
                  <div className="text-xs text-neutral-400 mt-0.5">
                    {s.project_path?.split("/").pop() ?? "unknown"} &middot;{" "}
                    {s.model?.replace("claude-", "") ?? "?"} &middot;{" "}
                    {s.message_count} msgs
                  </div>
                </div>
                <div className="text-xs text-neutral-400 ml-4 whitespace-nowrap">
                  {new Date(s.started_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-neutral-400 text-sm">
            No sessions yet. Run{" "}
            <code className="bg-neutral-100 px-1.5 py-0.5 rounded">
              clawdi sync up
            </code>{" "}
            to sync your agent sessions.
          </div>
        )}
      </div>
    </div>
  );
}

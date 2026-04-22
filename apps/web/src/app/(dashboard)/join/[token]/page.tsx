"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, Clock, Loader2, Shield, UserPlus } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiFetch, ApiError } from "@/lib/api";

interface Preview {
  scope_id: string;
  scope_name: string;
  role: "owner" | "writer" | "reader";
  expires_at: string;
  already_member: boolean;
  can_accept: boolean;
  reason: string | null;
}

export default function JoinScopePage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const token = params?.token as string;

  const { data: preview, isLoading, error } = useQuery({
    queryKey: ["invitation-preview", token],
    queryFn: async () => {
      const t = await getToken();
      if (!t) throw new Error("Not authenticated");
      return apiFetch<Preview>(`/api/invitations/${token}`, t);
    },
    retry: false,
  });

  const accept = useMutation({
    mutationFn: async () => {
      const t = await getToken();
      if (!t) throw new Error("Not authenticated");
      return apiFetch<{ scope_id: string; already_member: boolean }>(
        `/api/invitations/${token}/accept`,
        t,
        { method: "POST" },
      );
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["scopes"] });
      toast.success(`Joined ${preview?.scope_name ?? "scope"}`);
      // Jump to onboard page — let them pick which agents see this scope
      router.push(
        result.already_member
          ? `/scopes/${result.scope_id}`
          : `/scopes/${result.scope_id}/onboard`,
      );
    },
    onError: (e: ApiError) => toast.error("Couldn't join", { description: e.detail }),
  });

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto px-6 py-16">
        <div className="border rounded-lg bg-card p-8 flex items-center gap-3 justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          Looking up invitation…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto px-6 py-16">
        <div className="border rounded-lg bg-card p-8 text-center">
          <AlertTriangle className="size-10 mx-auto text-amber-500 mb-3" />
          <h1 className="text-lg font-semibold mb-1">Invalid invitation</h1>
          <p className="text-sm text-muted-foreground mb-4">
            This invite link is not recognized. It may have been typed wrong or deleted.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Back to Dashboard
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  if (!preview) return null;

  const expiry = new Date(preview.expires_at);

  return (
    <div className="max-w-md mx-auto px-6 py-16">
      <div className="border rounded-lg bg-card p-8 text-center">
        <div className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 mb-4">
          <UserPlus className="size-6 text-primary" />
        </div>
        <h1 className="text-xl font-semibold mb-1">
          Join <span className="text-primary">{preview.scope_name}</span>?
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          You've been invited as a{" "}
          <span className="font-medium text-foreground">{preview.role}</span>.
        </p>

        {/* What you get */}
        <div className="text-left border rounded-md p-4 bg-muted/30 text-sm mb-5">
          <div className="flex items-center gap-2 font-medium mb-2">
            <Shield className="size-4" />
            As a {preview.role}, you can:
          </div>
          <ul className="text-muted-foreground space-y-0.5 text-xs pl-6 list-disc">
            <li>See all skills and memories in this scope</li>
            {preview.role !== "reader" && (
              <li>Add and edit skills / memories in this scope</li>
            )}
            {preview.role === "owner" && <li>Invite others and delete the scope</li>}
          </ul>
        </div>

        {preview.already_member ? (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Check className="size-4 text-emerald-600" />
              You're already a member of this scope.
            </div>
            <Link
              href={`/scopes/${preview.scope_id}`}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium"
            >
              Go to scope
              <ArrowRight className="size-4" />
            </Link>
          </div>
        ) : !preview.can_accept ? (
          <div className="space-y-3">
            <div className="text-sm text-destructive">
              {preview.reason ?? "This invitation can't be accepted."}
            </div>
            <Link
              href="/"
              className="inline-block text-sm text-muted-foreground hover:text-foreground underline"
            >
              Back to Dashboard
            </Link>
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={accept.isPending}
              onClick={() => accept.mutate()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 text-sm font-medium disabled:opacity-50"
            >
              {accept.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserPlus className="size-4" />
              )}
              Accept invitation
            </button>
            <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3" />
              Expires {expiry.toLocaleString()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

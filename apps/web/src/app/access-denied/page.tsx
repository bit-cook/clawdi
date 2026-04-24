import { SignOutButton } from "@clerk/nextjs";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Generic denial page. Deliberately does not leak *why* — no allowed-domain
 * list, no "request access" affordance, no marketing copy. Just "nope" and
 * a sign-out button. Users who can't see the app shouldn't learn anything
 * from this screen.
 *
 * Renders unconditionally: never redirects back to `/`. The dashboard layout
 * is the only path that should land a user here. A self-redirect turned any
 * cross-render disagreement between `currentUser()` calls into an infinite
 * `/` ↔ `/access-denied` loop in production, so the convenience of auto-
 * returning allowed users who typed the URL directly is not worth the risk.
 */
export default function AccessDeniedPage() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-6 px-6 text-center">
			<ShieldAlert className="size-12 text-muted-foreground" aria-hidden />
			<h1 className="text-xl font-semibold tracking-tight">Access denied</h1>
			<SignOutButton>
				<Button variant="outline">Sign out</Button>
			</SignOutButton>
		</main>
	);
}

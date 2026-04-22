import chalk from "chalk";
import { ApiClient } from "../lib/api-client";
import { isLoggedIn } from "../lib/config";

/**
 * Accept a Clawdi scope invitation.
 * Accepts either a raw token (clawdi_inv_...) or a join URL.
 */
export async function inviteAccept(tokenOrUrl: string) {
	const token = extractToken(tokenOrUrl);
	if (!token) {
		console.log(chalk.red(`Invalid invitation token or URL: ${tokenOrUrl}`));
		console.log(chalk.gray("Expected: clawdi_inv_... or https://.../join/clawdi_inv_..."));
		process.exit(1);
	}

	if (!isLoggedIn()) {
		console.log(chalk.yellow("You're not signed in to Clawdi Cloud."));
		console.log(chalk.gray("  Run `clawdi login` first, then try again."));
		console.log(chalk.gray("  (You'll need an API key from the Clawdi Cloud dashboard.)"));
		process.exit(1);
	}

	const api = new ApiClient();

	// Preview first — so we can show the user what they're about to join.
	try {
		const preview = await api.get<{
			scope_id: string;
			scope_name: string;
			role: string;
			expires_at: string;
			already_member: boolean;
			can_accept: boolean;
			reason: string | null;
			invitee_email: string | null;
		}>(`/api/invitations/${token}`);

		if (preview.already_member) {
			console.log(chalk.green(`You're already a member of "${preview.scope_name}".`));
			console.log(chalk.gray("  View it: clawdi scope list"));
			return;
		}

		if (!preview.can_accept) {
			console.log(chalk.red(`✗ ${preview.reason ?? "This invitation can't be accepted."}`));
			process.exit(1);
		}

		console.log();
		console.log(chalk.white(`Invitation to `) + chalk.bold(preview.scope_name));
		console.log(chalk.gray(`  Role: ${preview.role}`));
		console.log(chalk.gray(`  Expires: ${new Date(preview.expires_at).toLocaleString()}`));
		if (preview.invitee_email) {
			console.log(chalk.gray(`  Bound to: ${preview.invitee_email}`));
		}
		console.log();

		// Accept
		await api.post(`/api/invitations/${token}/accept`);
		console.log(chalk.green(`✓ Joined ${preview.scope_name} as ${preview.role}`));
		console.log();
		console.log(chalk.gray("Next: pick which of your agents should see this scope:"));
		console.log(
			chalk.white(`  clawdi agent scope add <agent> ${preview.scope_name}`),
		);
	} catch (e: any) {
		console.log(chalk.red(`✗ Failed: ${e.message}`));
		process.exit(1);
	}
}

/** Pull the token out of a bare token string or a /join/<token> URL. */
function extractToken(input: string): string | null {
	const trimmed = input.trim();
	if (trimmed.startsWith("clawdi_inv_")) return trimmed;
	const match = trimmed.match(/\/join\/(clawdi_inv_[A-Za-z0-9_-]+)/);
	if (match) return match[1];
	return null;
}

import chalk from "chalk";
import { ApiClient } from "../lib/api-client";
import { readEnvByAgent, readFirstEnv } from "../lib/env-state";

interface Scope {
	id: string;
	name: string;
	owner_user_id: string;
	visibility: string;
	role: string | null;
	created_at: string;
}

export async function scopeCreate(name: string) {
	const api = new ApiClient();
	const scope = await api.post<Scope>("/api/scopes", { name });
	console.log(chalk.green(`Created scope ${chalk.bold(scope.name)}`));
	console.log(chalk.gray(`  id: ${scope.id}`));
}

export async function scopeList() {
	const api = new ApiClient();
	const scopes = await api.get<Scope[]>("/api/scopes");
	if (scopes.length === 0) {
		console.log(chalk.gray("No scopes yet. Create one with: clawdi scope create <name>"));
		return;
	}
	for (const s of scopes) {
		const role = s.role ? chalk.gray(`[${s.role}]`) : "";
		console.log(`  ${chalk.white(s.name.padEnd(28))} ${chalk.gray(s.id)} ${role}`);
	}
}

/**
 * Accept either a UUID or a scope name. If not a UUID, look up by name
 * among scopes the caller is a member of.
 */
async function resolveScopeId(api: ApiClient, nameOrId: string): Promise<string> {
	const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameOrId);
	if (isUuid) return nameOrId;

	const scopes = await api.get<Scope[]>("/api/scopes");
	const match = scopes.filter((s) => s.name === nameOrId);
	if (match.length === 0) {
		throw new Error(`No Scope named "${nameOrId}". Use \`clawdi scope list\` to see your scopes.`);
	}
	if (match.length > 1) {
		throw new Error(
			`Multiple scopes named "${nameOrId}". Use the UUID instead: ${match.map((s) => s.id).join(", ")}`,
		);
	}
	return match[0].id;
}

export async function scopeMembers(nameOrId: string) {
	const api = new ApiClient();
	const scopeId = await resolveScopeId(api, nameOrId);
	const members = await api.get<Array<{ user_id: string; role: string; added_at: string }>>(
		`/api/scopes/${scopeId}/members`,
	);
	if (members.length === 0) {
		console.log(chalk.gray("No members."));
		return;
	}
	for (const m of members) {
		console.log(`  ${m.user_id.slice(0, 8)}  ${chalk.gray(m.role)}`);
	}
}

export async function scopeSubscribe(nameOrId: string, agentType?: string) {
	const env = agentType ? readEnvByAgent(agentType) : readFirstEnv();
	if (!env) {
		console.log(
			chalk.red(
				`No registered environment${agentType ? ` for ${agentType}` : ""}. Run \`clawdi setup\` first.`,
			),
		);
		process.exit(1);
	}
	const api = new ApiClient({ envId: env.environmentId });
	const scopeId = await resolveScopeId(api, nameOrId);
	const result = await api.post<{ status: string }>(
		`/api/environments/${env.environmentId}/scopes/${scopeId}`,
	);
	console.log(
		chalk.green(
			`✓ ${env.agentType} ${result.status === "already_subscribed" ? "already subscribed" : "subscribed"} to ${nameOrId}`,
		),
	);
}

export async function scopeUnsubscribe(nameOrId: string, agentType?: string) {
	const env = agentType ? readEnvByAgent(agentType) : readFirstEnv();
	if (!env) {
		console.log(chalk.red(`No registered environment${agentType ? ` for ${agentType}` : ""}.`));
		process.exit(1);
	}
	const api = new ApiClient({ envId: env.environmentId });
	const scopeId = await resolveScopeId(api, nameOrId);
	try {
		await api.delete(`/api/environments/${env.environmentId}/scopes/${scopeId}`);
		console.log(chalk.green(`✓ ${env.agentType} unsubscribed from ${nameOrId}`));
	} catch (e: any) {
		// Surface the 409 "is default write" error nicely
		if (e?.message?.includes("default write")) {
			console.log(chalk.red(`✗ ${nameOrId} is this agent's default write target.`));
			console.log(chalk.gray("  Change it first: clawdi agent scope default " + env.agentType + " <other-scope|private>"));
			process.exit(1);
		}
		throw e;
	}
}

/**
 * Set the default write scope for an agent.
 * `target` = "private" | scope name | scope UUID
 */
export async function agentSetDefault(agentType: string, target: string) {
	const env = readEnvByAgent(agentType);
	if (!env) {
		console.log(chalk.red(`No registered environment for ${agentType}. Run \`clawdi setup --agent ${agentType}\` first.`));
		process.exit(1);
	}
	const api = new ApiClient({ envId: env.environmentId });

	let scopeValue: string;
	if (target === "private" || target === "none" || target === "") {
		scopeValue = "private";
	} else {
		// Resolve name → UUID if needed
		scopeValue = await resolveScopeId(api, target);
	}

	const result = await api.request<{
		default_write_scope_id: string | null;
		auto_subscribed: boolean;
	}>(
		`/api/environments/${env.environmentId}/default-write-scope`,
		{ method: "PATCH", body: JSON.stringify({ scope_id: scopeValue }) },
	);

	const label = result.default_write_scope_id
		? chalk.cyan(target)
		: chalk.gray("private");
	console.log(chalk.green(`✓ ${env.agentType} default write → ${label}`));
	if (result.auto_subscribed) {
		console.log(chalk.gray(`  (also subscribed ${env.agentType} to ${target} so it can read what it writes)`));
	}
}

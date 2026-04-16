import chalk from "chalk";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { AGENT_TYPES, AGENT_LABELS, type AgentType } from "@clawdi-cloud/shared/consts";
import { ClaudeCodeAdapter } from "../adapters/claude-code";
import type { AgentAdapter } from "../adapters/base";
import { ApiClient } from "../lib/api-client";
import { getClawdiDir, isLoggedIn } from "../lib/config";

const allAdapters: AgentAdapter[] = [new ClaudeCodeAdapter()];

export async function setup(opts: { agent?: string }) {
	if (!isLoggedIn()) {
		console.log(chalk.red("Not logged in. Run `clawdi login` first."));
		return;
	}

	const machineId = createHash("sha256")
		.update(`${hostname()}-${process.platform}-${process.arch}`)
		.digest("hex")
		.slice(0, 16);
	const machineName = hostname();
	const api = new ApiClient();

	// If --agent specified, only register that one
	if (opts.agent) {
		if (!AGENT_TYPES.includes(opts.agent as AgentType)) {
			console.log(chalk.red(`Unknown agent type: ${opts.agent}`));
			console.log(chalk.gray(`Valid types: ${AGENT_TYPES.join(", ")}`));
			return;
		}
		await registerEnv(api, opts.agent as AgentType, null, machineId, machineName);
		return;
	}

	// Auto-detect all installed agents
	console.log(chalk.cyan("Detecting installed agents..."));
	const detected: { adapter: AgentAdapter; version: string | null }[] = [];

	for (const adapter of allAdapters) {
		if (await adapter.detect()) {
			const version = await adapter.getVersion();
			detected.push({ adapter, version });
			console.log(
				chalk.green(`  ✓ ${AGENT_LABELS[adapter.agentType]}${version ? ` (${version})` : ""}`),
			);
		}
	}

	if (detected.length === 0) {
		console.log(chalk.yellow("  No supported agents detected."));
		console.log(chalk.gray("  Use --agent to specify manually."));
		return;
	}

	console.log();

	// Register all detected agents
	for (const { adapter, version } of detected) {
		await registerEnv(api, adapter.agentType, version, machineId, machineName);
	}
}

async function registerEnv(
	api: ApiClient,
	agentType: AgentType,
	agentVersion: string | null,
	machineId: string,
	machineName: string,
) {
	try {
		const env = await api.post<{ id: string }>("/api/environments", {
			machine_id: machineId,
			machine_name: machineName,
			agent_type: agentType,
			agent_version: agentVersion,
			os: process.platform,
		});

		// Save environment locally
		const envDir = join(getClawdiDir(), "environments");
		mkdirSync(envDir, { recursive: true });
		writeFileSync(
			join(envDir, `${agentType}.json`),
			JSON.stringify({ id: env.id, agentType, machineId, machineName }, null, 2) + "\n",
			{ mode: 0o600 },
		);

		console.log(chalk.green(`✓ ${AGENT_LABELS[agentType]} registered (${env.id.slice(0, 8)})`));
	} catch (e: any) {
		console.log(chalk.red(`  Failed to register ${AGENT_LABELS[agentType]}: ${e.message}`));
	}
}

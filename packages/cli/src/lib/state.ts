import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { AgentType } from "../adapters/registry";
import { getClawdiDir } from "./config";

/**
 * Per-module activity timestamps tracked in `~/.clawdi/state.json`.
 * Both `push` and `pull` update the relevant module's `lastActivityAt`.
 * `push --since` uses it as an incremental cursor when no explicit
 * `--since` is supplied.
 */
export interface ModuleState {
	[module: string]: {
		lastActivityAt: string;
	};
}

const STATE_FILE = "state.json";

/**
 * Read `~/.clawdi/state.json` — per-module last-activity timestamps.
 * Tolerates a corrupt file by warning and resetting to {}; the next push/pull
 * rewrites it cleanly.
 */
export function readModuleState(): ModuleState {
	const path = join(getClawdiDir(), STATE_FILE);
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		console.log(chalk.yellow(`⚠ ~/.clawdi/${STATE_FILE} is corrupted; resetting.`));
		return {};
	}
}

export function writeModuleState(state: ModuleState) {
	const path = join(getClawdiDir(), STATE_FILE);
	writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Per-agent session sync cursor. Earlier versions stored a single shared
 * `sessions.lastActivityAt` across all agents — Claude Code's push would
 * advance Codex's cursor. Now each agent's cursor lives under
 * `sessions:<agentType>`. Reads fall back to the legacy key for users
 * upgrading from the shared-cursor era.
 */
export function readSessionCursor(state: ModuleState, agentType: AgentType): string | undefined {
	return state[`sessions:${agentType}`]?.lastActivityAt ?? state.sessions?.lastActivityAt;
}

export function writeSessionCursor(state: ModuleState, agentType: AgentType, isoTs: string) {
	state[`sessions:${agentType}`] = { lastActivityAt: isoTs };
}

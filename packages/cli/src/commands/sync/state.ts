import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SyncState } from "@clawdi-cloud/shared/types";
import { getClawdiDir } from "../../lib/config";

export function getSyncState(): SyncState {
	const syncPath = join(getClawdiDir(), "sync.json");
	if (!existsSync(syncPath)) return {};
	try {
		return JSON.parse(readFileSync(syncPath, "utf-8"));
	} catch {
		console.log(chalk.yellow("⚠ ~/.clawdi/sync.json is corrupted; resetting."));
		return {};
	}
}

export function saveSyncState(state: SyncState) {
	const syncPath = join(getClawdiDir(), "sync.json");
	writeFileSync(syncPath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}

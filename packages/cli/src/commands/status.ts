import chalk from "chalk";
import type { SyncState } from "@clawdi-cloud/shared/types";
import { getAuth, getConfig, isLoggedIn } from "../lib/config";
import { getSyncState } from "./sync/state";

interface StatusJson {
	loggedIn: boolean;
	user?: { email?: string; id?: string };
	apiUrl: string;
	sync: Record<string, { lastSyncedAt: string }>;
}

function buildStatus(): StatusJson {
	const config = getConfig();
	const auth = getAuth();
	const sync = (getSyncState() ?? {}) as SyncState;
	const entries: Record<string, { lastSyncedAt: string }> = {};
	for (const [k, v] of Object.entries(sync)) {
		if (v && typeof v === "object" && "lastSyncedAt" in v && typeof v.lastSyncedAt === "string") {
			entries[k] = { lastSyncedAt: v.lastSyncedAt };
		}
	}
	return {
		loggedIn: isLoggedIn(),
		user: auth ? { email: auth.email, id: auth.userId } : undefined,
		apiUrl: config.apiUrl,
		sync: entries,
	};
}

export async function status(opts: { json?: boolean } = {}) {
	const s = buildStatus();

	if (opts.json || !process.stdout.isTTY) {
		console.log(JSON.stringify(s, null, 2));
		return;
	}

	console.log(chalk.bold("Clawdi Cloud Status"));
	console.log();

	if (s.loggedIn) {
		console.log(chalk.green("  Auth:    ✓ logged in"));
		console.log(chalk.gray(`  User:    ${s.user?.email || s.user?.id || "unknown"}`));
		console.log(chalk.gray(`  API:     ${s.apiUrl}`));
	} else {
		console.log(chalk.red("  Auth:    ✗ not logged in"));
		console.log(chalk.gray("  Run `clawdi auth login` to authenticate."));
	}

	console.log();

	const syncEntries = Object.entries(s.sync);
	if (syncEntries.length > 0) {
		console.log(chalk.bold("  Sync:"));
		for (const [module, state] of syncEntries) {
			const ago = timeSince(new Date(state.lastSyncedAt));
			console.log(chalk.gray(`    ${module}: last synced ${ago}`));
		}
	} else {
		console.log(chalk.gray("  Sync:    no sync history"));
	}
}

function timeSince(date: Date): string {
	const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

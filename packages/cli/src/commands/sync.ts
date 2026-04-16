import * as p from "@clack/prompts";
import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SyncState } from "@clawdi-cloud/shared/types";
import { ClaudeCodeAdapter } from "../adapters/claude-code";
import type { RawSession, RawSkill } from "../adapters/base";
import { ApiClient } from "../lib/api-client";
import { getClawdiDir, isLoggedIn } from "../lib/config";

function getEnvIdByAgent(agentType: string): string | null {
	const envPath = join(getClawdiDir(), "environments", `${agentType}.json`);
	if (!existsSync(envPath)) return null;
	return JSON.parse(readFileSync(envPath, "utf-8")).id;
}

function getSyncState(): SyncState {
	const syncPath = join(getClawdiDir(), "sync.json");
	if (!existsSync(syncPath)) return {};
	return JSON.parse(readFileSync(syncPath, "utf-8"));
}

function saveSyncState(state: SyncState) {
	const syncPath = join(getClawdiDir(), "sync.json");
	writeFileSync(syncPath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
}

const UP_MODULES = [
	{ value: "sessions", label: "Sessions", hint: "agent conversation history" },
	{ value: "skills", label: "Skills", hint: "SKILL.md files" },
];

const DOWN_MODULES = [
	{ value: "skills", label: "Skills", hint: "pull SKILL.md to agent directories" },
];

export async function syncUp(opts: {
	modules?: string;
	since?: string;
	project?: string;
	all?: boolean;
	dryRun?: boolean;
}) {
	if (!opts.dryRun && !isLoggedIn()) {
		console.log(chalk.red("Not logged in. Run `clawdi login` first."));
		return;
	}

	const adapter = new ClaudeCodeAdapter();
	if (!(await adapter.detect())) {
		console.log(chalk.red("Claude Code not detected on this machine."));
		return;
	}

	const envId = getEnvIdByAgent(adapter.agentType);
	if (!opts.dryRun && !envId) {
		console.log(chalk.red("No environment registered. Run `clawdi setup` first."));
		return;
	}

	// 1. Select modules
	let modules: string[];
	if (opts.modules) {
		modules = opts.modules.split(",");
	} else {
		const selected = await p.multiselect({
			message: "Select modules to upload (space to toggle, enter to confirm)",
			options: UP_MODULES,
			initialValues: UP_MODULES.map((m) => m.value),
		});
		if (p.isCancel(selected) || selected.length === 0) {
			p.cancel("Cancelled.");
			return;
		}
		modules = selected;
	}

	// 2. Scan data
	const syncState = getSyncState();
	const since = opts.since
		? new Date(opts.since)
		: syncState.sessions?.lastSyncedAt
			? new Date(syncState.sessions.lastSyncedAt)
			: undefined;
	const projectFilter = opts.all ? undefined : (opts.project ?? process.cwd());

	let sessions: RawSession[] = [];
	let skills: RawSkill[] = [];

	const spin = p.spinner();
	spin.start("Scanning local data...");

	if (modules.includes("sessions")) {
		sessions = await adapter.collectSessions(since, projectFilter);
	}
	if (modules.includes("skills")) {
		skills = await adapter.collectSkills();
	}

	spin.stop("Scan complete");

	// 3. Summary
	const summary: string[] = [];
	if (modules.includes("sessions")) {
		summary.push(`Sessions: ${sessions.length} to upload`);
	}
	if (modules.includes("skills")) {
		summary.push(`Skills: ${skills.length} to upload`);
	}

	p.note(summary.join("\n"), "Summary");

	if (sessions.length === 0 && skills.length === 0) {
		p.outro("Nothing to sync.");
		return;
	}

	// 4. Confirm
	if (!opts.dryRun) {
		const ok = await p.confirm({ message: "Proceed with upload?" });
		if (p.isCancel(ok) || !ok) {
			p.cancel("Cancelled.");
			return;
		}
	}

	if (opts.dryRun) {
		p.outro("Dry run complete.");
		return;
	}

	// 5. Execute
	const api = new ApiClient();

	if (sessions.length > 0) {
		const spin2 = p.spinner();
		spin2.start(`Uploading ${sessions.length} sessions...`);
		try {
			const result = await api.post<{ synced: number }>("/api/sessions/batch", {
				sessions: sessions.map((s) => ({
					environment_id: envId,
					local_session_id: s.localSessionId,
					project_path: s.projectPath,
					started_at: s.startedAt.toISOString(),
					ended_at: s.endedAt?.toISOString() ?? null,
					duration_seconds: s.durationSeconds,
					message_count: s.messageCount,
					input_tokens: s.inputTokens,
					output_tokens: s.outputTokens,
					cache_read_tokens: s.cacheReadTokens,
					model: s.model,
					models_used: s.modelsUsed,
					summary: s.summary,
					status: "completed",
				})),
			});
			spin2.stop(`Synced ${result.synced} sessions`);
		} catch (e: any) {
			spin2.stop(`Failed: ${e.message}`);
		}
		syncState.sessions = { lastSyncedAt: new Date().toISOString() };
	}

	if (skills.length > 0) {
		const spin3 = p.spinner();
		spin3.start(`Uploading ${skills.length} skills...`);
		try {
			const result = await api.post<{ synced: number }>("/api/skills/batch", {
				skills: skills.map((s) => ({
					skill_key: s.skillKey,
					name: s.name,
					content: s.content,
				})),
			});
			spin3.stop(`Synced ${result.synced} skills`);
		} catch (e: any) {
			spin3.stop(`Failed: ${e.message}`);
		}
		syncState.skills = { lastSyncedAt: new Date().toISOString() };
	}

	saveSyncState(syncState);
	p.outro("Sync complete");
}

export async function syncDown(opts: { modules?: string; dryRun?: boolean }) {
	if (!isLoggedIn()) {
		console.log(chalk.red("Not logged in. Run `clawdi login` first."));
		return;
	}

	const adapter = new ClaudeCodeAdapter();
	const api = new ApiClient();

	// 1. Select modules
	let modules: string[];
	if (opts.modules) {
		modules = opts.modules.split(",");
	} else {
		const selected = await p.multiselect({
			message: "Select modules to download (space to toggle, enter to confirm)",
			options: DOWN_MODULES,
			initialValues: DOWN_MODULES.map((m) => m.value),
		});
		if (p.isCancel(selected) || selected.length === 0) {
			p.cancel("Cancelled.");
			return;
		}
		modules = selected;
	}

	// 2. Scan cloud data
	let cloudSkills: Array<{ skill_key: string; name: string; content?: string }> = [];

	const spin = p.spinner();
	spin.start("Fetching from cloud...");

	if (modules.includes("skills")) {
		cloudSkills = await api.get("/api/skills?include_content=true");
	}

	spin.stop("Fetch complete");

	// 3. Summary
	const summary: string[] = [];
	if (modules.includes("skills")) {
		const newCount = cloudSkills.filter(
			(s) => s.content && !existsSync(adapter.getSkillPath(s.skill_key)),
		).length;
		const existingCount = cloudSkills.filter(
			(s) => s.content && existsSync(adapter.getSkillPath(s.skill_key)),
		).length;
		summary.push(
			`Skills: ${cloudSkills.length} in cloud (${newCount} new, ${existingCount} existing)`,
		);
	}

	p.note(summary.join("\n"), "Summary");

	if (cloudSkills.length === 0) {
		p.outro("Nothing to download.");
		return;
	}

	// 4. Confirm
	if (!opts.dryRun) {
		const ok = await p.confirm({ message: "Proceed with download?" });
		if (p.isCancel(ok) || !ok) {
			p.cancel("Cancelled.");
			return;
		}
	}

	if (opts.dryRun) {
		p.outro("Dry run complete.");
		return;
	}

	// 5. Execute
	if (cloudSkills.length > 0) {
		let pulled = 0;
		for (const skill of cloudSkills) {
			if (!skill.content) continue;
			const dest = adapter.getSkillPath(skill.skill_key);
			if (existsSync(dest)) {
				const overwrite = await p.confirm({
					message: `${skill.skill_key} already exists. Overwrite?`,
					initialValue: false,
				});
				if (p.isCancel(overwrite) || !overwrite) {
					console.log(chalk.gray(`    ${skill.skill_key} skipped`));
					continue;
				}
			}
			await adapter.writeSkill(skill.skill_key, skill.content);
			console.log(chalk.gray(`    ${skill.skill_key} → ${dest}`));
			pulled++;
		}
		p.outro(`Pulled ${pulled} skills`);
	}
}

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getClawdiDir } from "./config";

export interface EnvRecord {
	environmentId: string;
	agentType: string;
	machineId: string;
	machineName: string;
}

/** Read the first environment record found under ~/.clawdi/environments/ */
export function readFirstEnv(): EnvRecord | null {
	const dir = join(getClawdiDir(), "environments");
	if (!existsSync(dir)) return null;
	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".json")) continue;
		const raw = readFileSync(join(dir, file), "utf-8");
		try {
			const data = JSON.parse(raw);
			if (data.environmentId || data.id) {
				return {
					environmentId: data.environmentId ?? data.id,
					agentType: data.agentType ?? file.replace(".json", ""),
					machineId: data.machineId ?? "",
					machineName: data.machineName ?? "",
				};
			}
		} catch {
			continue;
		}
	}
	return null;
}

/** Pick env by agent type (claude_code, codex, etc.) */
export function readEnvByAgent(agentType: string): EnvRecord | null {
	const path = join(getClawdiDir(), "environments", `${agentType}.json`);
	if (!existsSync(path)) return null;
	try {
		const data = JSON.parse(readFileSync(path, "utf-8"));
		return {
			environmentId: data.environmentId ?? data.id,
			agentType,
			machineId: data.machineId ?? "",
			machineName: data.machineName ?? "",
		};
	} catch {
		return null;
	}
}

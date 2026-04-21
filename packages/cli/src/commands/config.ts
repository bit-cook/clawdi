import chalk from "chalk";
import {
	CONFIG_KEYS,
	type ConfigKey,
	getStoredConfig,
	setConfigKey,
	unsetConfigKey,
} from "../lib/config";

function isKnownKey(k: string): k is ConfigKey {
	return (CONFIG_KEYS as readonly string[]).includes(k);
}

function unknownKey(k: string) {
	console.log(chalk.red(`Unknown config key: ${k}`));
	console.log(chalk.gray(`  Known keys: ${CONFIG_KEYS.join(", ")}`));
}

export function configList() {
	const stored = getStoredConfig();
	if (Object.keys(stored).length === 0) {
		console.log(chalk.gray("(no configuration set — using defaults)"));
	} else {
		for (const [k, v] of Object.entries(stored)) {
			console.log(`  ${chalk.cyan(k)} = ${v}`);
		}
	}

	// Surface the env override so users aren't confused by a set-in-disk
	// value being ignored at runtime.
	if (process.env.CLAWDI_API_URL) {
		console.log();
		console.log(
			chalk.gray(`  note: CLAWDI_API_URL=${process.env.CLAWDI_API_URL} overrides apiUrl`),
		);
	}
}

export function configGet(key: string) {
	if (!isKnownKey(key)) {
		unknownKey(key);
		process.exit(1);
	}
	const value = getStoredConfig()[key];
	if (value === undefined) {
		// Exit code 1 matches `git config --get` behavior for unset keys.
		process.exit(1);
	}
	console.log(value);
}

export function configSet(key: string, value: string) {
	if (!isKnownKey(key)) {
		unknownKey(key);
		process.exit(1);
	}
	setConfigKey(key, value);
	console.log(chalk.green(`✓ Set ${key}`));
}

export function configUnset(key: string) {
	if (!isKnownKey(key)) {
		unknownKey(key);
		process.exit(1);
	}
	unsetConfigKey(key);
	console.log(chalk.green(`✓ Unset ${key}`));
}

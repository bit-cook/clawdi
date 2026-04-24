import * as p from "@clack/prompts";
import chalk from "chalk";
import { isInteractive } from "./tty";

export type SelectOption<T extends string> = { value: T; label: string; hint?: string };

function toClackOptions<T extends string>(
	options: SelectOption<T>[],
): Array<{ value: T; label: string; hint?: string }> {
	return options.map((o) => {
		const base: { value: T; label: string; hint?: string } = {
			value: o.value,
			label: o.label,
		};
		if (o.hint) base.hint = o.hint;
		return base;
	});
}

export async function askYesNo(message: string, def = true): Promise<boolean> {
	if (!isInteractive()) return def;
	const result = await p.confirm({ message, initialValue: def });
	if (p.isCancel(result)) {
		p.cancel("Cancelled.");
		process.exit(0);
	}
	return result as boolean;
}

export async function askMulti<T extends string>(
	message: string,
	options: SelectOption<T>[],
	defaultSelected?: T[],
): Promise<T[] | null> {
	if (!isInteractive()) {
		return defaultSelected ?? options.map((o) => o.value);
	}
	const initial = defaultSelected ?? options.map((o) => o.value);
	// biome-ignore lint/suspicious/noExplicitAny: @clack/prompts Option<T> uses conditional types that don't flow through generics
	const result = await p.multiselect({
		message,
		options: toClackOptions(options) as any,
		initialValues: initial,
		required: false,
	});
	if (p.isCancel(result)) return null;
	return result as T[];
}

export async function askOne<T extends string>(
	message: string,
	options: SelectOption<T>[],
): Promise<T | null> {
	if (!isInteractive()) return null;
	// biome-ignore lint/suspicious/noExplicitAny: @clack/prompts Option<T> uses conditional types that don't flow through generics
	const result = await p.select({
		message,
		options: toClackOptions(options) as any,
	});
	if (p.isCancel(result)) return null;
	return result as T;
}

export function parseModules(
	input: string | undefined,
	available: Array<{ value: string }>,
): string[] | null {
	if (!input) return available.map((o) => o.value);
	const chosen = input
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const valid = new Set(available.map((o) => o.value));
	const invalid = chosen.filter((c) => !valid.has(c));
	if (invalid.length > 0) {
		console.log(chalk.red(`Unknown module(s): ${invalid.join(", ")}`));
		console.log(chalk.gray(`  Valid: ${available.map((o) => o.value).join(", ")}`));
		return null;
	}
	if (chosen.length === 0) return null;
	return chosen;
}

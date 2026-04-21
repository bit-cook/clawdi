import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ApiClient } from "../lib/api-client";
import { isLoggedIn } from "../lib/config";

interface McpTool {
	name: string;
	description: string;
	parameters?: {
		properties: Record<string, any>;
		required: string[];
	};
}

export async function startMcpServer() {
	if (!isLoggedIn()) {
		process.stderr.write("Not logged in. Run `clawdi login` first.\n");
		process.exit(1);
	}

	const api = new ApiClient();

	// Get MCP proxy config — override mcp_url with local apiUrl
	const { getConfig } = await import("../lib/config");
	const cliConfig = getConfig();
	let mcpConfig: { mcp_url: string; mcp_token: string } | null = null;
	try {
		const raw = await api.get<{ mcp_url: string; mcp_token: string }>("/api/connectors/mcp-config");
		// Backend returns localhost URL which may not work in containers;
		// use the CLI's configured apiUrl instead
		raw.mcp_url = `${cliConfig.apiUrl}/api/mcp/proxy`;
		mcpConfig = raw;
	} catch {
		process.stderr.write(
			"Warning: Could not get MCP proxy config. Connector tools unavailable.\n",
		);
	}

	// Fetch available tools from backend (user's connected apps)
	let remoteTools: McpTool[] = [];
	if (mcpConfig) {
		try {
			const resp = await fetch(mcpConfig.mcp_url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${mcpConfig.mcp_token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/list",
					params: {},
				}),
			});
			const result = await resp.json();
			remoteTools = result.result?.tools ?? [];
			process.stderr.write(
				`Loaded ${remoteTools.length} connector tools.\n`,
			);
		} catch (e: any) {
			process.stderr.write(
				`Warning: Could not fetch connector tools: ${e.message}\n`,
			);
		}
	}

	const server = new McpServer({
		name: "clawdi-cloud",
		version: "0.0.1",
	});

	// --- Clawdi native tools ---

	server.tool(
		"memory_search",
		"Search the user's long-term memory across all their agents for prior context — facts, preferences, decisions, patterns, past work, personal details. Call this PROACTIVELY at the START of any task whenever the user mentions a person, place, project, repo, technology, past issue, or their own preference — even when they don't explicitly ask to search memory. Also call it when the user says things like 'as I mentioned', 'like last time', 'you know', or references something by name. Do NOT call for generic programming questions with no user-specific context.",
		{
			query: z
				.string()
				.describe(
					"Natural-language query or entity name. Examples: \"user's name\", \"coding style preference\", \"how we fixed the login bug\", \"deployment pipeline\", \"what editor does the user prefer\".",
				),
			limit: z
				.number()
				.optional()
				.describe("Max results (default 10)."),
		},
		async ({ query, limit }) => {
			try {
				const results = await api.get<any[]>(
					`/api/memories?q=${encodeURIComponent(query)}&limit=${limit ?? 10}`,
				);
				return {
					content: [
						{
							type: "text" as const,
							text: results.length
								? results
										.map(
											(m: any) =>
												`[${m.category}] ${m.content}`,
										)
										.join("\n\n")
								: "No memories found.",
						},
					],
				};
			} catch (e: any) {
				return {
					content: [
						{ type: "text" as const, text: `Error: ${e.message}` },
					],
				};
			}
		},
	);

	server.tool(
		"memory_add",
		"Store a durable memory for cross-agent recall. Use AFTER you learn something non-obvious about the user or their project that a future session would benefit from knowing: a preference they expressed, a non-trivial bug you fixed with its root cause, an architecture decision and its reasoning, a recurring pattern or team convention, or when the user explicitly says 'remember this'. Do NOT save trivia obvious from the code, or generic programming facts.",
		{
			content: z
				.string()
				.describe(
					"The memory content. Write it as a standalone sentence that makes sense in isolation (include names/context, not just pronouns). Examples: \"The user prefers rg over grep and fd over find.\", \"We chose Clerk over Auth0 because the team already had a Clerk account.\", \"The login bug on 2026-04-15 was caused by a stale JWT cache in the middleware.\"",
				),
			category: z
				.enum([
					"fact",
					"preference",
					"pattern",
					"decision",
					"context",
				])
				.optional()
				.describe(
					"fact — technical facts, API details, config values. preference — user preferences, coding style, workflow choices. pattern — recurring patterns, pitfalls, team conventions. decision — architecture decisions and their reasoning. context — project context, deadlines, ongoing work. Default: fact.",
				),
		},
		async ({ content, category }) => {
			try {
				const result = await api.post<{ id: string }>(
					"/api/memories",
					{
						content,
						category: category ?? "fact",
					},
				);
				return {
					content: [
						{
							type: "text" as const,
							text: `Memory stored (${result.id.slice(0, 8)})`,
						},
					],
				};
			} catch (e: any) {
				return {
					content: [
						{ type: "text" as const, text: `Error: ${e.message}` },
					],
				};
			}
		},
	);

	// --- Dynamically registered connector tools (from Composio via backend) ---

	if (mcpConfig && remoteTools.length > 0) {
		const callTool = async (
			toolName: string,
			args: Record<string, unknown>,
		) => {
			const resp = await fetch(mcpConfig!.mcp_url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${mcpConfig!.mcp_token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: Date.now(),
					method: "tools/call",
					params: { name: toolName, arguments: args },
				}),
			});
			const result = await resp.json();
			if (result.error) {
				throw new Error(JSON.stringify(result.error));
			}
			return result.result ?? result;
		};

		for (const tool of remoteTools) {
			// Build Zod schema from Composio parameter definitions
			const schema: Record<string, z.ZodTypeAny> = {};
			if (tool.parameters?.properties) {
				for (const [key, prop] of Object.entries(tool.parameters.properties)) {
					const desc = (prop as any).description || key;
					const isRequired = tool.parameters.required?.includes(key);
					let field: z.ZodTypeAny;
					switch ((prop as any).type) {
						case "integer":
						case "number":
							field = z.number().describe(desc);
							break;
						case "boolean":
							field = z.boolean().describe(desc);
							break;
						case "array":
							field = z.array(z.any()).describe(desc);
							break;
						case "object":
							field = z.record(z.string(), z.any()).describe(desc);
							break;
						default:
							field = z.string().describe(desc);
					}
					schema[key] = isRequired ? field : field.optional();
				}
			}

			// Fallback: if no parameters, accept a generic JSON string
			const hasSchema = Object.keys(schema).length > 0;
			const toolSchema = hasSchema
				? schema
				: {
						arguments: z
							.string()
							.optional()
							.describe("JSON string of tool arguments"),
					};

			server.tool(
				tool.name.toLowerCase(),
				tool.description || tool.name,
				toolSchema,
				async (params) => {
					try {
						const args = hasSchema
							? params
							: (params as any).arguments
								? JSON.parse((params as any).arguments)
								: {};
						const result = await callTool(tool.name, args as Record<string, unknown>);
						return {
							content: [
								{
									type: "text" as const,
									text:
										typeof result === "string"
											? result
											: JSON.stringify(result, null, 2),
								},
							],
						};
					} catch (e: any) {
						return {
							content: [
								{
									type: "text" as const,
									text: `Error: ${e.message}`,
								},
							],
						};
					}
				},
			);
		}
	}

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

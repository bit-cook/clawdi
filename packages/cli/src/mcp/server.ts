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
		"Search memories across all your agents",
		{
			query: z.string().describe("Search query"),
			limit: z.number().optional().describe("Max results (default 10)"),
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
		"Store a memory for cross-agent recall",
		{
			content: z.string().describe("The memory content to store"),
			category: z
				.enum([
					"fact",
					"preference",
					"pattern",
					"decision",
					"context",
				])
				.optional()
				.describe("Category (default: fact)"),
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

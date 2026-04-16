import { getAuth, getConfig } from "./config";

export class ApiClient {
	private baseUrl: string;
	private apiKey: string;

	constructor() {
		const config = getConfig();
		const auth = getAuth();
		if (!auth) {
			throw new Error("Not logged in. Run `clawdi login` first.");
		}
		this.baseUrl = config.apiUrl;
		this.apiKey = auth.apiKey;
	}

	async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			...options,
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
				...options.headers,
			},
		});

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`API error ${res.status}: ${text}`);
		}

		return res.json();
	}

	async get<T>(path: string): Promise<T> {
		return this.request<T>(path);
	}

	async post<T>(path: string, body?: unknown): Promise<T> {
		return this.request<T>(path, {
			method: "POST",
			body: body ? JSON.stringify(body) : undefined,
		});
	}

	async delete<T>(path: string): Promise<T> {
		return this.request<T>(path, { method: "DELETE" });
	}

	async uploadFile<T>(
		path: string,
		fields: Record<string, string>,
		file: Buffer,
		filename: string,
	): Promise<T> {
		const formData = new FormData();
		for (const [k, v] of Object.entries(fields)) {
			formData.append(k, v);
		}
		formData.append("file", new Blob([new Uint8Array(file)]), filename);

		const url = `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			method: "POST",
			headers: { Authorization: `Bearer ${this.apiKey}` },
			body: formData,
		});

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`API error ${res.status}: ${text}`);
		}

		return res.json();
	}

	async getBytes(path: string): Promise<Buffer> {
		const url = `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${this.apiKey}` },
		});

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`API error ${res.status}: ${text}`);
		}

		return Buffer.from(await res.arrayBuffer());
	}
}

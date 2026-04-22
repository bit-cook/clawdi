const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail || `API ${status}`);
    this.status = status;
    this.detail = detail;
    this.name = "ApiError";
  }
}

/**
 * Extract the human-readable message from a FastAPI error body.
 * FastAPI returns `{ "detail": "..." }` for HTTPException, and
 * `{ "detail": [ {...}, ... ] }` for validation errors.
 */
function parseDetail(body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.detail === "string") return parsed.detail;
    if (Array.isArray(parsed?.detail) && parsed.detail[0]?.msg) {
      return parsed.detail[0].msg;
    }
    return body;
  } catch {
    return body;
  }
}

export async function apiFetch<T>(
  path: string,
  token: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, parseDetail(body));
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

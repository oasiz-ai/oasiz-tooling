import { getApiUrl } from "./auth.ts";

export interface StudioDraft {
  id: string;
  label: string;
  r2Key?: string | null;
  createdAt: string;
  isLive?: boolean;
  isPublic?: boolean;
}

export interface MyGameItem {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  isPublic?: boolean;
  isReviewed?: boolean;
  activeVersionId?: string | null;
  rootGameId?: string | null;
  parentId?: string | null;
  createdAt?: string | null;
  slug?: string | null;
  updatedAt?: string | null;
  draftCount?: number | null;
  liveLabel?: string | null;
}

export interface LegacyMyGamesResponse {
  ok: boolean;
  games: MyGameItem[];
}

export type MyGamesResponse = MyGameItem[] | LegacyMyGamesResponse;

export interface PublishLiveResponse {
  ok: boolean;
  rootId?: string;
  versionId?: string;
  error?: string;
}

interface ApiOptions {
  method?: "GET" | "POST";
  token?: string;
  body?: unknown;
}

function summarizeErrorBody(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "(empty response body)";
  const limit = 240;
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "...";
}

async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const requestUrl = getApiUrl(path);
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.Authorization = "Bearer " + options.token;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: options.method || "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error("Unable to connect to API.\nTarget URL: " + requestUrl + "\nCause: " + details);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      "Request failed (" +
        response.status +
        ") for " +
        requestUrl +
        ". Response preview: " +
        summarizeErrorBody(text),
    );
  }

  return (await response.json()) as T;
}

export async function getMyGames(
  token: string,
  options: { includeVersions?: boolean; limit?: number } = {},
): Promise<MyGameItem[]> {
  const query = new URLSearchParams();
  if (options.includeVersions) query.set("includeVersions", "true");
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  const path = "/api/games/mine" + (query.size > 0 ? "?" + query.toString() : "");
  const response = await apiRequest<MyGamesResponse>(path, { token });
  return Array.isArray(response) ? response : response.games || [];
}

export async function postPublishLive(gameId: string, versionId: string, token: string): Promise<PublishLiveResponse> {
  return apiRequest<PublishLiveResponse>("/api/games/" + encodeURIComponent(gameId) + "/publish-live", {
    method: "POST",
    token,
    body: { versionId },
  });
}

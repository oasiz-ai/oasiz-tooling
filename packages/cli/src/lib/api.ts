import { getApiUrl } from "./auth.ts";

export interface PreflightGame {
  id: string;
  title: string;
  r2Key?: string | null;
  slug?: string | null;
}

export interface StudioDraft {
  id: string;
  label: string;
  r2Key?: string | null;
  createdAt: string;
  isLive?: boolean;
}

export interface UploadPreflightResponse {
  ok: boolean;
  game: PreflightGame | null;
  drafts: StudioDraft[];
}

export interface UploadGamePayload {
  title: string;
  slug: string;
  description: string;
  category: string;
  email?: string;
  gameId?: string;
  isMultiplayer?: boolean;
  maxPlayers?: number;
  verticalOnly?: boolean;
  thumbnailBase64?: string;
  bundleHtml: string;
  assets?: Record<string, string>;
  activate?: boolean;
}

export interface UploadGameResponse {
  ok: boolean;
  gameId: string;
  draftId: string;
  label: string;
  activated: boolean;
}

export interface ActivateDraftResponse {
  ok: boolean;
  label?: string;
}

export interface MyGameItem {
  id: string;
  title: string;
  slug?: string | null;
  updatedAt?: string | null;
  draftCount?: number | null;
  liveLabel?: string | null;
}

export interface MyGamesResponse {
  ok: boolean;
  games: MyGameItem[];
}

interface ApiOptions {
  method?: "GET" | "POST";
  token?: string;
  body?: unknown;
}

async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.Authorization = "Bearer " + options.token;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(getApiUrl(path), {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error("Request failed (" + response.status + "): " + text);
  }

  return (await response.json()) as T;
}

export async function getUploadPreflight(title: string, token: string): Promise<UploadPreflightResponse> {
  const query = new URLSearchParams({ title }).toString();
  return apiRequest<UploadPreflightResponse>("/api/upload/preflight?" + query, { token });
}

export async function postUploadGame(payload: UploadGamePayload, token: string): Promise<UploadGameResponse> {
  return apiRequest<UploadGameResponse>("/api/upload/game", {
    method: "POST",
    token,
    body: payload,
  });
}

export async function postActivateDraft(draftId: string, token: string): Promise<ActivateDraftResponse> {
  return apiRequest<ActivateDraftResponse>("/api/upload/activate", {
    method: "POST",
    token,
    body: { draftId },
  });
}

export async function getMyGames(token: string): Promise<MyGamesResponse> {
  return apiRequest<MyGamesResponse>("/api/games/mine", { token });
}

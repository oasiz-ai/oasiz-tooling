import { existsSync, mkdirSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getProjectRoot } from "./runtime.ts";

export interface StoredCredentials {
  token: string;
  email?: string;
  createdAt: string;
}

const DEFAULT_API_BASE = "https://api.oasiz.ai";
const DEFAULT_WEB_BASE = "https://oasiz.ai";

function normalizeApiBase(raw: string): string {
  let value = raw.trim();
  if (!value) return DEFAULT_API_BASE;

  if (value.endsWith("/api/upload/game")) {
    value = value.slice(0, -"/api/upload/game".length);
  } else if (value.endsWith("/api")) {
    value = value.slice(0, -"/api".length);
  }

  return value.replace(/\/+$/, "");
}

function getWorkspaceCredentialsPath(): string {
  return join(getProjectRoot(), ".oasiz", "credentials.json");
}

export function getApiBaseUrl(): string {
  const raw = process.env.OASIZ_API_URL || "";
  if (!raw) return DEFAULT_API_BASE;
  return normalizeApiBase(raw);
}

export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : "/" + path;
  return getApiBaseUrl() + cleanPath;
}

export function getWebBaseUrl(): string {
  const explicit = process.env.OASIZ_WEB_URL;
  if (explicit && explicit.trim()) {
    return explicit.replace(/\/+$/, "");
  }

  const explicitApi = process.env.OASIZ_API_URL;
  if (explicitApi && explicitApi.trim()) {
    const apiBase = normalizeApiBase(explicitApi);
    if (apiBase.startsWith("https://api.")) {
      return apiBase.replace("https://api.", "https://");
    }
    if (apiBase.startsWith("http://api.")) {
      return apiBase.replace("http://api.", "http://");
    }
  }

  return DEFAULT_WEB_BASE;
}

export function getCredentialsPath(): string {
  const explicitPath = process.env.OASIZ_CREDENTIALS_PATH;
  if (explicitPath) {
    return explicitPath;
  }

  const codexHome = process.env.CODEX_HOME;
  if (codexHome) {
    return join(codexHome, "oasiz", "credentials.json");
  }

  const home = process.env.HOME;
  if (!home) {
    return getWorkspaceCredentialsPath();
  }

  return join(home, ".oasiz", "credentials.json");
}

async function readStoredCredentialsAtPath(path: string): Promise<StoredCredentials | null> {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const text = await readFile(path, "utf8");
    const data = JSON.parse(text) as Partial<StoredCredentials>;
    if (!data.token || typeof data.token !== "string") {
      return null;
    }

    return {
      token: data.token,
      email: data.email,
      createdAt: data.createdAt || new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function readStoredCredentials(): Promise<StoredCredentials | null> {
  const primary = await readStoredCredentialsAtPath(getCredentialsPath());
  if (primary) {
    return primary;
  }

  return readStoredCredentialsAtPath(getWorkspaceCredentialsPath());
}

async function saveStoredCredentialsAtPath(path: string, credentials: StoredCredentials): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(credentials, null, 2) + "\n", "utf8");
}

export async function saveStoredCredentials(credentials: StoredCredentials): Promise<void> {
  const primaryPath = getCredentialsPath();
  try {
    await saveStoredCredentialsAtPath(primaryPath, credentials);
  } catch {
    const fallbackPath = getWorkspaceCredentialsPath();
    await saveStoredCredentialsAtPath(fallbackPath, credentials);
  }
}

export function clearStoredCredentials(): void {
  const paths = [getCredentialsPath(), getWorkspaceCredentialsPath()];
  for (const path of paths) {
    try {
      if (existsSync(path)) {
        rmSync(path);
      }
    } catch {
      // Ignore filesystem permission errors so logout can still proceed.
    }
  }
}

export async function resolveAuthToken(): Promise<string | null> {
  if (process.env.OASIZ_CLI_TOKEN) return process.env.OASIZ_CLI_TOKEN;
  if (process.env.OASIZ_UPLOAD_TOKEN) return process.env.OASIZ_UPLOAD_TOKEN;

  const stored = await readStoredCredentials();
  return stored?.token || null;
}

export async function requireAuthToken(): Promise<string> {
  const token = await resolveAuthToken();
  if (!token) {
    throw new Error(
      "No API token found. Set OASIZ_CLI_TOKEN or OASIZ_UPLOAD_TOKEN, or run `oasiz login --token <token>`.",
    );
  }
  return token;
}

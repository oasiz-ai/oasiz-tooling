import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { getProjectRoot } from "./runtime.ts";

export interface StoredCredentials {
  token: string;
  email?: string;
  developer?: boolean;
  createdAt: string;
}

export interface BrowserLoginResult {
  token: string;
  email?: string;
  expiresAt?: string;
  developer?: boolean;
}

export interface BrowserLoginOptions {
  requireDeveloper?: boolean;
}

const DEFAULT_API_BASE = "http://localhost:3001";
const DEFAULT_WEB_BASE = "https://oasiz.ai";
const DEVELOPER_ACCESS_ERROR =
  "Developer access is required for Studio workflows. Email contact@oasiz.ai to join the Oasiz Developers Program.";

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
      developer: data.developer === true,
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

export async function resolveStudioAuthToken(openBrowser = true): Promise<string | null> {
  if (process.env.OASIZ_CLI_TOKEN) return process.env.OASIZ_CLI_TOKEN;

  const stored = await readStoredCredentials();
  if (stored?.token && stored.developer === true) {
    return stored.token;
  }

  const loginResult = await runBrowserLoginFlow(openBrowser, { requireDeveloper: true });
  if (loginResult.developer !== true) {
    throw new Error(DEVELOPER_ACCESS_ERROR);
  }
  await saveStoredCredentials({
    token: loginResult.token,
    email: loginResult.email,
    developer: true,
    createdAt: new Date().toISOString(),
  });
  return loginResult.token;
}

async function openInBrowser(url: string): Promise<void> {
  const platform = process.platform;

  const spawnDetached = (command: string, args: string[]): void => {
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
  };

  if (platform === "darwin") {
    spawnDetached("open", [url]);
    return;
  }
  if (platform === "linux") {
    spawnDetached("xdg-open", [url]);
    return;
  }
  if (platform === "win32") {
    spawnDetached("cmd", ["/c", "start", "", url]);
    return;
  }

  throw new Error("Unsupported platform for open command: " + platform);
}

async function findOpenPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createNetServer();

    server.once("error", (error) => {
      reject(error);
    });

    // Match the game-studio CLI so browser callbacks can resolve over either
    // loopback family on machines where localhost prefers IPv6.
    server.listen(0, "localhost", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate callback port.")));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function runBrowserLoginFlow(
  openBrowser: boolean,
  options: BrowserLoginOptions = {},
): Promise<BrowserLoginResult> {
  const state = crypto.randomUUID();
  const webBase = getWebBaseUrl();
  const callbackPort = await findOpenPort();
  const requireDeveloper = options.requireDeveloper === true;
  let settled = false;
  let resolveLogin!: (value: BrowserLoginResult) => void;
  let rejectLogin!: (error: Error) => void;
  const callbackPromise = new Promise<BrowserLoginResult>((resolve, reject) => {
    resolveLogin = resolve;
    rejectLogin = reject;
  });

  const server = createHttpServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost:" + String(callbackPort));
    if (url.pathname === "/favicon.ico") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (url.pathname !== "/callback") {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not found");
      return;
    }

    const returnedState = url.searchParams.get("state") || "";
    const token = url.searchParams.get("token") || "";
    const email = url.searchParams.get("email") || undefined;
    const expiresAt = url.searchParams.get("expiresAt") || undefined;
    const developer = url.searchParams.get("developer") === "true";
    const error = url.searchParams.get("error");

    if (settled) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Already handled. You can close this tab.");
      return;
    }

    if (error) {
      settled = true;
      rejectLogin(new Error("CLI auth failed: " + error));
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Login failed. You can close this tab.");
      return;
    }

    if (!token || returnedState !== state) {
      settled = true;
      rejectLogin(new Error("Invalid callback from Oasiz auth flow."));
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Invalid callback payload. You can close this tab.");
      return;
    }

    settled = true;
    const loginResult: BrowserLoginResult = { token, email, expiresAt, developer };
    setTimeout(() => {
      resolveLogin(loginResult);
    }, 300);

    const html = [
      "<!doctype html>",
      "<html>",
      "<head>",
      "<meta charset=\"utf-8\" />",
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
      "<title>Oasiz CLI Login Complete</title>",
      "<style>",
      "html,body{height:100%;margin:0}",
      "body{font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#090f1f;color:#f5f7ff;display:grid;place-items:center}",
      ".card{width:min(560px,calc(100vw - 32px));padding:26px;border-radius:24px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08)}",
      ".brand{font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#dce5ff;margin-bottom:14px}",
      ".title{margin:0;font-size:28px;line-height:1.15}",
      ".desc{margin:10px 0 0;color:#b8c2de;font-size:16px;line-height:1.45}",
      ".status{display:inline-flex;align-items:center;gap:10px;margin-top:16px;padding:8px 12px;border:1px solid rgba(140,209,255,.45);border-radius:999px;background:rgba(73,165,255,.14);font-size:13px;font-weight:600;color:#d7efff}",
      ".dot{width:8px;height:8px;border-radius:50%;background:#8ef0c6;box-shadow:0 0 0 4px rgba(142,240,198,.16)}",
      ".foot{margin-top:16px;color:#98a6cc;font-size:13px}",
      "</style>",
      "</head>",
      "<body>",
      "<section class=\"card\">",
      "<div class=\"brand\">OASIZ</div>",
      "<h1 class=\"title\">" +
        (requireDeveloper ? "DEVELOPER CLI LOGIN COMPLETE" : "CLI LOGIN COMPLETE") +
        "</h1>",
      "<p class=\"desc\">Authentication finished successfully. You can close this tab and continue in your terminal.</p>",
      "<div class=\"status\"><span class=\"dot\"></span>Connected</div>",
      "<p class=\"foot\">This window can now be closed.</p>",
      "</section>",
      "</body>",
      "</html>",
    ].join("");

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(callbackPort, "localhost", () => {
      resolve();
    });
  });

  try {
    const loginSearch = new URLSearchParams({
      port: String(callbackPort),
      state,
    });
    const loginUrl = webBase + "/cli-auth?" + loginSearch.toString();
    console.log("Open this URL to continue login:");
    console.log("  " + loginUrl);
    if (openBrowser) {
      await openInBrowser(loginUrl);
    }

    const timeoutMs = 5 * 60 * 1000;
    let loginTimeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<BrowserLoginResult>((_resolve, reject) => {
      loginTimeout = setTimeout(() => reject(new Error("Timed out waiting for browser login callback.")), timeoutMs);
      loginTimeout.unref?.();
    });

    try {
      const timedResult = await Promise.race([callbackPromise, timeoutPromise]);
      await new Promise((resolve) => {
        setTimeout(resolve, 900);
      });
      return timedResult;
    } finally {
      if (loginTimeout) {
        clearTimeout(loginTimeout);
      }
    }
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

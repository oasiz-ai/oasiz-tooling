import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { isGameSlug } from "./lib/game.ts";
import { resolveAuthToken } from "./lib/auth.ts";
import { getProjectRoot, toPosixPath } from "./lib/runtime.ts";

const DEFAULT_GAME_SERVER_API_BASE = "https://api.oasiz.ai";
const STAGE_GAME_SERVER_API_BASE = "https://api-stage.oasiz.ai";
const DEFAULT_CLIENT_UPDATE_HZ = 20;
const DEFAULT_SERVER_TICK_HZ = 0;
const DEFAULT_MIN_REPLICAS = 1;
const DEFAULT_MAX_REPLICAS = 10;

const VALUE_FLAGS = new Set([
  "--api-url",
  "--build-command",
  "--client-update-hz",
  "--entrypoint",
  "--image",
  "--max-replicas",
  "--min-replicas",
  "--path",
  "--room",
  "--room-name",
  "--server-tick-hz",
  "--slug",
  "--source",
  "--source-dir",
  "--source-upload-id",
  "--template-image",
  "--timeout-ms",
  "--workspace",
  "--workspace-id",
]);

const BOOLEAN_FLAGS = new Set(["--dry-run", "--json", "--wait", "--help", "-h"]);
const SOURCE_EXCLUDE_NAMES = new Set([".DS_Store", ".env", ".env.local", ".git", ".oasiz", "node_modules"]);

interface ParsedArgs {
  positionals: string[];
  flagSet: Set<string>;
  values: Map<string, string>;
}

interface CreateGameServerRequest {
  custom_slug: string;
  room_name: string;
  entrypoint: string;
  client_update_hz: number;
  server_tick_hz: number;
  min_replicas: number;
  max_replicas: number;
  template_image?: string;
  source_upload_id?: string;
  path?: string;
  build_command?: string;
}

interface GameServerResponse {
  workspace_id?: string;
  scope?: "standalone" | "workspace" | string;
  build_id?: string;
  slug?: string;
  image?: string;
  status?: string;
  message?: string;
  client_update_hz?: number;
  server_tick_hz?: number;
  url?: string;
  public_key?: string;
  admin_key?: string;
}

interface SourceUploadInitResponse {
  source_upload_id: string;
  upload_url: string;
  expires_at?: string;
}

interface SourceBundleOptions {
  path: string;
  archiveRootName: string;
  filename: string;
}

interface SourceBundle {
  filename: string;
  contentType: string;
  bytes: Buffer;
  sha256: string;
  fileCount: number;
  description: string;
}

function loadEnvSync(): void {
  const envPath = join(getProjectRoot(), ".env");
  if (!existsSync(envPath)) return;

  try {
    const envText = readFileSync(envPath, "utf8");
    const lines = envText.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && typeof process.env[key] === "undefined") {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore malformed or unreadable .env files for parity with upload.
  }
}

function printGameServerHelp(): void {
  console.log("Usage:");
  console.log("  oasiz game-server create <slug> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --image <image>             Optional custom OCI image; omit for platform default");
  console.log("  --room <name>               Room name (default: slug)");
  console.log("  --entrypoint <path>         Entrypoint (default: server, or rooms/index.ts with --workspace)");
  console.log("  --workspace <id>            Create from code inside a running workspace");
  console.log("  --path <path>               Workspace/source server directory (default: server)");
  console.log("  --build-command <command>   Workspace/source build command");
  console.log("  --source <dir>              Tar/gzip a local server directory and upload it first");
  console.log("  --source-upload-id <id>     Create from an already-uploaded source bundle");
  console.log("  --client-update-hz <n>      Client patch rate, capped at 20 (default: 20)");
  console.log("  --server-tick-hz <n>        Server simulation tick rate, 0 for unlimited (default: 0)");
  console.log("  --min-replicas <n>          Minimum replicas (default: 1)");
  console.log("  --max-replicas <n>          Maximum replicas (default: 10)");
  console.log("  --api-url <url>             API base URL (default: https://api.oasiz.ai)");
  console.log("  --wait                      Poll build status until it finishes");
  console.log("  --dry-run                   Print the request without creating a server");
  console.log("  --json                      Print the raw JSON response");
  console.log("  --help, -h                  Show this help message");
  console.log("");
  console.log("Examples:");
  console.log("  oasiz game-server create arena");
  console.log("  oasiz game-server create arena --source server --entrypoint rooms/index.ts --wait");
  console.log("  oasiz game-server create arena --image us-central1-docker.pkg.dev/.../template:auto-20hz");
  console.log("  oasiz game-server create arena --workspace 0cfd10db --path server --entrypoint rooms/index.ts");
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flagSet = new Set<string>();
  const values = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (!raw.startsWith("-")) {
      positionals.push(raw);
      continue;
    }

    const equalsIndex = raw.indexOf("=");
    const name = equalsIndex === -1 ? raw : raw.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : raw.slice(equalsIndex + 1);

    if (VALUE_FLAGS.has(name)) {
      const value = inlineValue ?? argv[i + 1];
      if (value === undefined || (inlineValue === undefined && value.startsWith("-"))) {
        throw new Error("Missing value for " + name + ".");
      }
      values.set(name, value);
      if (inlineValue === undefined) i += 1;
      continue;
    }

    if (BOOLEAN_FLAGS.has(name)) {
      flagSet.add(name);
      continue;
    }

    throw new Error("Unknown game-server option: " + name);
  }

  return { positionals, flagSet, values };
}

function valueOf(values: Map<string, string>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = values.get(name);
    if (value !== undefined) return value;
  }
  return undefined;
}

function parseInteger(value: string | undefined, flag: string, fallback: number, min: number, max?: number): number {
  if (value === undefined) return fallback;
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(flag + " must be an integer.");
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw new Error(flag + " must be at least " + String(min) + ".");
  }
  if (max !== undefined && parsed > max) {
    throw new Error(flag + " must be no more than " + String(max) + ".");
  }
  return parsed;
}

function normalizeApiBase(raw: string): string {
  let value = raw.trim();
  if (!value) return DEFAULT_GAME_SERVER_API_BASE;
  if (value === "api-stage") return STAGE_GAME_SERVER_API_BASE;
  if (!/^https?:\/\//.test(value)) value = "https://" + value;
  if (value.endsWith("/game-servers")) value = value.slice(0, -"/game-servers".length);
  return value.replace(/\/+$/, "");
}

function resolveProjectPath(value: string): string {
  if (value.startsWith("/")) return value;
  return resolve(getProjectRoot(), value);
}

function sanitizeArchiveRootName(value: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "server";
}

function getGameServerApiBaseUrl(apiUrlOverride: string | undefined): string {
  return normalizeApiBase(apiUrlOverride || process.env.OASIZ_GAME_SERVER_API_URL || DEFAULT_GAME_SERVER_API_BASE);
}

function summarizeErrorBody(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "(empty response body)";
  const limit = 240;
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "...";
}

async function gameServerRequest<T>(
  apiBaseUrl: string,
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const requestUrl = apiBaseUrl + (path.startsWith("/") ? path : "/" + path);
  const headers: Record<string, string> = {};
  const token = await resolveAuthToken();

  if (token) {
    headers.Authorization = "Bearer " + token;
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
    throw new Error("Could not connect to game server API.\nTarget URL: " + requestUrl + "\nCause: " + details);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      "Game server request failed (" +
        response.status +
        ") for " +
        requestUrl +
        ". Response preview: " +
        summarizeErrorBody(text),
    );
  }

  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}

function splitTarPath(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path) <= 100) {
    return { name: path, prefix: "" };
  }

  for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1)) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }

  throw new Error("Source bundle path is too long for tar format: " + path);
}

function writeTarString(header: Buffer, value: string, offset: number, length: number): void {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) {
    throw new Error("Tar header value is too long: " + value);
  }
  bytes.copy(header, offset);
}

function writeTarOctal(header: Buffer, value: number, offset: number, length: number): void {
  const text = value.toString(8).padStart(length - 1, "0");
  header.write(text.slice(-(length - 1)) + "\0", offset, length, "ascii");
}

function createTarHeader(path: string, size: number, type: "file" | "directory", mode: number): Buffer {
  const header = Buffer.alloc(512);
  const split = splitTarPath(path);
  writeTarString(header, split.name, 0, 100);
  writeTarOctal(header, mode, 100, 8);
  writeTarOctal(header, 0, 108, 8);
  writeTarOctal(header, 0, 116, 8);
  writeTarOctal(header, size, 124, 12);
  writeTarOctal(header, Math.floor(Date.now() / 1000), 136, 12);
  header.fill(0x20, 148, 156);
  header.write(type === "directory" ? "5" : "0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  writeTarString(header, "oasiz", 265, 32);
  writeTarString(header, "oasiz", 297, 32);
  if (split.prefix) {
    writeTarString(header, split.prefix, 345, 155);
  }

  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.write(checksumText + "\0 ", 148, 8, "ascii");
  return header;
}

function shouldExcludeSourcePath(pathParts: string[]): boolean {
  return pathParts.some((part) => SOURCE_EXCLUDE_NAMES.has(part));
}

function collectSourceTarParts(
  diskPath: string,
  archivePath: string,
  relativeParts: string[] = [],
  parts: Buffer[] = [],
): { parts: Buffer[]; fileCount: number } {
  const stats = statSync(diskPath);
  if (stats.isDirectory()) {
    const normalizedArchivePath = archivePath.endsWith("/") ? archivePath : archivePath + "/";
    parts.push(createTarHeader(normalizedArchivePath, 0, "directory", 0o755));
    let fileCount = 0;
    const entries = readdirSync(diskPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const nextRelativeParts = [...relativeParts, entry.name];
      if (shouldExcludeSourcePath(nextRelativeParts)) continue;
      const nextDiskPath = join(diskPath, entry.name);
      const nextArchivePath = toPosixPath(join(archivePath, entry.name));
      const collected = collectSourceTarParts(nextDiskPath, nextArchivePath, nextRelativeParts, parts);
      fileCount += collected.fileCount;
    }
    return { parts, fileCount };
  }

  if (!stats.isFile()) {
    return { parts, fileCount: 0 };
  }

  const bytes = readFileSync(diskPath);
  parts.push(createTarHeader(archivePath, bytes.length, "file", 0o644));
  parts.push(bytes);
  const remainder = bytes.length % 512;
  if (remainder !== 0) {
    parts.push(Buffer.alloc(512 - remainder));
  }
  return { parts, fileCount: 1 };
}

function createSourceBundle(options: SourceBundleOptions): SourceBundle {
  const sourcePath = resolveProjectPath(options.path);
  if (!existsSync(sourcePath)) {
    throw new Error("Source directory not found: " + options.path);
  }
  if (!statSync(sourcePath).isDirectory()) {
    throw new Error("--source must point to a directory.");
  }

  const archiveRootName = sanitizeArchiveRootName(options.archiveRootName || basename(sourcePath));
  const collected = collectSourceTarParts(sourcePath, archiveRootName);
  const tarBytes = Buffer.concat([...collected.parts, Buffer.alloc(1024)]);
  const bytes = gzipSync(tarBytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    filename: options.filename,
    contentType: "application/gzip",
    bytes,
    sha256,
    fileCount: collected.fileCount,
    description: sourcePath,
  };
}

async function uploadSourceBundle(apiBaseUrl: string, bundle: SourceBundle, quiet: boolean): Promise<string> {
  if (!quiet) {
    console.log("Packaging source bundle:");
    console.log("  Source: " + bundle.description);
    console.log("  Files: " + String(bundle.fileCount));
    console.log("  Bundle: " + bundle.filename);
  }

  const upload = await gameServerRequest<SourceUploadInitResponse>(apiBaseUrl, "/game-servers/uploads", {
    method: "POST",
    body: {
      filename: bundle.filename,
      content_type: bundle.contentType,
      sha256: bundle.sha256,
    },
  });

  if (!upload.source_upload_id || !upload.upload_url) {
    throw new Error("Upload init response did not include source_upload_id and upload_url.");
  }

  if (!quiet) {
    console.log("Uploading source bundle...");
  }

  const response = await fetch(upload.upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": bundle.contentType,
    },
    body: bundle.bytes,
  });

  if (!response.ok) {
    throw new Error("Source bundle upload failed (" + response.status + "): " + summarizeErrorBody(await response.text()));
  }

  if (!quiet) {
    console.log("Source upload id: " + upload.source_upload_id);
  }

  return upload.source_upload_id;
}

function getStatusPath(buildId: string): string {
  return "/game-servers/status?build_id=" + encodeURIComponent(buildId);
}

function isTerminalStatus(status: string | undefined): boolean {
  const normalized = (status || "").toLowerCase();
  return ["deployed", "failed", "error", "cancelled", "canceled", "succeeded", "success"].includes(normalized);
}

async function pollBuildStatus(
  apiBaseUrl: string,
  buildId: string,
  timeoutMs: number,
  quiet: boolean,
): Promise<GameServerResponse> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";

  while (Date.now() <= deadline) {
    const result = await gameServerRequest<GameServerResponse>(apiBaseUrl, getStatusPath(buildId));
    const status = result.status || "unknown";
    if (!quiet && status !== lastStatus) {
      console.log("Build status: " + status);
      lastStatus = status;
    }

    if (isTerminalStatus(result.status)) {
      return result;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000));
  }

  throw new Error("Timed out waiting for game server build: " + buildId);
}

function buildCreateRequest(parsed: ParsedArgs): {
  apiBaseUrl: string;
  endpointPath: string;
  request: CreateGameServerRequest;
  json: boolean;
  dryRun: boolean;
  wait: boolean;
  timeoutMs: number;
  sourceBundle?: SourceBundle;
} {
  const slug = (valueOf(parsed.values, "--slug") || parsed.positionals[0] || "").trim();
  if (!slug) {
    throw new Error("Usage: oasiz game-server create <slug>");
  }
  if (!isGameSlug(slug)) {
    throw new Error("Invalid game server slug. Use lowercase letters, numbers, and hyphens only.");
  }

  const workspaceId = valueOf(parsed.values, "--workspace", "--workspace-id")?.trim();
  const sourceUploadId = valueOf(parsed.values, "--source-upload-id")?.trim();
  const sourcePath = valueOf(parsed.values, "--source", "--source-dir")?.trim();
  const sourceInputCount = [sourceUploadId, sourcePath].filter(Boolean).length;
  if (sourceInputCount > 1) {
    throw new Error("Use only one of --source or --source-upload-id.");
  }
  if (workspaceId && sourceInputCount > 0) {
    throw new Error("Do not combine --workspace with source upload flags.");
  }

  const roomName = (valueOf(parsed.values, "--room", "--room-name") || slug).trim();
  const sourceArchiveRootName = sourcePath ? sanitizeArchiveRootName(basename(resolveProjectPath(sourcePath))) : undefined;
  const usesSource = Boolean(sourceUploadId || sourcePath);
  const entrypoint =
    valueOf(parsed.values, "--entrypoint")?.trim() || (workspaceId || usesSource ? "rooms/index.ts" : "server");
  const serverPath =
    valueOf(parsed.values, "--path")?.trim() ||
    (sourceArchiveRootName ? sourceArchiveRootName : workspaceId || sourceUploadId ? "server" : undefined);
  const buildCommand = valueOf(parsed.values, "--build-command")?.trim();
  const image = valueOf(parsed.values, "--image", "--template-image")?.trim();
  if (image && usesSource) {
    throw new Error("Use either --image or source upload flags, not both.");
  }

  const clientUpdateHz = parseInteger(
    valueOf(parsed.values, "--client-update-hz"),
    "--client-update-hz",
    DEFAULT_CLIENT_UPDATE_HZ,
    1,
    20,
  );
  const serverTickHz = parseInteger(
    valueOf(parsed.values, "--server-tick-hz"),
    "--server-tick-hz",
    DEFAULT_SERVER_TICK_HZ,
    0,
  );
  const minReplicas = parseInteger(
    valueOf(parsed.values, "--min-replicas"),
    "--min-replicas",
    DEFAULT_MIN_REPLICAS,
    1,
  );
  const maxReplicas = parseInteger(
    valueOf(parsed.values, "--max-replicas"),
    "--max-replicas",
    DEFAULT_MAX_REPLICAS,
    1,
  );
  if (maxReplicas < minReplicas) {
    throw new Error("--max-replicas must be greater than or equal to --min-replicas.");
  }
  const timeoutMs = parseInteger(valueOf(parsed.values, "--timeout-ms"), "--timeout-ms", 10 * 60 * 1000, 1000);

  const request: CreateGameServerRequest = {
    custom_slug: slug,
    room_name: roomName,
    entrypoint,
    client_update_hz: clientUpdateHz,
    server_tick_hz: serverTickHz,
    min_replicas: minReplicas,
    max_replicas: maxReplicas,
    ...(image ? { template_image: image } : {}),
    ...(sourceUploadId ? { source_upload_id: sourceUploadId } : {}),
    ...(serverPath ? { path: serverPath } : {}),
    ...(buildCommand ? { build_command: buildCommand } : {}),
  };

  const apiBaseUrl = getGameServerApiBaseUrl(valueOf(parsed.values, "--api-url"));
  const endpointPath = workspaceId ? "/workspaces/" + encodeURIComponent(workspaceId) + "/game-servers" : "/game-servers";

  return {
    apiBaseUrl,
    endpointPath,
    request,
    json: parsed.flagSet.has("--json"),
    dryRun: parsed.flagSet.has("--dry-run"),
    wait: parsed.flagSet.has("--wait"),
    timeoutMs,
    ...(sourcePath
      ? {
          sourceBundle: createSourceBundle({
            path: sourcePath,
            archiveRootName: sourceArchiveRootName || "server",
            filename: slug + "-server.tar.gz",
          }),
        }
      : {}),
  };
}

function printCreateResult(result: GameServerResponse): void {
  console.log("");
  console.log("Game server create request accepted.");
  if (result.scope) console.log("  Scope: " + result.scope);
  if (result.slug) console.log("  Slug: " + result.slug);
  if (result.workspace_id) console.log("  Workspace: " + result.workspace_id);
  if (result.status) console.log("  Status: " + result.status);
  if (result.message) console.log("  Message: " + result.message);
  if (result.image) console.log("  Image: " + result.image);
  if (result.url) console.log("  URL: " + result.url);
  if (result.public_key) console.log("  Public key: " + result.public_key);
  if (result.admin_key) console.log("  Admin key (secret): " + result.admin_key);
  if (result.build_id) {
    console.log("  Build ID: " + result.build_id);
    console.log("  Poll: GET /game-servers/status?build_id=" + result.build_id);
  }
}

async function commandCreate(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.flagSet.has("--help") || parsed.flagSet.has("-h")) {
    printGameServerHelp();
    return;
  }

  const { apiBaseUrl, endpointPath, request, json, dryRun, wait, timeoutMs, sourceBundle } = buildCreateRequest(parsed);
  if (dryRun) {
    console.log("Would create game server:");
    if (sourceBundle) {
      console.log("  POST " + apiBaseUrl + "/game-servers/uploads");
      console.log("  PUT {upload_url} (" + sourceBundle.filename + ", " + String(sourceBundle.bytes.length) + " bytes)");
    }
    console.log("  POST " + apiBaseUrl + endpointPath);
    console.log(
      JSON.stringify(sourceBundle ? { ...request, source_upload_id: "(from source upload)" } : request, null, 2),
    );
    return;
  }

  if (sourceBundle) {
    request.source_upload_id = await uploadSourceBundle(apiBaseUrl, sourceBundle, json);
  }

  const result = await gameServerRequest<GameServerResponse>(apiBaseUrl, endpointPath, {
    method: "POST",
    body: request,
  });
  const finalResult = wait && result.build_id ? await pollBuildStatus(apiBaseUrl, result.build_id, timeoutMs, json) : result;

  if (json) {
    console.log(JSON.stringify(finalResult, null, 2));
    return;
  }

  printCreateResult(finalResult);
}

async function commandStatus(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.flagSet.has("--help") || parsed.flagSet.has("-h")) {
    console.log("Usage: oasiz game-server status <build_id> [--wait] [--json]");
    return;
  }

  const buildId = parsed.positionals[0]?.trim();
  if (!buildId) {
    throw new Error("Usage: oasiz game-server status <build_id>");
  }

  const apiBaseUrl = getGameServerApiBaseUrl(valueOf(parsed.values, "--api-url"));
  const timeoutMs = parseInteger(valueOf(parsed.values, "--timeout-ms"), "--timeout-ms", 10 * 60 * 1000, 1000);
  const result = parsed.flagSet.has("--wait")
    ? await pollBuildStatus(apiBaseUrl, buildId, timeoutMs, parsed.flagSet.has("--json"))
    : await gameServerRequest<GameServerResponse>(apiBaseUrl, getStatusPath(buildId));

  if (parsed.flagSet.has("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printCreateResult(result);
}

export async function runGameServerCli(args: string[] = []): Promise<void> {
  loadEnvSync();
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    printGameServerHelp();
    return;
  }

  switch (command) {
    case "create":
      await commandCreate(args.slice(1));
      return;
    case "status":
      await commandStatus(args.slice(1));
      return;
    default:
      throw new Error("Unknown game-server command: " + command);
  }
}

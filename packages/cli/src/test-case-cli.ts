import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { resolveStudioAuthToken } from "./lib/auth.ts";
import { getProjectRoot } from "./lib/runtime.ts";

const VALUE_FLAGS = new Set([
  "--api-url",
  "--appium",
  "--appium-script",
  "--app-build-id",
  "--app-custom-id",
  "--app-file",
  "--app-id",
  "--app-uri",
  "--case-id",
  "--controller-url",
  "--conversion-error",
  "--conversion-status",
  "--description",
  "--device",
  "--device-matrix",
  "--game",
  "--game-id",
  "--id",
  "--launch-manifest",
  "--name",
  "--notification-email",
  "--notification-emails",
  "--notify",
  "--objective",
  "--output",
  "--output-file",
  "--poll-interval-ms",
  "--provider",
  "--replay",
  "--replay-json",
  "--run-id",
  "--status",
  "--studio-url",
  "--test",
  "--test-path",
  "--test-type",
  "--test_type",
  "--timeout-ms",
  "--workspace",
  "--workspace-id",
]);

const BOOLEAN_FLAGS = new Set(["--dry-run", "--json", "--help", "-h"]);

interface ParsedArgs {
  positionals: string[];
  flagSet: Set<string>;
  values: Map<string, string[]>;
}

interface TestDevice {
  model?: string;
  version?: string;
  locale?: string;
  orientation?: string;
  browserstack_name?: string;
}

interface SaveTestCaseRequest {
  workspace_id?: string;
  name?: string;
  game?: string;
  description?: string;
  objective?: string;
  notification_emails?: string[];
  status?: string;
  provider?: string;
  test_type?: string;
  app_id?: string;
  app_uri?: string;
  app_build_id?: string;
  launch_manifest?: unknown;
  device_matrix?: TestDevice[];
  replay_script?: unknown;
  appium_script?: string;
  conversion_status?: string;
  conversion_error?: string;
}

interface TestCaseResponse extends SaveTestCaseRequest {
  id?: string;
  conversion_status?: string;
  conversion_error?: string;
  created_at?: string;
  updated_at?: string;
}

interface AppUploadResponse {
  provider?: string;
  test_type?: string;
  app_uri?: string;
  raw?: unknown;
}

interface TestArtifact {
  label?: string;
  name?: string;
  kind?: string;
  url?: string;
}

interface TestRunResponse {
  id?: string;
  case_id?: string;
  workspace_id?: string;
  provider?: string;
  test_type?: string;
  app_uri?: string;
  status?: string;
  outcome?: string;
  error_message?: string;
  provider_run_id?: string;
  provider_console_url?: string;
  launch_command?: string;
  artifacts?: TestArtifact[];
  [key: string]: unknown;
}

interface ImportOptions {
  apiBaseUrl: string;
  caseId?: string;
  request: SaveTestCaseRequest;
  appFile?: string;
  appCustomId?: string;
  dryRun: boolean;
  json: boolean;
}

interface TestCaseRunResult {
  test_path?: string;
  launch_manifest_path?: string;
  case_id?: string;
  run_id?: string;
  status?: string;
  outcome?: string;
  provider_console_url?: string;
  artifact_output_dir?: string;
  downloaded_artifacts?: DownloadedArtifact[];
  artifacts?: TestArtifact[];
  test_case?: TestCaseResponse;
  run?: TestRunResponse;
  dry_run?: boolean;
  request?: unknown;
}

interface DownloadedArtifact {
  kind: string;
  name: string;
  url: string;
  path: string;
  error?: string;
}

function loadEnvSync(): void {
  const envPath = join(getProjectRoot(), ".env");
  if (!existsSync(envPath)) return;

  try {
    const envText = readFileSync(envPath, "utf8");
    for (const line of envText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Match the rest of the CLI: malformed project env files should not break help/dry-run paths.
  }
}

function printTestCaseHelp(): void {
  console.log("Usage:");
  console.log("  oasiz test-case");
  console.log("  oasiz test-case --dry-run");
  console.log("  oasiz test-case run --json");
  console.log("  oasiz test-case artifacts --run-id <id>");
  console.log("");
  console.log("Public options:");
  console.log("  --dry-run                   Print requests without contacting the API");
  console.log("  --json                      Print the raw JSON response");
  console.log("  --test, --test-path         Appium/test JSON path; repeat for multiple tests");
  console.log("  --output, --output-file     Write run results to a JSON file");
  console.log("  --run-id                    Studio test run id for artifact inspection");
  console.log("  --help, -h                  Show this help message");
  console.log("");
  console.log("Studio environment defaults:");
  console.log("  OASIZ_STUDIO_API_URL        Studio/controller API base URL");
  console.log("  OASIZ_WORKSPACE_ID          Workspace that owns new test cases");
  console.log("  OASIZ_TEST_CASE_ID          Existing Studio test case to update/run");
  console.log("  OASIZ_TEST_CASE_NAME        Test case name");
  console.log("  OASIZ_TEST_OBJECTIVE        Required before the autonomous fixing loop");
  console.log("  OASIZ_TEST_REPLAY_PATH      Studio recording JSON");
  console.log("  OASIZ_TEST_PATHS            Comma-separated generated test JSON paths");
  console.log("  OASIZ_TEST_LAUNCH_MANIFEST  Launch manifest JSON; auto-detected beside tests");
  console.log("  OASIZ_TEST_GAME_ID          Game id used when a manifest must be generated");
  console.log("  OASIZ_TEST_APP_URI          Existing provider app/build URI");
  console.log("  OASIZ_TEST_APP_FILE         IPA/APK to upload first");
  console.log("  OASIZ_TEST_NOTIFY_EMAILS    Comma-separated notification emails");
  console.log("  OASIZ_TEST_OUTPUT_PATH      JSON result path for test-case run");
  console.log("  OASIZ_TEST_RUN_ID           Studio test run id for artifacts");
  console.log("  OASIZ_TEST_ARTIFACTS_DIR    Download artifacts during run or artifacts command");
  console.log("  APP_PERCY_DEFAULT_DEVICES   Comma-separated BrowserStack devices");
  console.log("  OASIZ_CLI_TOKEN             Developer auth token, or run oasiz login --studio");
  console.log("");
  console.log("Examples:");
  console.log("  oasiz test-case");
  console.log("  oasiz test-case run --json --output results.json");
  console.log("  oasiz test-case artifacts --run-id tr-123 --output artifacts/tr-123");
  console.log("  OASIZ_TEST_DRY_RUN=true oasiz test-case");
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flagSet = new Set<string>();
  const values = new Map<string, string[]>();

  const addValue = (name: string, value: string): void => {
    const existing = values.get(name) || [];
    existing.push(value);
    values.set(name, existing);
  };

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
      addValue(name, value);
      if (inlineValue === undefined) i += 1;
      continue;
    }

    if (BOOLEAN_FLAGS.has(name)) {
      flagSet.add(name);
      continue;
    }

    throw new Error("Unknown test-case option: " + name);
  }

  return { positionals, flagSet, values };
}

function valueOf(values: Map<string, string[]>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = values.get(name)?.at(-1);
    if (value !== undefined) return value;
  }
  return undefined;
}

function valuesOf(values: Map<string, string[]>, name: string): string[] {
  return values.get(name) || [];
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function flagOrEnv(values: Map<string, string[]>, flagNames: string[], envNames: string[]): string | undefined {
  return valueOf(values, ...flagNames) || envValue(...envNames);
}

function envValues(...names: string[]): string[] {
  return names.flatMap((name) => splitList(process.env[name] || ""));
}

function flagOrEnvValues(values: Map<string, string[]>, flagNames: string[], envNames: string[]): string[] {
  const fromFlags = flagNames.flatMap((name) => valuesOf(values, name)).flatMap(splitList);
  return fromFlags.length > 0 ? fromFlags : envValues(...envNames);
}

function envBoolean(...names: string[]): boolean | undefined {
  const value = envValue(...names);
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(names[0] + " must be true or false.");
}

function flagOrEnvBoolean(parsed: ParsedArgs, flagNames: string[], envNames: string[]): boolean {
  if (flagNames.some((name) => parsed.flagSet.has(name))) return true;
  return envBoolean(...envNames) === true;
}

function normalizeApiBase(raw: string): string {
  let value = raw.trim();
  if (!value) return "";
  if (!/^https?:\/\//.test(value)) value = "https://" + value;
  value = value.replace(/\/+$/, "");
  if (value.endsWith("/test-cases")) value = value.slice(0, -"/test-cases".length);
  if (value.endsWith("/api/test-cases")) value = value.slice(0, -"/test-cases".length);
  return value.replace(/\/+$/, "");
}

function getApiBaseUrl(apiUrlOverride: string | undefined): string {
  const raw =
    apiUrlOverride ||
    process.env.OASIZ_STUDIO_API_URL ||
    process.env.OASIZ_CONTROLLER_URL ||
    process.env.OASIZ_TEST_API_URL ||
    "";
  const normalized = normalizeApiBase(raw);
  if (!normalized) {
    throw new Error("Missing Studio/controller API URL. Set OASIZ_STUDIO_API_URL.");
  }
  return normalized;
}

function resolveProjectPath(value: string): string {
  if (value.startsWith("/")) return value;
  return resolve(getProjectRoot(), value);
}

function cloneParsedArgs(parsed: ParsedArgs): ParsedArgs {
  return {
    positionals: [...parsed.positionals],
    flagSet: new Set(parsed.flagSet),
    values: new Map(Array.from(parsed.values.entries()).map(([key, value]) => [key, [...value]])),
  };
}

function setParsedValue(parsed: ParsedArgs, name: string, value: string | undefined): void {
  if (!value) {
    parsed.values.delete(name);
    return;
  }
  parsed.values.set(name, [value]);
}

function deleteParsedValues(parsed: ParsedArgs, names: string[]): void {
  for (const name of names) {
    parsed.values.delete(name);
  }
}

function detectLaunchManifestPath(testPath: string | undefined, explicitPath: string | undefined): string | undefined {
  if (explicitPath) return explicitPath;
  if (!testPath) return undefined;

  const resolvedTestPath = resolveProjectPath(testPath);
  const testDir = dirname(resolvedTestPath);
  const candidates = [
    join(testDir, "launch-manifest.json"),
    join(testDir, "launch.json"),
    join(testDir, "manifest.json"),
    join(dirname(testDir), "launch-manifest.json"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function generatedLaunchManifest(values: Map<string, string[]>): unknown | undefined {
  const gameId = flagOrEnv(values, ["--game-id"], ["OASIZ_TEST_GAME_ID", "OASIZ_TEST_LAUNCH_GAME_ID"])?.trim();
  if (!gameId) return undefined;
  return normalizeLaunchManifest({
    game_id: gameId,
  });
}

async function readTextFile(flag: string, value: string): Promise<string> {
  const filePath = resolveProjectPath(value);
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error("Could not read " + flag + " file: " + value + "\nCause: " + message);
  }
}

async function readReplayJson(value: string): Promise<unknown> {
  const text = await readTextFile("--replay", value);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error("--replay must be valid JSON: " + value + "\nCause: " + message);
  }
}

async function readJsonFile(flag: string, value: string): Promise<unknown> {
  const text = await readTextFile(flag, value);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(flag + " must be valid JSON: " + value + "\nCause: " + message);
  }
}

function manifestString(manifest: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = manifest[name];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return value ? "true" : "false";
  }
  return undefined;
}

function appendDeepLinkParam(url: string, name: string, value: string | undefined): string {
  if (!value) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has(name)) parsed.searchParams.set(name, value);
    return parsed.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return url + separator + encodeURIComponent(name) + "=" + encodeURIComponent(value);
  }
}

function normalizeLaunchManifest(manifest: unknown): unknown {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return manifest;

  const next: Record<string, unknown> = { ...(manifest as Record<string, unknown>) };
  const gameId = manifestString(next, "game_id", "gameId", "game");
  let deepLink = manifestString(next, "deep_link", "deepLink", "launch_url", "launchUrl");
  if (!deepLink && gameId) {
    deepLink = gameId.startsWith("oasiz://") ? gameId : "oasiz://game/" + encodeURIComponent(gameId);
  }
  if (!deepLink) return next;

  const launchParams: Array<[string, string | undefined]> = [
    ["feature", manifestString(next, "feature", "e2e_feature", "e2eFeature")],
    ["contentUrl", manifestString(next, "content_url", "contentUrl", "e2e_content_url", "e2eContentUrl")],
    ["graphics", manifestString(next, "graphics", "graphics_quality", "graphicsQuality", "e2e_graphics", "e2eGraphics")],
    ["scenario", manifestString(next, "scenario", "e2e_scenario", "e2eScenario")],
    ["expectedFailure", manifestString(next, "expected_failure", "expectedFailure", "e2e_expected_failure", "e2eExpectedFailure")],
    ["level", manifestString(next, "level", "level_id", "levelId")],
  ];
  const hasLaunchParams = launchParams.some(([, value]) => Boolean(value));
  if (hasLaunchParams && !manifestString(next, "e2e")) {
    deepLink = appendDeepLinkParam(deepLink, "e2e", "true");
  }
  for (const [name, value] of launchParams) {
    deepLink = appendDeepLinkParam(deepLink, name, value);
  }

  next.deep_link = deepLink;
  next.uri = deepLink;
  return next;
}

async function readLaunchManifest(value: string): Promise<unknown> {
  return normalizeLaunchManifest(await readJsonFile("--launch-manifest", value));
}

function launchManifestDeepLink(manifest: unknown): string | undefined {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return undefined;
  return manifestString(manifest as Record<string, unknown>, "deep_link", "deepLink", "uri", "launch_url", "launchUrl");
}

async function readAppiumScript(value: string, launchManifest: unknown): Promise<string> {
  const text = await readTextFile("--appium", value);
  const deepLink = launchManifestDeepLink(launchManifest);
  if (!deepLink) return text;

  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return text;
    const commands = (parsed as { commands?: unknown }).commands;
    if (!Array.isArray(commands)) return text;
    const firstDeepLink = commands.find(
      (command) =>
        command &&
        typeof command === "object" &&
        typeof (command as { type?: unknown }).type === "string" &&
        (command as { type: string }).type.toLowerCase() === "deep_link",
    );
    if (!firstDeepLink || typeof firstDeepLink !== "object") return text;
    (firstDeepLink as { url?: string }).url = deepLink;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function parseDeviceMatrixText(flag: string, text: string): TestDevice[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(flag + " must be valid JSON.\nCause: " + message);
  }

  const matrix = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { device_matrix?: unknown }).device_matrix)
      ? (parsed as { device_matrix: unknown[] }).device_matrix
      : undefined;
  if (!matrix) {
    throw new Error("--device-matrix must contain a JSON array or an object with device_matrix.");
  }
  return matrix.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("--device-matrix entries must be objects.");
    }
    return entry as TestDevice;
  });
}

async function readDeviceMatrix(value: string): Promise<TestDevice[]> {
  const trimmed = value.trim();
  const text = trimmed.startsWith("[") || trimmed.startsWith("{") ? trimmed : await readTextFile("--device-matrix", value);
  return parseDeviceMatrixText("--device-matrix", text);
}

function inferTestType(values: Map<string, string[]>, provider: string): string {
  const explicit = flagOrEnv(values, ["--test-type", "--test_type"], ["OASIZ_TEST_TYPE", "OASIZ_TEST_CASE_TYPE"])?.trim();
  if (explicit) return explicit;
  if (
    flagOrEnv(values, ["--appium", "--appium-script", "--test", "--test-path"], [
      "OASIZ_TEST_PATH",
      "OASIZ_TEST_PATHS",
      "OASIZ_TEST_APPIUM_PATH",
      "OASIZ_TEST_APPIUM_PATHS",
      "OASIZ_TEST_APPIUM_SCRIPT",
    ])
  ) {
    return "appium";
  }
  if (provider === "studio-local" || provider === "studio" || provider === "local") {
    return "replay";
  }
  return "appium";
}

function summarizeErrorBody(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "(empty response body)";
  const limit = 240;
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "...";
}

async function studioRequest<T>(
  apiBaseUrl: string,
  path: string,
  options: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {},
): Promise<T> {
  const requestUrl = apiBaseUrl + (path.startsWith("/") ? path : "/" + path);
  const headers: Record<string, string> = {};
  const token = await resolveStudioAuthToken();

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
    throw new Error("Could not connect to Studio test-case API.\nTarget URL: " + requestUrl + "\nCause: " + details);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      "Studio test-case request failed (" +
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

async function uploadAppFile(
  apiBaseUrl: string,
  appFile: string,
  provider: string | undefined,
  testType: string | undefined,
  customId: string | undefined,
): Promise<string> {
  const filePath = resolveProjectPath(appFile);
  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([bytes]), basename(filePath));
  if (provider) form.append("provider", provider);
  if (testType) form.append("test_type", testType);
  if (customId) form.append("custom_id", customId);

  const requestUrl = apiBaseUrl + "/test-apps/upload";
  const headers: Record<string, string> = {};
  const token = await resolveStudioAuthToken();
  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: "POST",
      headers,
      body: form,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error("Could not upload app file.\nTarget URL: " + requestUrl + "\nCause: " + details);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      "App file upload failed (" + response.status + ") for " + requestUrl + ". Response preview: " + summarizeErrorBody(text),
    );
  }

  const parsed = text.trim() ? (JSON.parse(text) as AppUploadResponse) : {};
  if (!parsed.app_uri) {
    throw new Error("App upload response did not include app_uri.");
  }
  return parsed.app_uri;
}

async function buildImportOptions(parsed: ParsedArgs): Promise<ImportOptions> {
  const apiBaseUrl = getApiBaseUrl(valueOf(parsed.values, "--api-url", "--controller-url", "--studio-url"));
  const caseId = flagOrEnv(parsed.values, ["--id", "--case-id"], ["OASIZ_TEST_CASE_ID"])?.trim();
  const workspaceId = flagOrEnv(parsed.values, ["--workspace", "--workspace-id"], [
    "OASIZ_WORKSPACE_ID",
    "OASIZ_STUDIO_WORKSPACE_ID",
    "WORKSPACE_ID",
  ])?.trim();
  if (!workspaceId && !caseId) {
    throw new Error("Missing workspace id. Set OASIZ_WORKSPACE_ID, or set OASIZ_TEST_CASE_ID to update an existing case.");
  }

  const provider = (flagOrEnv(parsed.values, ["--provider"], ["OASIZ_TEST_PROVIDER", "TEST_RUN_DEFAULT_PROVIDER"]) || "app-percy").trim();
  const testType = inferTestType(parsed.values, provider).trim();
  const appUri = flagOrEnv(parsed.values, ["--app-uri"], [
    "OASIZ_TEST_APP_URI",
    "OASIZ_TEST_APP",
    "OASIZ_TEST_BUILD_URI",
    "OASIZ_TEST_PROVIDER_APP_URI",
    "APP_PERCY_DEFAULT_APP_URI",
    "BROWSERSTACK_DEFAULT_APP_URI",
  ])?.trim();
  const appFile = flagOrEnv(parsed.values, ["--app-file"], ["OASIZ_TEST_APP_FILE"])?.trim();
  if (appUri && appFile) {
    throw new Error("Use only one of --app-uri or --app-file.");
  }

  const replayPath = flagOrEnv(parsed.values, ["--replay", "--replay-json"], [
    "OASIZ_TEST_REPLAY_PATH",
    "OASIZ_TEST_REPLAY_JSON",
  ])?.trim();
  const appiumPath =
    valueOf(parsed.values, "--appium", "--appium-script", "--test", "--test-path")?.trim() ||
    envValues("OASIZ_TEST_PATHS", "OASIZ_TEST_PATH", "OASIZ_TEST_APPIUM_PATHS", "OASIZ_TEST_APPIUM_PATH", "OASIZ_TEST_APPIUM_SCRIPT").at(
      0,
    );
  const launchManifestPath = detectLaunchManifestPath(appiumPath, flagOrEnv(parsed.values, ["--launch-manifest"], [
    "OASIZ_TEST_LAUNCH_MANIFEST",
    "OASIZ_TEST_LAUNCH_MANIFEST_PATH",
  ])?.trim());
  const deviceMatrixPath = flagOrEnv(parsed.values, ["--device-matrix"], [
    "OASIZ_TEST_DEVICE_MATRIX",
    "OASIZ_TEST_DEVICE_MATRIX_PATH",
  ])?.trim();
  const devices = flagOrEnvValues(parsed.values, ["--device"], [
    "OASIZ_TEST_DEVICE",
    "OASIZ_TEST_DEVICES",
    "APP_PERCY_DEFAULT_DEVICES",
    "BROWSERSTACK_DEFAULT_DEVICES",
  ])
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ browserstack_name: name }));
  if (devices.length > 0 && deviceMatrixPath) {
    throw new Error("Use only one of --device or --device-matrix.");
  }

  const request: SaveTestCaseRequest = {
    provider,
    test_type: testType,
  };
  if (workspaceId) request.workspace_id = workspaceId;
  const simpleFields: Array<[keyof SaveTestCaseRequest, string | undefined]> = [
    ["name", flagOrEnv(parsed.values, ["--name"], ["OASIZ_TEST_CASE_NAME", "OASIZ_TEST_NAME"])?.trim()],
    ["game", flagOrEnv(parsed.values, ["--game", "--game-id"], ["OASIZ_TEST_GAME_ID", "OASIZ_TEST_GAME", "OASIZ_GAME_SLUG"])?.trim()],
    ["description", flagOrEnv(parsed.values, ["--description"], ["OASIZ_TEST_DESCRIPTION"])?.trim()],
    ["objective", flagOrEnv(parsed.values, ["--objective"], ["OASIZ_TEST_OBJECTIVE"])?.trim()],
    ["status", flagOrEnv(parsed.values, ["--status"], ["OASIZ_TEST_STATUS"])?.trim()],
    ["app_id", flagOrEnv(parsed.values, ["--app-id"], ["OASIZ_TEST_APP_ID", "TEST_RUN_DEFAULT_APP_ID"])?.trim()],
    ["app_uri", appUri],
    [
      "app_build_id",
      flagOrEnv(parsed.values, ["--app-build-id"], [
        "OASIZ_TEST_APP_BUILD_ID",
        "APP_PERCY_DEFAULT_APP_BUILD_ID",
        "BROWSERSTACK_DEFAULT_APP_BUILD_ID",
      ])?.trim(),
    ],
    ["conversion_status", flagOrEnv(parsed.values, ["--conversion-status"], ["OASIZ_TEST_CONVERSION_STATUS"])?.trim()],
    ["conversion_error", flagOrEnv(parsed.values, ["--conversion-error"], ["OASIZ_TEST_CONVERSION_ERROR"])?.trim()],
  ];
  for (const [key, value] of simpleFields) {
    if (value) {
      (request as Record<string, unknown>)[key] = value;
    }
  }
  if (replayPath) request.replay_script = await readReplayJson(replayPath);
  if (launchManifestPath) request.launch_manifest = await readLaunchManifest(launchManifestPath);
  if (!request.launch_manifest) request.launch_manifest = generatedLaunchManifest(parsed.values);
  if (appiumPath) request.appium_script = await readAppiumScript(appiumPath, request.launch_manifest);
  const notificationEmails = [
    ...flagOrEnvValues(parsed.values, ["--notify", "--notification-email", "--notification-emails"], [
      "OASIZ_TEST_NOTIFY_EMAILS",
      "OASIZ_TEST_NOTIFICATION_EMAILS",
    ]),
  ]
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (notificationEmails.length > 0) {
    request.notification_emails = Array.from(new Set(notificationEmails));
  }
  if (devices.length > 0) request.device_matrix = devices;
  if (deviceMatrixPath) request.device_matrix = await readDeviceMatrix(deviceMatrixPath);

  return {
    apiBaseUrl,
    caseId,
    request,
    appFile,
    appCustomId: flagOrEnv(parsed.values, ["--app-custom-id"], ["OASIZ_TEST_APP_CUSTOM_ID"])?.trim(),
    dryRun: flagOrEnvBoolean(parsed, ["--dry-run"], ["OASIZ_TEST_DRY_RUN", "OASIZ_CLI_DRY_RUN"]),
    json: flagOrEnvBoolean(parsed, ["--json"], ["OASIZ_TEST_JSON", "OASIZ_CLI_JSON"]),
  };
}

async function saveTestCase(options: ImportOptions, quiet = false): Promise<TestCaseResponse> {
  const endpointPath = options.caseId ? "/test-cases/" + encodeURIComponent(options.caseId) : "/test-cases";
  const method = options.caseId ? "PUT" : "POST";

  if (options.appFile) {
    if (!quiet && !options.json) {
      console.log("Uploading app file...");
    }
    options.request.app_uri = await uploadAppFile(
      options.apiBaseUrl,
      options.appFile,
      options.request.provider,
      options.request.test_type,
      options.appCustomId,
    );
    if (!quiet && !options.json) {
      console.log("App URI: " + options.request.app_uri);
    }
  }

  return await studioRequest<TestCaseResponse>(options.apiBaseUrl, endpointPath, {
    method,
    body: options.request,
  });
}

function printImportResult(result: TestCaseResponse, updated: boolean): void {
  console.log("");
  console.log(updated ? "Studio test case updated." : "Studio test case imported.");
  if (result.id) console.log("  ID: " + result.id);
  if (result.workspace_id) console.log("  Workspace: " + result.workspace_id);
  if (result.name) console.log("  Name: " + result.name);
  if (result.game) console.log("  Game: " + result.game);
  if (result.provider) console.log("  Provider: " + result.provider);
  if (result.test_type) console.log("  Test type: " + result.test_type);
  if (result.app_uri) console.log("  App URI: " + result.app_uri);
  if (result.status) console.log("  Status: " + result.status);
  if (result.conversion_status) console.log("  Conversion: " + result.conversion_status);
}

function terminalRunStatus(status: string | undefined): boolean {
  return ["passed", "failed", "error", "canceled", "cancelled", "timeout", "timed_out"].includes((status || "").toLowerCase());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numericFlagOrEnv(
  values: Map<string, string[]>,
  flagNames: string[],
  envNames: string[],
  defaultValue: number,
): number {
  const raw = flagOrEnv(values, flagNames, envNames)?.trim();
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error((flagNames[0] || envNames[0]) + " must be a positive number.");
  }
  return parsed;
}

function testPathsForRun(values: Map<string, string[]>): string[] {
  return flagOrEnvValues(values, ["--test", "--test-path", "--appium", "--appium-script"], [
    "OASIZ_TEST_PATHS",
    "OASIZ_TEST_PATH",
    "OASIZ_TEST_APPIUM_PATHS",
    "OASIZ_TEST_APPIUM_PATH",
    "OASIZ_TEST_APPIUM_SCRIPT",
  ]);
}

function parsedForTestPath(parsed: ParsedArgs, testPath: string | undefined, launchManifestPath: string | undefined): ParsedArgs {
  const next = cloneParsedArgs(parsed);
  deleteParsedValues(next, ["--test", "--test-path", "--appium", "--appium-script", "--launch-manifest"]);
  if (testPath) setParsedValue(next, "--appium", testPath);
  if (launchManifestPath) setParsedValue(next, "--launch-manifest", launchManifestPath);
  return next;
}

function runRequestFromOptions(options: ImportOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    provider: options.request.provider,
    test_type: options.request.test_type,
  };
  if (options.request.objective) body.objective = options.request.objective;
  if (options.request.notification_emails) body.notification_emails = options.request.notification_emails;
  if (options.request.app_id) body.app_id = options.request.app_id;
  if (options.request.app_uri) body.app_uri = options.request.app_uri;
  if (options.request.app_build_id) body.app_build_id = options.request.app_build_id;
  if (options.request.launch_manifest) body.launch_manifest = options.request.launch_manifest;
  if (options.request.device_matrix) body.device_matrix = options.request.device_matrix;
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

async function pollRun(apiBaseUrl: string, run: TestRunResponse, intervalMs: number, timeoutMs: number): Promise<TestRunResponse> {
  if (!run.id || terminalRunStatus(run.status)) return run;

  const deadline = Date.now() + timeoutMs;
  let latest = run;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    latest = await studioRequest<TestRunResponse>(apiBaseUrl, "/test-runs/" + encodeURIComponent(run.id));
    if (terminalRunStatus(latest.status)) return latest;
  }

  throw new Error(
    "Timed out waiting for Studio test run " +
      run.id +
      ". Last status: " +
      (latest.status || "unknown") +
      ". Increase OASIZ_TEST_TIMEOUT_MS if the provider run is still active.",
  );
}

async function writeRunOutput(path: string, payload: unknown): Promise<void> {
  const resolved = resolveProjectPath(path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function artifactDisplayName(artifact: TestArtifact, index: number): string {
  return artifact.name || artifact.label || artifact.kind || "artifact-" + String(index + 1);
}

function sanitizeFileSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/https?:\/\//g, "")
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "artifact"
  );
}

function artifactBaseName(artifact: TestArtifact, index: number): string {
  const number = String(index + 1).padStart(2, "0");
  const rawName = artifact.kind ? artifact.kind + "-" + artifactDisplayName(artifact, index) : artifactDisplayName(artifact, index);
  return number + "-" + sanitizeFileSegment(rawName);
}

function browserStackAuthHeader(url: string): string | undefined {
  if (!isBrowserStackApiUrl(url)) return undefined;
  const username = process.env.BROWSERSTACK_USERNAME?.trim();
  const accessKey = process.env.BROWSERSTACK_ACCESS_KEY?.trim();
  if (!username || !accessKey) return undefined;
  return "Basic " + Buffer.from(username + ":" + accessKey).toString("base64");
}

function isBrowserStackApiUrl(url: string): boolean {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return hostname === "api.browserstack.com" || hostname === "api-cloud.browserstack.com";
}

function artifactExtension(url: string, contentType: string): string {
  const normalizedContentType = contentType.split(";")[0]?.trim().toLowerCase() || "";
  if (normalizedContentType.includes("application/json")) return ".json";
  if (normalizedContentType.startsWith("text/") || normalizedContentType.includes("xml")) return ".txt";
  if (normalizedContentType.includes("video/mp4")) return ".mp4";
  if (normalizedContentType.includes("image/png")) return ".png";
  if (normalizedContentType.includes("image/jpeg")) return ".jpg";

  try {
    const pathExtension = extname(new URL(url).pathname);
    if (pathExtension) return pathExtension;
  } catch {
    // Fall back to .bin below.
  }
  return ".bin";
}

async function fetchArtifactBytes(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const headers: Record<string, string> = {};
  const auth = browserStackAuthHeader(url);
  if (auth) headers.Authorization = auth;

  const response = await fetch(url, { headers });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    const preview = bytes.toString("utf8", 0, Math.min(bytes.length, 240)).replace(/\s+/g, " ").trim();
    const credentialHint = isBrowserStackApiUrl(url) && !auth
      ? " Set BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY to download BrowserStack artifacts."
      : "";
    throw new Error("Artifact download failed (" + response.status + ") for " + url + ". " + preview + credentialHint);
  }
  return { bytes, contentType: response.headers.get("content-type") || "" };
}

async function writeUrlArtifact(outputDir: string, baseName: string, artifact: TestArtifact): Promise<DownloadedArtifact | null> {
  if (!artifact.url) return null;
  const path = join(outputDir, baseName + ".url");
  await writeFile(path, artifact.url + "\n", "utf8");
  return {
    kind: artifact.kind || "link",
    name: artifactDisplayName(artifact, 0),
    url: artifact.url,
    path,
  };
}

async function downloadUrlArtifact(
  outputDir: string,
  baseName: string,
  artifact: TestArtifact,
  index: number,
): Promise<DownloadedArtifact[]> {
  if (!artifact.url) return [];
  if ((artifact.kind || "").toLowerCase() === "session" || artifact.url.includes("/dashboard/")) {
    const link = await writeUrlArtifact(outputDir, baseName, artifact);
    return link ? [link] : [];
  }

  const { bytes, contentType } = await fetchArtifactBytes(artifact.url);
  const extension = artifactExtension(artifact.url, contentType);
  const path = join(outputDir, baseName + extension);
  await writeFile(path, bytes);

  const downloaded: DownloadedArtifact[] = [
    {
      kind: artifact.kind || "artifact",
      name: artifactDisplayName(artifact, index),
      url: artifact.url,
      path,
    },
  ];

  if (extension === ".json") {
    const nested = await downloadBrowserStackSessionArtifacts(outputDir, bytes);
    downloaded.push(...nested);
  }

  return downloaded;
}

async function writeArtifactError(
  outputDir: string,
  baseName: string,
  artifact: TestArtifact,
  index: number,
  error: unknown,
): Promise<DownloadedArtifact> {
  const message = error instanceof Error ? error.message : String(error);
  const path = join(outputDir, baseName + ".error.txt");
  await writeFile(path, message + "\n", "utf8");
  return {
    kind: artifact.kind || "artifact",
    name: artifactDisplayName(artifact, index),
    url: artifact.url || "",
    path,
    error: message,
  };
}

function browserStackNestedArtifacts(raw: unknown): TestArtifact[] {
  const session =
    raw && typeof raw === "object" && "automation_session" in raw
      ? (raw as { automation_session?: unknown }).automation_session
      : raw;
  if (!session || typeof session !== "object") return [];

  const values = session as Record<string, unknown>;
  const candidates: Array<[string, string, unknown]> = [
    ["video", "BrowserStack video", values.video_url],
    ["device_logs", "BrowserStack device logs", values.device_logs_url],
    ["appium_logs", "BrowserStack Appium logs", values.appium_logs_url],
    ["session_terminal_logs", "BrowserStack session terminal logs", values.session_terminal_logs_url],
    ["build_terminal_logs", "BrowserStack build terminal logs", values.build_terminal_logs_url],
  ];

  return candidates
    .filter(([, , url]) => typeof url === "string" && url.length > 0)
    .map(([kind, name, url]) => ({ kind, name, url: url as string }));
}

async function downloadBrowserStackSessionArtifacts(outputDir: string, bytes: Buffer): Promise<DownloadedArtifact[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return [];
  }

  const nestedArtifacts = browserStackNestedArtifacts(parsed);
  const downloaded: DownloadedArtifact[] = [];
  for (let index = 0; index < nestedArtifacts.length; index += 1) {
    const nested = nestedArtifacts[index];
    if (!nested.url) continue;
    if (nested.kind === "video") {
      const link = await writeUrlArtifact(outputDir, "browserstack-video", nested);
      if (link) downloaded.push(link);
      continue;
    }
    const baseName = "browserstack-" + sanitizeFileSegment(nested.kind || String(index + 1));
    try {
      downloaded.push(...(await downloadUrlArtifact(outputDir, baseName, nested, index)));
    } catch (error) {
      downloaded.push(await writeArtifactError(outputDir, baseName, nested, index, error));
    }
  }
  return downloaded;
}

async function downloadRunArtifacts(run: TestRunResponse, outputDir: string): Promise<DownloadedArtifact[]> {
  const resolvedOutputDir = resolveProjectPath(outputDir);
  await mkdir(resolvedOutputDir, { recursive: true });
  await writeFile(join(resolvedOutputDir, "run.json"), JSON.stringify(run, null, 2) + "\n", "utf8");

  const downloaded: DownloadedArtifact[] = [];
  for (let index = 0; index < (run.artifacts || []).length; index += 1) {
    const artifact = (run.artifacts || [])[index];
    if (!artifact?.url) continue;
    const baseName = artifactBaseName(artifact, index);
    try {
      downloaded.push(...(await downloadUrlArtifact(resolvedOutputDir, baseName, artifact, index)));
    } catch (error) {
      downloaded.push(await writeArtifactError(resolvedOutputDir, baseName, artifact, index, error));
    }
  }
  return downloaded;
}

function printArtifactResult(run: TestRunResponse, outputDir: string | undefined, downloaded: DownloadedArtifact[]): void {
  console.log("");
  console.log("Studio test run artifacts.");
  if (run.id) console.log("  Run ID: " + run.id);
  if (run.status) console.log("  Status: " + run.status);
  if (run.outcome) console.log("  Outcome: " + run.outcome);
  if (run.provider_console_url) console.log("  Provider URL: " + run.provider_console_url);
  if (run.artifacts?.length) {
    console.log("  Artifact links:");
    for (const artifact of run.artifacts) {
      console.log("    - " + (artifact.kind || "artifact") + ": " + (artifact.url || ""));
    }
  }
  if (outputDir) {
    console.log("  Downloaded to: " + resolveProjectPath(outputDir));
    for (const artifact of downloaded) {
      console.log("    - " + artifact.kind + ": " + artifact.path + (artifact.error ? " (download error)" : ""));
    }
  }
}

function printRunResult(payload: { results: TestCaseRunResult[]; output_path?: string }): void {
  if (payload.output_path) {
    console.log("Studio test run result written: " + payload.output_path);
    return;
  }

  for (const result of payload.results) {
    console.log("");
    console.log(result.dry_run ? "Would run Studio test case." : "Studio test run complete.");
    if (result.test_path) console.log("  Test path: " + result.test_path);
    if (result.case_id) console.log("  Case ID: " + result.case_id);
    if (result.run_id) console.log("  Run ID: " + result.run_id);
    if (result.status) console.log("  Status: " + result.status);
    if (result.outcome) console.log("  Outcome: " + result.outcome);
    if (result.provider_console_url) console.log("  Provider URL: " + result.provider_console_url);
    if (result.artifact_output_dir) console.log("  Artifacts: " + result.artifact_output_dir);
  }
}

async function commandImport(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.flagSet.has("--help") || parsed.flagSet.has("-h")) {
    printTestCaseHelp();
    return;
  }

  const options = await buildImportOptions(parsed);
  const endpointPath = options.caseId ? "/test-cases/" + encodeURIComponent(options.caseId) : "/test-cases";
  const method = options.caseId ? "PUT" : "POST";

  if (options.dryRun) {
    console.log("Would import Studio test case:");
    if (options.appFile) {
      console.log("  POST " + options.apiBaseUrl + "/test-apps/upload");
      console.log("  File: " + resolveProjectPath(options.appFile));
    }
    console.log("  " + method + " " + options.apiBaseUrl + endpointPath);
    console.log(JSON.stringify(options.appFile ? { ...options.request, app_uri: "(from app upload)" } : options.request, null, 2));
    return;
  }

  const result = await saveTestCase(options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printImportResult(result, Boolean(options.caseId));
}

async function commandRun(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.flagSet.has("--help") || parsed.flagSet.has("-h")) {
    printTestCaseHelp();
    return;
  }

  const explicitLaunchManifest = flagOrEnv(parsed.values, ["--launch-manifest"], [
    "OASIZ_TEST_LAUNCH_MANIFEST",
    "OASIZ_TEST_LAUNCH_MANIFEST_PATH",
  ])?.trim();
  const outputPath = flagOrEnv(parsed.values, ["--output", "--output-file"], [
    "OASIZ_TEST_OUTPUT_PATH",
    "OASIZ_TEST_RESULT_PATH",
    "OASIZ_TEST_RESULTS_PATH",
  ])?.trim();
  const artifactOutputDir = flagOrEnv(parsed.values, [], [
    "OASIZ_TEST_ARTIFACTS_DIR",
    "OASIZ_TEST_ARTIFACT_OUTPUT_DIR",
  ])?.trim();
  const pollIntervalMs = numericFlagOrEnv(parsed.values, ["--poll-interval-ms"], ["OASIZ_TEST_POLL_INTERVAL_MS"], 5000);
  const timeoutMs = numericFlagOrEnv(parsed.values, ["--timeout-ms"], ["OASIZ_TEST_TIMEOUT_MS"], 20 * 60 * 1000);
  const json = flagOrEnvBoolean(parsed, ["--json"], ["OASIZ_TEST_JSON", "OASIZ_CLI_JSON"]);
  const testPaths = testPathsForRun(parsed.values);
  const runInputs = testPaths.length > 0 ? testPaths : [undefined];
  const results: TestCaseRunResult[] = [];

  for (const testPath of runInputs) {
    const launchManifestPath = detectLaunchManifestPath(testPath, explicitLaunchManifest);
    const runParsed = parsedForTestPath(parsed, testPath, launchManifestPath);
    const options = await buildImportOptions(runParsed);
    if (!options.request.objective) {
      throw new Error("Missing test objective. Set OASIZ_TEST_OBJECTIVE before running a test case.");
    }
    const endpointPath = options.caseId ? "/test-cases/" + encodeURIComponent(options.caseId) : "/test-cases";
    const method = options.caseId ? "PUT" : "POST";
    const runRequest = runRequestFromOptions(options);

    if (options.dryRun) {
      const caseId = options.caseId || "(created test case id)";
      results.push({
        test_path: testPath ? resolveProjectPath(testPath) : undefined,
        launch_manifest_path: launchManifestPath ? resolveProjectPath(launchManifestPath) : undefined,
        case_id: options.caseId,
        dry_run: true,
        request: {
          import: {
            method,
            url: options.apiBaseUrl + endpointPath,
            body: options.appFile ? { ...options.request, app_uri: "(from app upload)" } : options.request,
          },
          run: {
            method: "POST",
            url: options.apiBaseUrl + "/test-cases/" + encodeURIComponent(caseId) + "/run",
            body: runRequest,
          },
        },
      });
      continue;
    }

    const testCase = await saveTestCase(options, true);
    const caseId = testCase.id || options.caseId;
    if (!caseId) {
      throw new Error("Studio test-case API did not return an id, and no OASIZ_TEST_CASE_ID was provided.");
    }

    const createdRun = await studioRequest<TestRunResponse>(options.apiBaseUrl, "/test-cases/" + encodeURIComponent(caseId) + "/run", {
      method: "POST",
      body: runRequest,
    });
    const finalRun = await pollRun(options.apiBaseUrl, createdRun, pollIntervalMs, timeoutMs);
    const resolvedArtifactOutputDir =
      artifactOutputDir && runInputs.length > 1 && (finalRun.id || createdRun.id)
        ? join(artifactOutputDir, finalRun.id || createdRun.id || "run")
        : artifactOutputDir;
    const downloadedArtifacts = resolvedArtifactOutputDir
      ? await downloadRunArtifacts(finalRun, resolvedArtifactOutputDir)
      : undefined;
    results.push({
      test_path: testPath ? resolveProjectPath(testPath) : undefined,
      launch_manifest_path: launchManifestPath ? resolveProjectPath(launchManifestPath) : undefined,
      case_id: caseId,
      run_id: finalRun.id || createdRun.id,
      status: finalRun.status || createdRun.status,
      outcome: finalRun.outcome || createdRun.outcome,
      provider_console_url: finalRun.provider_console_url || createdRun.provider_console_url,
      artifact_output_dir: resolvedArtifactOutputDir ? resolveProjectPath(resolvedArtifactOutputDir) : undefined,
      downloaded_artifacts: downloadedArtifacts,
      artifacts: finalRun.artifacts || createdRun.artifacts,
      test_case: testCase,
      run: finalRun,
    });
  }

  const payload: { results: TestCaseRunResult[]; output_path?: string } = { results };
  if (outputPath) {
    const resolvedOutputPath = resolveProjectPath(outputPath);
    payload.output_path = resolvedOutputPath;
    await writeRunOutput(resolvedOutputPath, payload);
  }

  if (json && !outputPath) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printRunResult(payload);
}

async function commandArtifacts(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  if (parsed.flagSet.has("--help") || parsed.flagSet.has("-h")) {
    printTestCaseHelp();
    return;
  }

  const runId = flagOrEnv(parsed.values, ["--run-id", "--id"], ["OASIZ_TEST_RUN_ID", "OASIZ_TEST_CASE_RUN_ID"])?.trim();
  if (!runId) {
    throw new Error("Missing test run id. Pass --run-id or set OASIZ_TEST_RUN_ID.");
  }

  const apiBaseUrl = getApiBaseUrl(valueOf(parsed.values, "--api-url", "--controller-url", "--studio-url"));
  const outputDir = flagOrEnv(parsed.values, ["--output", "--output-file"], [
    "OASIZ_TEST_ARTIFACTS_DIR",
    "OASIZ_TEST_ARTIFACT_OUTPUT_DIR",
  ])?.trim();
  const json = flagOrEnvBoolean(parsed, ["--json"], ["OASIZ_TEST_JSON", "OASIZ_CLI_JSON"]);
  const run = await studioRequest<TestRunResponse>(apiBaseUrl, "/test-runs/" + encodeURIComponent(runId));
  const downloaded = outputDir ? await downloadRunArtifacts(run, outputDir) : [];
  const payload = {
    run,
    artifacts: run.artifacts || [],
    downloaded,
    output_dir: outputDir ? resolveProjectPath(outputDir) : undefined,
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printArtifactResult(run, outputDir, downloaded);
}

export async function runTestCaseCli(args: string[] = []): Promise<void> {
  loadEnvSync();
  const command = args[0];
  if (command === "--help" || command === "-h") {
    printTestCaseHelp();
    return;
  }
  if (!command || command.startsWith("-")) {
    await commandImport(args);
    return;
  }

  switch (command) {
    case "import":
      await commandImport(args.slice(1));
      return;
    case "run":
    case "worker":
      await commandRun(args.slice(1));
      return;
    case "artifacts":
    case "artifact":
      await commandArtifacts(args.slice(1));
      return;
    default:
      throw new Error("Unknown test-case command: " + command);
  }
}

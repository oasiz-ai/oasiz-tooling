import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { getApiUrl, readStoredCredentials, resolveAuthToken, runBrowserLoginFlow, saveStoredCredentials } from "./lib/auth.ts";
import { type PublishConfig, writePublishConfig } from "./lib/game.ts";
import { getProjectRoot, toPosixPath } from "./lib/runtime.ts";

const MAX_UPLOAD_ASSET_SIZE_MB = 100;
const MAX_UPLOAD_ASSET_SIZE_BYTES = MAX_UPLOAD_ASSET_SIZE_MB * 1024 * 1024;
const MAX_RETRIES = 3;
const UPLOAD_CONCURRENCY = 6;
const UNITY_DIR = "Unity";

interface AssetEntry {
  path: string;
  buffer: Buffer;
  contentType: string;
}

interface UploadPayload {
  title: string;
  slug: string;
  description: string;
  category: string;
  email: string;
  gameId?: string;
  isMultiplayer?: boolean;
  maxPlayers?: number;
  verticalOnly?: boolean;
  thumbnailBase64?: string;
  bundleHtml: string;
  assets?: AssetEntry[];
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
    // Ignore malformed or unreadable .env files for parity with the Bun uploader.
  }
}

function logInfo(message: string): void {
  console.log(`[upload-game] ${message}`);
}

function logError(message: string): void {
  console.error(`[upload-game] ERROR: ${message}`);
}

function logSuccess(message: string): void {
  console.log(`[upload-game] ✓ ${message}`);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
}

function detectPackageManager(projectPath: string): "bun" | "npm" {
  if (existsSync(join(projectPath, "bun.lock")) || existsSync(join(projectPath, "bun.lockb"))) {
    return "bun";
  }
  return "npm";
}

async function runCommand(argv: string[], cwd: string, quiet: boolean = false): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: process.env,
      stdio: quiet ? ["ignore", "ignore", "pipe"] : "inherit",
    });
    let stderr = "";

    if (quiet) {
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }

    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error("Command failed (" + argv.join(" ") + ")" + (stderr ? "\n" + stderr.trim() : "")));
    });
  });
}

function getUploadGameFolders(): string[] {
  const rootDir = getProjectRoot();
  const excludeDirs = new Set(["scripts", "template", "templates", "node_modules", ".git", "unfinished-games", "perfect-drop", UNITY_DIR]);

  return readdirSync(rootDir, { withFileTypes: true })
    .filter((dirent) => {
      if (!dirent.isDirectory()) return false;
      if (excludeDirs.has(dirent.name)) return false;
      if (dirent.name.startsWith(".")) return false;

      const gamePath = join(rootDir, dirent.name);
      return existsSync(join(gamePath, "src", "main.ts")) || existsSync(join(gamePath, "index.html"));
    })
    .map((dirent) => dirent.name)
    .sort((a, b) => a.localeCompare(b));
}

function listUnityGames(): Array<{ name: string; hasPublish: boolean; hasBuild: boolean }> {
  const unityDir = join(getProjectRoot(), UNITY_DIR);
  if (!existsSync(unityDir)) return [];

  return readdirSync(unityDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => {
      const gamePath = join(unityDir, dirent.name);
      return {
        name: dirent.name,
        hasPublish: existsSync(join(gamePath, "publish.json")),
        hasBuild: existsSync(join(gamePath, "Build", "index.html")),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getAllFiles(dirPath: string, allFiles: string[] = []): string[] {
  if (!existsSync(dirPath)) return allFiles;
  const files = readdirSync(dirPath);
  for (const file of files) {
    const fullPath = join(dirPath, file);
    if (statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, allFiles);
    } else {
      allFiles.push(fullPath);
    }
  }
  return allFiles;
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".wasm": "application/wasm",
    ".json": "application/json",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

function resolveGamePath(gameFolder: string): { gamePath: string; isUnity: boolean } {
  const rootDir = getProjectRoot();

  if (gameFolder.startsWith(`${UNITY_DIR}/`) || gameFolder.startsWith(`${UNITY_DIR}\\`)) {
    const gamePath = join(rootDir, gameFolder);
    if (!existsSync(gamePath)) {
      throw new Error("Unity game folder not found: " + gameFolder);
    }
    return { gamePath, isUnity: true };
  }

  const rootPath = join(rootDir, gameFolder);
  if (existsSync(rootPath)) {
    return { gamePath: rootPath, isUnity: false };
  }

  const unityPath = join(rootDir, UNITY_DIR, gameFolder);
  if (existsSync(unityPath)) {
    logInfo(`Detected Unity game at Unity/${gameFolder}`);
    return { gamePath: unityPath, isUnity: true };
  }

  throw new Error("Game folder not found: " + gameFolder);
}

async function readUploadPublishConfig(gamePath: string): Promise<PublishConfig> {
  const publishPath = join(gamePath, "publish.json");
  const gameFolder = gamePath.split("/").pop() || "unknown";
  const defaultConfig: PublishConfig = {
    title: gameFolder,
    description: "test",
    category: "arcade",
  };

  if (!existsSync(publishPath)) {
    logInfo("No publish.json found, using defaults");
    return defaultConfig;
  }

  const text = await readFile(publishPath, "utf8");
  const config = JSON.parse(text) as Partial<PublishConfig>;
  return {
    title: config.title || defaultConfig.title,
    description: config.description || defaultConfig.description,
    category: config.category || defaultConfig.category,
    gameId: config.gameId,
    isMultiplayer: config.isMultiplayer,
    maxPlayers: config.maxPlayers,
    verticalOnly: config.verticalOnly,
  };
}

async function buildGame(gamePath: string): Promise<void> {
  const gameFolder = gamePath.split("/").pop();
  logInfo(`Building ${gameFolder}...`);

  try {
    const packageManager = detectPackageManager(gamePath);
    logInfo("Installing dependencies...");
    await runCommand(packageManager === "bun" ? ["bun", "install"] : ["npm", "install"], gamePath, true);

    const packageJsonPath = join(gamePath, "package.json");
    let useCustomBuild = false;
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      useCustomBuild = Boolean(packageJson.scripts?.build);
    }

    logInfo("Running build...");
    if (useCustomBuild) {
      await runCommand(packageManager === "bun" ? ["bun", "run", "build"] : ["npm", "run", "build"], gamePath, true);
    } else {
      await runCommand(packageManager === "bun" ? ["bunx", "--bun", "vite", "build"] : ["npx", "vite", "build"], gamePath, true);
    }
    logSuccess(`Built ${gameFolder}`);
  } catch (error) {
    logError(`Build failed for ${gameFolder}`);
    console.error(error);
    throw error;
  }
}

function hasExternalAssets(html: string): boolean {
  return (
    html.includes('src="./assets/') ||
    html.includes("src='./assets/") ||
    html.includes('src="/assets/') ||
    html.includes("src='/assets/") ||
    html.includes('href="./assets/') ||
    html.includes("href='./assets/") ||
    html.includes('href="/assets/') ||
    html.includes("href='/assets/") ||
    html.includes('href="./style.css') ||
    html.includes('href="/style.css')
  );
}

async function inlineUrlsInCss(
  cssContent: string,
  fileMap: Map<string, { content: string; isText: boolean }>,
  cssPath: string,
): Promise<string> {
  const urlRegex = /url\(["']?([^"')]+)["']?\)/gi;
  return cssContent.replace(urlRegex, (match, url) => {
    if (url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) return match;

    let resolvedPath = url;
    if (url.startsWith("./")) resolvedPath = url.slice(2);
    if (url.startsWith("/")) resolvedPath = url.slice(1);

    const cssDir = cssPath.includes("/") ? cssPath.split("/").slice(0, -1).join("/") : "";
    if (cssDir && !resolvedPath.startsWith("assets/")) {
      resolvedPath = cssDir + "/" + resolvedPath;
    }

    const fileData = fileMap.get(resolvedPath);
    if (fileData && !fileData.isText) {
      return `url(${fileData.content})`;
    }
    return match;
  });
}

function inlineAssetsInJs(
  jsContent: string,
  fileMap: Map<string, { content: string; isText: boolean }>,
): string {
  let result = jsContent;
  const assetFolders = ["assets", "audio", "images", "sounds", "music", "fonts", "data"];
  const folderPattern = assetFolders.join("|");
  const assetUrlRegex = new RegExp(`(["'])(\\.?\\/?)(${folderPattern})\\/([^"']+)(["'])`, "gi");

  result = result.replace(assetUrlRegex, (match, q1, _prefix, folder, assetPath, q2) => {
    const assetPathClean = assetPath.split("?")[0];
    const fullPath = `${folder}/${assetPathClean}`;
    const fileData = fileMap.get(fullPath);
    if (!fileData) return match;

    if (fileData.isText) {
      if (assetPathClean.endsWith(".json")) {
        let jsonContent = fileData.content;
        const jsonUrlRegex = /"url"\s*:\s*"([^"]+)"/gi;
        jsonContent = jsonContent.replace(jsonUrlRegex, (jsonMatch, url) => {
          if (url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) {
            return jsonMatch;
          }
          const urlClean = url.split("?")[0];
          const assetData = fileMap.get(urlClean);
          if (!assetData) return jsonMatch;
          if (assetData.isText) {
            const assetBase64 = Buffer.from(assetData.content).toString("base64");
            return `"url": "data:${getMimeType(url)};base64,${assetBase64}"`;
          }
          return `"url": "${assetData.content}"`;
        });
        return `${q1}data:application/json;base64,${Buffer.from(jsonContent).toString("base64")}${q2}`;
      }
      return `${q1}data:${getMimeType(fullPath)};base64,${Buffer.from(fileData.content).toString("base64")}${q2}`;
    }
    return `${q1}${fileData.content}${q2}`;
  });

  return result;
}

async function inlineAssets(gamePath: string, html: string): Promise<string> {
  const distPath = join(gamePath, "dist");
  let result = html;
  const allFiles = getAllFiles(distPath);
  const fileMap = new Map<string, { content: string; isText: boolean }>();
  const maxBinarySize = 10 * 1024 * 1024;

  for (const filePath of allFiles) {
    const relativePath = relative(distPath, filePath);
    const ext = extname(filePath).toLowerCase();
    const isTextFile = [".js", ".mjs", ".css", ".json", ".svg"].includes(ext);

    if (isTextFile) {
      fileMap.set(relativePath, { content: await readFile(filePath, "utf8"), isText: true });
      continue;
    }

    const fileSize = statSync(filePath).size;
    if (fileSize > maxBinarySize) {
      logInfo(`  Skipping large file: ${relativePath} (${(fileSize / 1024 / 1024).toFixed(1)}MB > 10MB limit)`);
      continue;
    }

    const buffer = await readFile(filePath);
    fileMap.set(relativePath, {
      content: `data:${getMimeType(filePath)};base64,${buffer.toString("base64")}`,
      isText: false,
    });
  }

  const cssLinkRegex = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  let cssMatch: RegExpExecArray | null;
  while ((cssMatch = cssLinkRegex.exec(html)) !== null) {
    const fullMatch = cssMatch[0];
    let href = cssMatch[1];
    if (href.startsWith("./")) href = href.slice(2);
    if (href.startsWith("/")) href = href.slice(1);
    const fileData = fileMap.get(href);
    if (fileData && fileData.isText) {
      let cssContent = fileData.content;
      cssContent = await inlineUrlsInCss(cssContent, fileMap, href);
      result = result.replace(fullMatch, `<style>${cssContent}</style>`);
      logInfo(`Inlined CSS: ${href}`);
    }
  }

  result = result.replace(/<link[^>]*rel=["']modulepreload["'][^>]*>/gi, "");

  const jsScriptRegex = /<script[^>]*src=["']([^"']+\.m?js)["'][^>]*><\/script>/gi;
  let jsMatch: RegExpExecArray | null;
  const replacements: Array<{ fullMatch: string; replacement: string }> = [];
  jsScriptRegex.lastIndex = 0;
  while ((jsMatch = jsScriptRegex.exec(result)) !== null) {
    const fullMatch = jsMatch[0];
    let src = jsMatch[1];
    if (src.startsWith("./")) src = src.slice(2);
    if (src.startsWith("/")) src = src.slice(1);

    const fileData = fileMap.get(src);
    if (fileData && fileData.isText) {
      let jsContent = inlineAssetsInJs(fileData.content, fileMap);
      const htmlTagPatterns = [/<\/script/gi, /<\/body/gi, /<\/head/gi, /<\/html/gi, /<!--/g, /-->/g];
      for (const pattern of htmlTagPatterns) {
        jsContent = jsContent.replace(pattern, (match) => match.replace(/</g, "\\u003c").replace(/>/g, "\\u003e"));
      }
      jsContent = jsContent.replace(/[\u0080-\uFFFF]/g, (char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"));
      const isModule = fullMatch.includes('type="module"') || fullMatch.includes("type='module'");
      replacements.push({
        fullMatch,
        replacement: isModule ? `<script type="module">${jsContent}</script>` : `<script>${jsContent}</script>`,
      });
      logInfo(`Inlined JS: ${src} (${(jsContent.length / 1024).toFixed(1)} KB)`);
    }
  }

  for (const replacement of replacements) {
    result = result.replace(replacement.fullMatch, replacement.replacement);
  }

  const assetSrcRegex = /(src=["'])(\.?\/?)assets\/([^"']+)(["'])/gi;
  result = result.replace(assetSrcRegex, (match, prefix, _slash, assetPath, suffix) => {
    const fileData = fileMap.get(`assets/${assetPath}`);
    return fileData && !fileData.isText ? `${prefix}${fileData.content}${suffix}` : match;
  });

  const assetHrefRegex = /(href=["'])(\.?\/?)assets\/([^"']+)(["'])/gi;
  result = result.replace(assetHrefRegex, (match, prefix, _slash, assetPath, suffix) => {
    const fileData = fileMap.get(`assets/${assetPath}`);
    return fileData && !fileData.isText ? `${prefix}${fileData.content}${suffix}` : match;
  });

  return result;
}

function getUnityPrebootLoggerBlock(): string {
  return `var prebootLogger = (() => {
        if (window.__prebootLogger) return window.__prebootLogger;

        var STORAGE_KEY = '__unity_preboot_logs';
        var LOGGER_MODE = "unity";
        var ALWAYS_EXPANDED = false;
        var AUTO_EXPAND_ON_ERROR = true;
        var SESSION_ID = String(Date.now());
        var TRACK_NETWORK_REQUESTS = LOGGER_MODE !== "html";
        var PATCH_CANVAS_CONTEXT = LOGGER_MODE !== "html";
        var OBSERVE_CANVASES = LOGGER_MODE !== "html";
        var INTERCEPT_LOGGER_INTERACTIONS = LOGGER_MODE !== "html";

        var entries = [];
        var maxEntries = 1200;
        var expanded = false;
        var errorCount = 0;
        var consolePatched = false;
        var originalConsole = {};
        var pendingFetches = {};
        var saveTimer = null;

        var prevSessionEntries = [];
        try {
          var storedRaw = localStorage.getItem(STORAGE_KEY);
          if (storedRaw) {
            var storedData = JSON.parse(storedRaw);
            if (storedData.sessionId !== SESSION_ID && Date.now() - storedData.ts < 600000) {
              prevSessionEntries = storedData.entries || [];
            }
          }
        } catch (_storageError) {}

        var root = document.createElement("div");
        root.id = "preboot-log-overlay";
        root.style.cssText = [
          "position:fixed",
          "bottom:12px",
          "right:12px",
          "z-index:2147483647",
          "width:min(560px,calc(100vw - 24px))",
          "max-height:min(46vh,420px)",
          "display:flex",
          "flex-direction:column",
          "background:rgba(9,14,20,0.95)",
          "border:1px solid #00A1E4",
          "border-radius:14px",
          "box-shadow:0 10px 30px rgba(0,0,0,0.4)",
          "overflow:hidden",
          "font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace",
          "color:#ecf7ff",
        ].join(";");

        var launcher = document.createElement("button");
        launcher.type = "button";
        launcher.id = "preboot-log-launcher";
        launcher.textContent = "Logs";
        launcher.style.cssText = [
          "position:fixed",
          "top:12px",
          "right:12px",
          "z-index:2147483647",
          "appearance:none",
          "border:1px solid rgba(0,161,228,0.6)",
          "background:rgba(9,14,20,0.92)",
          "color:#ecf7ff",
          "border-radius:999px",
          "padding:7px 12px",
          "font:11px/1.2 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace",
          "cursor:pointer",
          "touch-action:manipulation",
        ].join(";");

        var header = document.createElement("div");
        header.style.cssText = [
          "display:flex",
          "align-items:center",
          "justify-content:space-between",
          "gap:8px",
          "padding:8px 10px",
          "border-bottom:1px solid rgba(0,161,228,0.35)",
          "background:rgba(0,161,228,0.10)",
        ].join(";");

        var title = document.createElement("div");
        title.textContent = "Unity Logs";
        title.style.cssText = "font-weight:700;white-space:nowrap;";

        var countBadge = document.createElement("div");
        countBadge.style.cssText = [
          "border:1px solid rgba(0,161,228,0.45)",
          "border-radius:999px",
          "padding:2px 8px",
          "font-size:11px",
          "line-height:1.2",
          "color:#9fdfff",
          "background:rgba(0,161,228,0.08)",
        ].join(";");

        var actions = document.createElement("div");
        actions.style.cssText = "display:flex;gap:6px;align-items:center;";

        function makeButton(label, onClick) {
          var button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.style.cssText = [
            "appearance:none",
            "border:1px solid rgba(0,161,228,0.6)",
            "background:rgba(0,161,228,0.08)",
            "color:#ecf7ff",
            "border-radius:999px",
            "padding:4px 10px",
            "font-size:11px",
            "cursor:pointer",
            "touch-action:manipulation",
          ].join(";");
          button.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            onClick();
          });
          return button;
        }

        function isLoggerTarget(target) {
          return !!(target && typeof Node !== "undefined" && target instanceof Node && root.contains(target));
        }

        function swallowLoggerInteraction(event) {
          if (!isLoggerTarget(event.target)) return;
          if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
          if (typeof event.stopPropagation === "function") event.stopPropagation();
        }

        if (INTERCEPT_LOGGER_INTERACTIONS) {
          ["pointerdown", "touchstart", "mousedown"].forEach(function (eventName) {
            window.addEventListener(eventName, swallowLoggerInteraction, true);
          });
        }

        var prevSection = document.createElement("div");
        prevSection.style.cssText = [
          "display:none",
          "flex-direction:column",
          "border-bottom:1px solid rgba(255,196,94,0.3)",
          "background:rgba(255,196,94,0.04)",
          "max-height:min(18vh,160px)",
          "overflow:auto",
          "flex-shrink:0",
        ].join(";");

        var prevSectionLabel = document.createElement("div");
        prevSectionLabel.style.cssText = [
          "padding:4px 12px",
          "font-size:11px",
          "color:rgba(255,196,94,0.85)",
          "font-weight:600",
          "position:sticky",
          "top:0",
          "background:rgba(9,14,20,0.97)",
          "flex-shrink:0",
        ].join(";");
        prevSection.appendChild(prevSectionLabel);

        var body = document.createElement("div");
        body.style.cssText = "display:flex;flex-direction:column;overflow:auto;min-height:56px;padding:6px 0;";

        function formatCount(n) {
          if (n >= 1000) return (Math.floor(n / 100) / 10).toFixed(1) + "k";
          return String(n);
        }

        function updateBadge() {
          var text = formatCount(entries.length) + " logs";
          if (errorCount > 0) text += " / " + errorCount + " err";
          countBadge.textContent = text;
          countBadge.style.color = errorCount > 0 ? "#ffd6da" : "#9fdfff";
          countBadge.style.borderColor = errorCount > 0 ? "rgba(255,109,122,0.6)" : "rgba(0,161,228,0.45)";
          countBadge.style.background = errorCount > 0 ? "rgba(255,109,122,0.12)" : "rgba(0,161,228,0.08)";
        }

        function setExpanded(nextExpanded) {
          expanded = !!nextExpanded;
          body.style.display = expanded ? "flex" : "none";
          prevSection.style.display = (expanded && prevSessionEntries.length > 0) ? "flex" : "none";
          clearButton.style.display = expanded ? "inline-block" : "none";
          copyButton.style.display = expanded ? "inline-block" : "none";
          root.style.maxHeight = expanded ? "min(46vh,420px)" : "unset";
          root.style.width = expanded ? "min(560px,calc(100vw - 24px))" : "auto";
        }

        function setOverlayVisible(nextVisible) {
          var visible = !!nextVisible;
          root.style.display = visible ? "flex" : "none";
          root.style.pointerEvents = visible ? "auto" : "none";
          launcher.style.display = visible ? "none" : "inline-flex";
        }

        function makeLogRow(entry) {
          var row = document.createElement("div");
          var background =
            entry.level === "error"
              ? "rgba(255,109,122,0.16)"
              : entry.level === "warn"
                ? "rgba(255,196,94,0.14)"
                : "rgba(0,161,228,0.07)";
          row.style.cssText = [
            "padding:6px 12px",
            "white-space:pre-wrap",
            "word-break:break-word",
            "border-bottom:1px solid rgba(255,255,255,0.05)",
            "background:" + background,
          ].join(";");
          row.textContent = entry.text;
          return row;
        }

        function render() {
          updateBadge();
          if (!expanded) return;

          body.replaceChildren();
          if (entries.length === 0) {
            var empty = document.createElement("div");
            empty.textContent = "No logs yet";
            empty.style.cssText = "padding:8px 12px;color:rgba(236,247,255,0.7);";
            body.appendChild(empty);
            return;
          }

          entries.forEach(function (entry) { body.appendChild(makeLogRow(entry)); });
          body.scrollTop = body.scrollHeight;
        }

        function renderPrevSection() {
          if (prevSessionEntries.length === 0) return;
          prevSectionLabel.textContent = "Prev crash session - " + prevSessionEntries.length + " logs";
          while (prevSection.children.length > 1) prevSection.removeChild(prevSection.lastChild);
          prevSessionEntries.forEach(function (entry) { prevSection.appendChild(makeLogRow(entry)); });
          prevSection.scrollTop = prevSection.scrollHeight;
        }

        function pad(value, length) {
          var text = String(value);
          while (text.length < length) text = "0" + text;
          return text;
        }

        function formatNow() {
          var d = new Date();
          return "[" + pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2) + ":" + pad(d.getSeconds(), 2) + "." + pad(d.getMilliseconds(), 3) + "]";
        }

        function argsToText(args) {
          return Array.prototype.slice.call(args).map(function (value) {
            if (value instanceof Error) return value.stack || value.message;
            if (typeof value === "string") return value;
            try { return JSON.stringify(value); } catch (_jsonError) { return String(value); }
          }).join(" ");
        }

        function persistToStorage() {
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
              sessionId: SESSION_ID,
              ts: Date.now(),
              entries: entries.slice(-300),
            }));
          } catch (_persistError) {}
        }

        function saveToStorage(delayMs) {
          if (saveTimer) clearTimeout(saveTimer);
          var nextDelay = typeof delayMs === "number" ? delayMs : 150;
          if (nextDelay <= 0) {
            persistToStorage();
            return;
          }
          saveTimer = setTimeout(persistToStorage, nextDelay);
        }

        function push(level, message) {
          var text = formatNow() + " " + level.toUpperCase() + " " + message;
          entries.push({ level: level, text: text });
          if (level === "error") {
            errorCount += 1;
            if (AUTO_EXPAND_ON_ERROR && !expanded) setExpanded(true);
          }
          if (entries.length > maxEntries) {
            entries.splice(0, entries.length - maxEntries);
          }
          saveToStorage(level === "error" ? 0 : 150);
          render();
        }

        function patchConsoleMethod(methodName, level) {
          var original = console && console[methodName];
          if (typeof original !== "function") return;
          originalConsole[methodName] = original.bind(console);
          console[methodName] = function () {
            try { push(level, argsToText(arguments)); } catch (_error) {}
            return originalConsole[methodName].apply(console, arguments);
          };
        }

        function patchConsole() {
          if (consolePatched) return;
          patchConsoleMethod("log", "info");
          patchConsoleMethod("info", "info");
          patchConsoleMethod("warn", "warn");
          patchConsoleMethod("error", "error");
          patchConsoleMethod("debug", "debug");
          consolePatched = true;
          push("info", "Console monkey patch enabled");
        }

        function assetName(url) {
          try {
            var parsed = new URL(url, window.location.href);
            return parsed.pathname.split("/").slice(-2).join("/");
          } catch (_urlError) {
            return String(url);
          }
        }

        function patchFetch() {
          if (!window.fetch || window.fetch.__prebootPatched) return;
          var originalFetch = window.fetch.bind(window);
          window.fetch = function () {
            var input = arguments[0];
            var url = typeof input === "string" ? input : input && input.url ? input.url : "";
            var label = assetName(url);
            pendingFetches[label] = true;
            push("debug", "fetch start: " + label);
            return originalFetch.apply(window, arguments).then(function (response) {
              delete pendingFetches[label];
              if (!response.ok) push("warn", "fetch " + response.status + ": " + label);
              else push("debug", "fetch ok: " + label);
              return response;
            }).catch(function (error) {
              delete pendingFetches[label];
              push("error", "fetch failed: " + label + " " + (error && error.message ? error.message : String(error)));
              throw error;
            });
          };
          window.fetch.__prebootPatched = true;
        }

        function patchXHR() {
          if (!window.XMLHttpRequest || XMLHttpRequest.prototype.__prebootPatched) return;
          var open = XMLHttpRequest.prototype.open;
          var send = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.open = function (method, url) {
            this.__prebootUrl = url;
            return open.apply(this, arguments);
          };
          XMLHttpRequest.prototype.send = function () {
            var xhr = this;
            var label = assetName(xhr.__prebootUrl || "");
            pendingFetches[label] = true;
            push("debug", "xhr start: " + label);
            xhr.addEventListener("loadend", function () {
              delete pendingFetches[label];
              if (xhr.status >= 400) push("warn", "xhr " + xhr.status + ": " + label);
              else push("debug", "xhr done: " + label);
            });
            return send.apply(xhr, arguments);
          };
          XMLHttpRequest.prototype.__prebootPatched = true;
        }

        function describeCanvas(canvas) {
          if (!canvas) return "canvas";
          var label = canvas.id ? "#" + canvas.id : canvas.getAttribute("aria-label") || "canvas";
          var width = canvas.width || canvas.clientWidth || 0;
          var height = canvas.height || canvas.clientHeight || 0;
          return label + " (" + width + "x" + height + ")";
        }

        function attachCanvasLogger(canvas) {
          if (!canvas || canvas.__prebootCanvasHooked) return;
          canvas.__prebootCanvasHooked = true;
          push("info", "Canvas detected: " + describeCanvas(canvas));
          canvas.addEventListener("webglcontextlost", function (event) {
            push("error", "WebGL context lost on " + describeCanvas(canvas) + (event && event.statusMessage ? ": " + event.statusMessage : ""));
          }, false);
          canvas.addEventListener("webglcontextrestored", function () {
            push("warn", "WebGL context restored on " + describeCanvas(canvas));
          }, false);
        }

        function scanCanvases() {
          var canvases = document.querySelectorAll("canvas");
          Array.prototype.forEach.call(canvases, attachCanvasLogger);
        }

        function patchCanvasGetContext() {
          if (!window.HTMLCanvasElement || !HTMLCanvasElement.prototype) return;
          if (HTMLCanvasElement.prototype.__prebootGetContextPatched) return;
          var origGetContext = HTMLCanvasElement.prototype.getContext;
          if (typeof origGetContext !== "function") return;
          HTMLCanvasElement.prototype.getContext = function () {
            attachCanvasLogger(this);
            var contextType = typeof arguments[0] === "string" ? arguments[0] : "unknown";
            if (!this.__prebootContextTypes) this.__prebootContextTypes = {};
            if (!this.__prebootContextTypes[contextType]) {
              this.__prebootContextTypes[contextType] = true;
              push("info", "Canvas getContext(" + contextType + ") on " + describeCanvas(this));
            }
            return origGetContext.apply(this, arguments);
          };
          HTMLCanvasElement.prototype.__prebootGetContextPatched = true;
        }

        var toggleButton = makeButton("Close", function () { setOverlayVisible(false); });
        var clearButton = makeButton("Clear", function () {
          entries = [];
          errorCount = 0;
          try { localStorage.removeItem(STORAGE_KEY); } catch (_e) {}
          render();
        });
        var copyButton = makeButton("Copy", function () {
          var lines = [];
          if (prevSessionEntries.length > 0) {
            lines.push("=== Previous crash session ===");
            prevSessionEntries.forEach(function (e) { lines.push(e.text); });
            lines.push("=== Current session ===");
          }
          entries.forEach(function (e) { lines.push(e.text); });
          var text = lines.join("\\n");
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
              copyButton.textContent = "Copied!";
              setTimeout(function () { copyButton.textContent = "Copy"; }, 1500);
            }).catch(function () {
              prompt("Copy logs (select all, copy):", text);
            });
          } else {
            prompt("Copy logs (select all, copy):", text);
          }
        });

        launcher.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          setOverlayVisible(true);
          setExpanded(true);
          render();
        });

        actions.appendChild(countBadge);
        actions.appendChild(toggleButton);
        actions.appendChild(clearButton);
        actions.appendChild(copyButton);
        header.appendChild(title);
        header.appendChild(actions);
        root.appendChild(header);
        root.appendChild(prevSection);
        root.appendChild(body);

        document.documentElement.appendChild(root);
        document.documentElement.appendChild(launcher);

        var rootObserver = new MutationObserver(function () {
          if (!document.documentElement.contains(root)) document.documentElement.appendChild(root);
          if (!document.documentElement.contains(launcher)) document.documentElement.appendChild(launcher);
        });
        rootObserver.observe(document.documentElement, { childList: true });

        if (prevSessionEntries.length > 0) renderPrevSection();
        setExpanded(prevSessionEntries.length > 0 || ALWAYS_EXPANDED);
        setOverlayVisible(false);
        patchConsole();
        if (TRACK_NETWORK_REQUESTS) {
          patchXHR();
          patchFetch();
        }
        if (PATCH_CANVAS_CONTEXT) patchCanvasGetContext();
        if (OBSERVE_CANVASES) {
          scanCanvases();
          var canvasObserver = new MutationObserver(function () { scanCanvases(); });
          canvasObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
        document.addEventListener("visibilitychange", function () {
          push("info", "Visibility changed: " + document.visibilityState);
        });
        window.addEventListener("pagehide", function (event) {
          push("warn", "pagehide persisted=" + String(!!(event && event.persisted)));
        });
        window.addEventListener("pageshow", function (event) {
          push("info", "pageshow persisted=" + String(!!(event && event.persisted)));
        });
        render();
        push("info", "Preboot logger ready (" + LOGGER_MODE + ")");

        var loggerApi = {
          log: function () { push("info", argsToText(arguments)); },
          debug: function () { push("debug", argsToText(arguments)); },
          info: function () { push("info", argsToText(arguments)); },
          warn: function () { push("warn", argsToText(arguments)); },
          error: function () { push("error", argsToText(arguments)); },
          show: function () { setOverlayVisible(true); setExpanded(true); render(); },
          hide: function () { setOverlayVisible(false); },
          getEntries: function () { return entries.slice(); },
          getPendingAssets: function () { return Object.keys(pendingFetches).map(assetName); },
        };
        window.__prebootLogEntries = entries;
        window.__prebootLogger = loggerApi;
        return loggerApi;
      })();`;
}

function getUnityPlainLoaderBlock(): string {
  return `var prebootUnityLoaderSrc = "Build/Build.loader.js";
      var unityLoadingBar = document.querySelector("#unity-loading-bar");
      if (unityLoadingBar) unityLoadingBar.style.display = "block";

      var script = document.createElement("script");
      script.src = prebootUnityLoaderSrc;
      script.onload = function () {
        if (typeof createUnityInstance !== "function") {
          alert("Unity loader script did not expose createUnityInstance");
          return;
        }
        createUnityInstance(canvas, config, function (progress) {
          var progressBar = document.querySelector("#unity-progress-bar-full");
          if (progressBar) progressBar.style.width = 100 * progress + "%";
        }).then(function (unityInstance) {
          var fullscreenButton = document.querySelector("#unity-fullscreen-button");
          if (unityLoadingBar) unityLoadingBar.style.display = "none";
          if (fullscreenButton) {
            fullscreenButton.onclick = function () {
              unityInstance.SetFullscreen(1);
            };
          }
        }).catch(function (message) {
          alert(message);
        });
      };
      document.body.appendChild(script);`;
}

async function readUnityBundleHtml(gamePath: string, options: { injectPrebootLogger?: boolean } = {}): Promise<string> {
  const buildDir = join(gamePath, "Build");
  const htmlPath = join(buildDir, "index.html");
  const injectPrebootLogger = options.injectPrebootLogger === true;

  if (!existsSync(htmlPath)) {
    throw new Error(`Unity build HTML not found at ${join(buildDir, "index.html")}`);
  }

  let html = await readFile(htmlPath, "utf8");
  const hasOasizTemplateMarker = html.includes(`<meta name="oasiz-template" content="OasizDefault-v1">`);

  if (!hasOasizTemplateMarker) {
    html = html
      .replace(/var buildUrl\s*=\s*["']Build["'];?\s*/g, "")
      .replace(/buildUrl\s*\+\s*["']\/Build\.loader\.js["']/g, '"Build/Build.loader.js"')
      .replace(/buildUrl\s*\+\s*["'](\/Build\.data(?:\.br|\.gz)?)["']/g, '"Build$1"')
      .replace(/buildUrl\s*\+\s*["'](\/Build\.framework\.js(?:\.br|\.gz)?)["']/g, '"Build$1"')
      .replace(/buildUrl\s*\+\s*["'](\/Build\.wasm(?:\.br|\.gz)?)["']/g, '"Build$1"')
      .replace(/buildUrl\s*\+\s*["']\/StreamingAssets\/?["']/g, '"StreamingAssets"')
      .replace(/(\bstreamingAssetsUrl\b\s*[:=]\s*)["']StreamingAssets\/?["']/g, '$1"StreamingAssets"');
    logInfo("  Expanded JS path concatenations to literal strings");
  } else {
    logInfo("  Detected OasizDefault template marker; skipping buildUrl rewrites");
  }

  const dynamicLoaderPattern = /var script\s*=\s*document\.createElement\("script"\);[\s\S]*?document\.body\.appendChild\(script\);/;
  const loggedLoaderBlock = `var prebootUnityLoaderSrc = "Build/Build.loader.js";
      var unityLoadingBar = document.querySelector("#unity-loading-bar");
      if (unityLoadingBar) unityLoadingBar.style.display = "block";
      prebootLogger.info("Preparing Unity loader:", prebootUnityLoaderSrc);

      var script = document.createElement("script");
      script.src = prebootUnityLoaderSrc;
      script.onerror = function () {
        prebootLogger.error("Failed to load Unity loader script:", prebootUnityLoaderSrc);
      };
      script.onload = function () {
        prebootLogger.info("Unity loader script loaded");
        if (typeof createUnityInstance !== "function") {
          prebootLogger.error("Unity loader script did not expose createUnityInstance");
          alert("Unity loader script did not expose createUnityInstance");
          return;
        }
        prebootLogger.info("Calling createUnityInstance");
        createUnityInstance(canvas, config, function (progress) {
          var progressBar = document.querySelector("#unity-progress-bar-full");
          if (progressBar) progressBar.style.width = 100 * progress + "%";
          if (progress === 0 || progress === 1) {
            prebootLogger.info("Unity load progress:", Math.round(progress * 100) + "%");
          }
        }).then(function (unityInstance) {
          var fullscreenButton = document.querySelector("#unity-fullscreen-button");
          prebootLogger.info("Unity instance created successfully");
          if (unityLoadingBar) unityLoadingBar.style.display = "none";
          if (fullscreenButton) {
            fullscreenButton.onclick = function () {
              unityInstance.SetFullscreen(1);
            };
          }
        }).catch(function (message) {
          prebootLogger.error("createUnityInstance failed:", message);
          alert(message);
        });
      };
      document.body.appendChild(script);`;

  const preserveTemplateLoaderBlock = hasOasizTemplateMarker && !injectPrebootLogger;
  if (preserveTemplateLoaderBlock) {
    logInfo("  Preserving custom template loader/fullscreen logic (no loader-block rewrite)");
  } else if (dynamicLoaderPattern.test(html)) {
    html = html.replace(dynamicLoaderPattern, injectPrebootLogger ? loggedLoaderBlock : getUnityPlainLoaderBlock());
    html = html.replace(/\s*<script src="Build\/Build\.loader\.js"><\/script>\s*/g, "\n    ");
    logInfo(injectPrebootLogger ? "  Replaced Unity loader injection with logged dynamic loading" : "  Replaced Unity loader injection with dynamic loading (no on-page logger)");
  } else {
    logInfo("  Warning: could not find dynamic script-loading block — HTML may not load correctly");
  }

  if (!hasOasizTemplateMarker) {
    html = html.replace(/\s*var loaderUrl\s*=\s*[^;]+;\s*/g, "\n      ");
  }

  if (injectPrebootLogger) {
    if (html.includes(`var prebootLogger = (() => {`)) {
      html = html.replace(/var prebootLogger\s*=\s*\(\(\)\s*=>\s*\{[\s\S]*?\}\)\(\);/, getUnityPrebootLoggerBlock());
      logInfo("  Refreshed Unity preboot logger overlay");
    } else {
      html = html.replace(/var canvas\s*=\s*document\.querySelector\(["']#unity-canvas["']\);\s*/, (match: string) => {
        return match + "\n      " + getUnityPrebootLoggerBlock() + "\n      ";
      });
      if (!html.includes(`var prebootLogger = (() => {`)) {
        html = html.replace(/<head([^>]*)>/i, `<head$1>\n    <script>\n      ${getUnityPrebootLoggerBlock()}\n    </script>`);
      }
      logInfo("  Injected Unity preboot logger overlay");
    }

    if (!html.includes(`window.addEventListener("unhandledrejection"`)) {
      html = html.replace(/var warningBanner\s*=\s*document\.querySelector\(["']#unity-warning["']\);\s*/, (match: string) => {
        return match + getGenericPrebootErrorHooksBlock();
      });
      logInfo("  Added Unity preload error hooks");
    }

    if (!html.includes(`prebootLogger.error("Unity banner:", msg)`)) {
      html = html.replace(
        /function unityShowBanner\(msg, type\) \{/,
        `function unityShowBanner(msg, type) {
        if (type === "error") prebootLogger.error("Unity banner:", msg);
        else if (type === "warning") prebootLogger.warn("Unity banner:", msg);
        else prebootLogger.info("Unity banner:", msg);`,
      );
      logInfo("  Mirrored Unity banner messages into preboot logger");
    }
  } else {
    logInfo("  Skipped Unity preboot DOM logger (use --withlog to inject loader log overlay)");
  }

  return html;
}

function getHtmlPrebootLoggerBlock(): string {
  return getUnityPrebootLoggerBlock()
    .replace(`var STORAGE_KEY = '__unity_preboot_logs';`, `var STORAGE_KEY = '__html_preboot_logs';`)
    .replace(`var LOGGER_MODE = "unity";`, `var LOGGER_MODE = "html";`)
    .replace(`var AUTO_EXPAND_ON_ERROR = true;`, `var AUTO_EXPAND_ON_ERROR = false;`)
    .replace(`title.textContent = "Unity Logs";`, `title.textContent = "Game Logs";`);
}

function getGenericPrebootErrorHooksBlock(): string {
  return `
      window.addEventListener("error", function (event) {
        var target = event.target;
        if (target && target !== window && target.src) {
          prebootLogger.error("Resource failed to load:", target.src);
          return;
        }
        prebootLogger.error(
          event.message || "Unknown window error",
          event.filename ? "(" + event.filename + ":" + event.lineno + ")" : ""
        );
      }, true);

      window.addEventListener("unhandledrejection", function (event) {
        var reason = event.reason;
        prebootLogger.error("Unhandled promise rejection:", reason && reason.stack ? reason.stack : String(reason));
      });
  `;
}

function injectPrebootLoggerIntoHtml(html: string): string {
  if (html.includes(`window.__prebootLogger`) || html.includes(`var prebootLogger = (() => {`)) {
    return html;
  }

  const loggerScript = `<script>\n${getHtmlPrebootLoggerBlock()}\n${getGenericPrebootErrorHooksBlock()}\n    </script>`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n    ${loggerScript}`);
  }

  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>\n    ${loggerScript}`);
  }

  return `${loggerScript}\n${html}`;
}

async function collectAssets(gamePath: string): Promise<AssetEntry[]> {
  const distPath = join(gamePath, "dist");
  const assets: AssetEntry[] = [];
  if (!existsSync(distPath)) {
    logError("Dist folder not found");
    return assets;
  }

  const allFiles = getAllFiles(distPath);
  for (const filePath of allFiles) {
    const relativePath = toPosixPath(relative(distPath, filePath));
    if (relativePath.endsWith(".html")) continue;

    const fileSize = statSync(filePath).size;
    if (fileSize > MAX_UPLOAD_ASSET_SIZE_BYTES) {
      logInfo(`  Skipping very large file: ${relativePath} (${(fileSize / 1024 / 1024).toFixed(1)} MB > ${MAX_UPLOAD_ASSET_SIZE_MB} MB limit)`);
      continue;
    }

    const buffer = await readFile(filePath);
    assets.push({
      path: relativePath,
      buffer,
      contentType: getMimeType(filePath),
    });
  }

  return assets;
}

async function collectUnityAssets(gamePath: string): Promise<AssetEntry[]> {
  const buildDir = join(gamePath, "Build");
  const assets: AssetEntry[] = [];
  if (!existsSync(buildDir)) {
    logError("Unity Build folder not found");
    return assets;
  }

  const allFiles = getAllFiles(buildDir);
  for (const filePath of allFiles) {
    const relativePath = toPosixPath(relative(buildDir, filePath));
    if (relativePath === "index.html") continue;

    const fileSize = statSync(filePath).size;
    if (fileSize > MAX_UPLOAD_ASSET_SIZE_BYTES) {
      logInfo(`  Skipping very large file: ${relativePath} (${(fileSize / 1024 / 1024).toFixed(1)} MB > ${MAX_UPLOAD_ASSET_SIZE_MB} MB limit)`);
      continue;
    }

    logInfo(`  Collecting: ${relativePath} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
    const buffer = await readFile(filePath);
    assets.push({
      path: relativePath,
      buffer,
      contentType: getMimeType(filePath),
    });
  }
  return assets;
}

async function readBundleHtml(gamePath: string, useInlining: boolean = false, injectPrebootLogger: boolean = false): Promise<string> {
  const distPath = join(gamePath, "dist", "index.html");
  if (!existsSync(distPath)) {
    throw new Error("Build output not found at dist/index.html");
  }

  let html = await readFile(distPath, "utf8");
  if (useInlining && hasExternalAssets(html)) {
    logInfo("Detected multi-file build, inlining assets...");
    html = await inlineAssets(gamePath, html);
    logSuccess("All assets inlined into HTML");
  }
  if (injectPrebootLogger) {
    html = injectPrebootLoggerIntoHtml(html);
    logInfo("Injected HTML preboot logger overlay");
  }
  return html;
}

async function readThumbnail(gamePath: string): Promise<string | undefined> {
  const thumbnailDir = join(gamePath, "thumbnail");
  if (!existsSync(thumbnailDir)) {
    logInfo("No thumbnail folder found (optional)");
    return undefined;
  }

  const files = readdirSync(thumbnailDir);
  const imageFile = files.find((file) => /\.(png|jpe?g|webp|gif)$/i.test(file));
  if (!imageFile) {
    logInfo("No thumbnail image found in thumbnail/ folder");
    return undefined;
  }

  const fullPath = join(thumbnailDir, imageFile);
  const buffer = await readFile(fullPath);
  const lower = imageFile.toLowerCase();
  const mimeType = lower.endsWith(".png")
    ? "image/png"
    : lower.endsWith(".webp")
      ? "image/webp"
      : lower.endsWith(".gif")
        ? "image/gif"
        : "image/jpeg";

  logSuccess(`Found thumbnail: ${imageFile}`);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function summarizeAssetPayload(assets: AssetEntry[] | undefined): { count: number; approxBytes: number } {
  if (!assets) return { count: 0, approxBytes: 0 };
  return {
    count: assets.length,
    approxBytes: assets.reduce((sum, asset) => sum + asset.buffer.length, 0),
  };
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries: number = MAX_RETRIES): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || response.status < 500) return response;

      const errorText = await response.text().catch(() => "");
      if (attempt < maxRetries) {
        logInfo(`Server error ${response.status}, retry ${attempt}/${maxRetries}...`);
      } else {
        logError(`Server error ${response.status}: ${errorText}`);
        return response;
      }
    } catch (error) {
      if (attempt === maxRetries) throw error;
      logInfo(`Network error, retry ${attempt}/${maxRetries}...`);
    }
    const delay = Math.min(1000 * 2 ** (attempt - 1), 10000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error("Max retries exceeded");
}

function uploadAuthHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function buildCdnUrl(cdnBaseUrl: string, gameId: string, assetPath: string): string {
  const safeKey = `game-assets/${gameId}/${assetPath}`
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${cdnBaseUrl}/${safeKey}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyJsonJsAssetUrlRewrites(assetPath: string, assetBuffer: Buffer, assetUrlMap: Record<string, string>): Buffer {
  if (!assetPath.endsWith(".json") && !assetPath.endsWith(".js") && !assetPath.endsWith(".mjs")) {
    return assetBuffer;
  }

  let fileContent = assetBuffer.toString("utf8");
  let modified = false;
  const replacements: string[] = [];
  const isJs = assetPath.endsWith(".js") || assetPath.endsWith(".mjs");

  for (const [innerPath, innerCdnUrl] of Object.entries(assetUrlMap)) {
    if (innerPath === assetPath) continue;
    if (!isJs && (innerPath.endsWith(".js") || innerPath.endsWith(".css"))) continue;
    if (isJs) {
      const ext = innerPath.split(".").pop()?.toLowerCase() || "";
      const assetExts = ["json", "png", "jpg", "jpeg", "webp", "gif", "svg", "mp3", "wav", "ogg", "m4a", "glb", "gltf"];
      if (!assetExts.includes(ext)) continue;
    }

    const escapedInnerPath = escapeRegex(innerPath);
    const qs = '(\\?[^"]*)?';
    const patternsToTry = [`"${escapedInnerPath}${qs}"`, `"\\./${escapedInnerPath}${qs}"`, `"\\.\\./${escapedInnerPath}${qs}"`];

    if (innerPath.includes("/")) {
      const parts = innerPath.split("/");
      const folderAndFile = parts.slice(-2).join("/");
      if (folderAndFile !== innerPath) {
        const escapedFolderAndFile = escapeRegex(folderAndFile);
        patternsToTry.push(`"${escapedFolderAndFile}${qs}"`);
        patternsToTry.push(`"\\./${escapedFolderAndFile}${qs}"`);
        patternsToTry.push(`"\\.\\./${escapedFolderAndFile}${qs}"`);
      }
    }

    for (const patternStr of patternsToTry) {
      const pattern = new RegExp(patternStr, "g");
      const before = fileContent;
      fileContent = fileContent.replace(pattern, `"${innerCdnUrl}"`);
      if (fileContent !== before) {
        modified = true;
        replacements.push(innerPath);
        break;
      }
    }
  }

  if (modified) {
    logInfo(`  Rewrote ${replacements.length} URLs in ${isJs ? "JS" : "JSON"}: ${assetPath}`);
    return Buffer.from(fileContent, "utf8");
  }
  return assetBuffer;
}

async function uploadFileToR2(signedUrl: string, buffer: Buffer, contentType: string, path: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: buffer,
      });
      if (response.ok) return;
      if (attempt < MAX_RETRIES && response.status >= 500) {
        logInfo(`  R2 PUT ${path} failed (${response.status}), retry ${attempt}/${MAX_RETRIES}...`);
      } else {
        throw new Error(`R2 PUT failed for ${path}: ${response.status}`);
      }
    } catch (error) {
      if (attempt === MAX_RETRIES) throw error;
      logInfo(`  R2 PUT ${path} network error, retry ${attempt}/${MAX_RETRIES}...`);
    }
    const delay = Math.min(1000 * 2 ** (attempt - 1), 10000);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function uploadGame(payload: UploadPayload, token: string): Promise<{ gameId?: string; draftId?: string; gameUrl?: string }> {
  const startTime = Date.now();
  const uploadBaseUrl = getApiUrl("/api/upload/game");

  logInfo(`Initializing upload for "${payload.title}" via ${uploadBaseUrl}/init...`);
  const initRes = await fetchWithRetry(`${uploadBaseUrl}/init`, {
    method: "POST",
    headers: uploadAuthHeaders(token),
    body: JSON.stringify({
      title: payload.title,
      email: payload.email,
      description: payload.description,
      category: payload.category,
      gameId: payload.gameId,
      isMultiplayer: payload.isMultiplayer,
      maxPlayers: payload.maxPlayers,
      verticalOnly: payload.verticalOnly,
    }),
  });

  if (!initRes.ok) {
    const errorText = await initRes.text();
    logError(`Init failed (${initRes.status}): ${errorText}`);
    throw new Error("Upload init failed");
  }

  const initResult = (await initRes.json()) as {
    gameId: string;
    draftId?: string;
    isUpdate: boolean;
  };
  const { gameId, isUpdate } = initResult;
  logSuccess(`${isUpdate ? "Updating" : "Creating"} game ${gameId} (${((Date.now() - startTime) / 1000).toFixed(1)}s)`);

  const assets = payload.assets ?? [];
  const allAssetPaths = assets.map((asset) => asset.path);

  if (assets.length > 0) {
    const totalSize = assets.reduce((sum, asset) => sum + asset.buffer.length, 0);
    logInfo(`Uploading ${assets.length} assets (${(totalSize / 1024 / 1024).toFixed(1)} MB) via pre-signed URLs...`);

    const presignStart = Date.now();
    const presignRes = await fetchWithRetry(`${uploadBaseUrl}/${gameId}/presign`, {
      method: "POST",
      headers: uploadAuthHeaders(token),
      body: JSON.stringify({
        assets: assets.map((asset) => ({
          path: asset.path,
          contentType: asset.contentType,
        })),
      }),
    });

    if (!presignRes.ok) {
      const errorText = await presignRes.text();
      logError(`Presign failed (${presignRes.status}): ${errorText}`);
      throw new Error("Upload presign failed");
    }

    const { cdnBaseUrl, urls: signedUrls } = (await presignRes.json()) as {
      cdnBaseUrl: string;
      urls: Record<string, string>;
    };
    logSuccess(`Got ${Object.keys(signedUrls).length} signed URLs (${((Date.now() - presignStart) / 1000).toFixed(1)}s)`);

    const cdnUrlMap: Record<string, string> = {};
    for (const assetPath of allAssetPaths) {
      cdnUrlMap[assetPath] = buildCdnUrl(cdnBaseUrl, gameId, assetPath);
    }

    const assetBuffers = new Map<string, Buffer>();
    for (const asset of assets) {
      assetBuffers.set(asset.path, applyJsonJsAssetUrlRewrites(asset.path, asset.buffer, cdnUrlMap));
    }

    const uploadStart = Date.now();
    let uploaded = 0;
    const uploadTasks = assets.map((asset) => async () => {
      const signedUrl = signedUrls[asset.path];
      if (!signedUrl) {
        throw new Error(`No signed URL for ${asset.path}`);
      }
      const buffer = assetBuffers.get(asset.path) ?? asset.buffer;
      await uploadFileToR2(signedUrl, buffer, asset.contentType, asset.path);
      uploaded += 1;
      if (uploaded % 5 === 0 || uploaded === assets.length) {
        logInfo(`  ${uploaded}/${assets.length} assets uploaded...`);
      }
    });

    await runWithConcurrency(uploadTasks, UPLOAD_CONCURRENCY);
    logSuccess(`All ${assets.length} assets uploaded to R2 (${((Date.now() - uploadStart) / 1000).toFixed(1)}s)`);
  }

  logInfo("Uploading HTML and finalizing...");
  const syncStart = Date.now();
  const syncRes = await fetchWithRetry(`${uploadBaseUrl}/${gameId}/sync-html`, {
    method: "POST",
    headers: uploadAuthHeaders(token),
    body: JSON.stringify({
      bundleHtml: payload.bundleHtml,
      allAssetPaths,
      isNewGame: !isUpdate,
    }),
  });

  if (!syncRes.ok) {
    const errorText = await syncRes.text();
    logError(`sync-html failed (${syncRes.status}): ${errorText}`);
    throw new Error("Upload sync-html failed");
  }

  const syncResult = (await syncRes.json()) as {
    gameId: string;
    draftId?: string;
    r2Key?: string;
    gameUrl?: string;
  };
  logSuccess(`HTML synced (${((Date.now() - syncStart) / 1000).toFixed(1)}s)`);

  if (payload.thumbnailBase64) {
    logInfo("Uploading thumbnail...");
    const thumbRes = await fetchWithRetry(`${uploadBaseUrl}/${gameId}/thumbnail`, {
      method: "POST",
      headers: uploadAuthHeaders(token),
      body: JSON.stringify({ thumbnail: payload.thumbnailBase64 }),
    });
    if (thumbRes.ok) {
      logSuccess("Thumbnail uploaded");
    } else {
      logInfo("Thumbnail upload failed (non-critical, will be auto-generated)");
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  logSuccess(`Upload complete in ${totalTime}s!`);
  if (syncResult.gameUrl) {
    logSuccess(`Game URL: ${syncResult.gameUrl}`);
  }

  return {
    gameId: syncResult.gameId || gameId,
    draftId: syncResult.draftId || initResult.draftId,
    gameUrl: syncResult.gameUrl,
  };
}

async function validateAuthForUpload(): Promise<{ token: string; creatorEmail: string }> {
  let token = await resolveAuthToken();
  const storedCredentials = await readStoredCredentials();
  let creatorEmail = process.env.OASIZ_EMAIL || storedCredentials?.email;

  if (!token || !creatorEmail) {
    logInfo(
      !token
        ? "No API token found; starting browser login..."
        : "No creator email found in OASIZ_EMAIL or saved login credentials; starting browser login...",
    );
    const loginResult = await runBrowserLoginFlow(true);
    await saveStoredCredentials({
      token: loginResult.token,
      email: loginResult.email,
      createdAt: new Date().toISOString(),
    });
    token = loginResult.token;
    creatorEmail = loginResult.email || creatorEmail;
    logSuccess("Login successful");
    if (loginResult.email) {
      logSuccess("Signed in as " + loginResult.email);
    }
  }

  if (!token) {
    throw new Error("No API token found. Set OASIZ_CLI_TOKEN or OASIZ_UPLOAD_TOKEN, or run `oasiz login`.");
  }

  if (!creatorEmail) {
    throw new Error("No creator email found. Set OASIZ_EMAIL, or run `oasiz login` so the CLI can save your registered Oasiz email.");
  }

  return { token, creatorEmail };
}

export async function listUploadGames(): Promise<void> {
  loadEnvSync();
  const regularGames = getUploadGameFolders();
  const unityGames = listUnityGames();
  const rootDir = getProjectRoot();

  console.log("Available games (TypeScript/Vite):");
  regularGames.forEach((game) => {
    const hasPublish = existsSync(join(rootDir, game, "publish.json"));
    console.log(`  ${hasPublish ? "✓" : "○"} ${game}`);
  });
  if (regularGames.length === 0) console.log("  (none)");

  console.log("");
  console.log("Available games (Unity WebGL):");
  if (unityGames.length === 0) {
    console.log("  (none)");
  } else {
    unityGames.forEach((game) => {
      console.log(`  ${game.hasPublish ? "✓" : "○"} ${game.name}${game.hasBuild ? "" : "  ⚠ no Build/index.html"}`);
    });
  }

  console.log("");
  console.log("✓ = has publish.json, ○ = needs publish.json");
}

export function printUploadHelp(): void {
  console.log("Usage: oasiz upload <game-folder> [options]");
  console.log("");
  console.log("Options:");
  console.log("  horizontal     Upload as landscape-friendly (verticalOnly=false)");
  console.log("  vertical       Upload as portrait-locked (verticalOnly=true, default)");
  console.log("  new            Upload as a new game (ignore existing gameId)");
  console.log("  --list, -l     List available game folders");
  console.log("  --skip-build   Skip the build step (use existing dist/)");
  console.log("  --dry-run      Build but don't upload (test mode)");
  console.log("  --inline       Inline all assets into HTML (legacy mode)");
  console.log("  --withlog      Inject on-page preboot log overlay into uploaded HTML");
  console.log("  --activate     Activate uploaded draft if the API returns a draftId");
  console.log("  --help, -h     Show this help message");
  console.log("");
  console.log("By default, assets are uploaded via presigned URLs for CDN delivery.");
  console.log("Use --inline for games that need all assets in the HTML.");
  console.log("");
  console.log("Unity WebGL games:");
  console.log("  Place Unity WebGL exports under Unity/<game-name>/Build/");
  console.log("  The uploader auto-detects them and skips the normal build step.");
  console.log("  Both 'ThreadTangle' and 'Unity/ThreadTangle' are accepted.");
  console.log("");
  console.log("Examples:");
  console.log("  oasiz upload block-blast");
  console.log("  oasiz upload block-blast horizontal");
  console.log("  oasiz upload two-dots --skip-build");
  console.log("  oasiz upload endless-hexagon --inline");
  console.log("  oasiz upload WarriorIO");
  console.log("  oasiz upload WarriorIO --withlog");
  console.log("  oasiz upload --list");
}

export async function runUploadCommand(gameFolder: string, args: string[] = []): Promise<void> {
  loadEnvSync();

  const skipBuild = args.includes("--skip-build");
  const dryRun = args.includes("--dry-run");
  const useInlining = args.includes("--inline");
  const unityInjectPrebootLogger = args.includes("--withlog");
  const uploadAsNew = args.includes("new");
  const forceActivate = args.includes("--activate");
  const orientationOverride = args.includes("horizontal") ? false : args.includes("vertical") ? true : undefined;

  const auth = dryRun ? null : await validateAuthForUpload();
  const { gamePath, isUnity } = resolveGamePath(gameFolder);
  const gameSlug = gameFolder.replace(/^Unity\//, "");
  logInfo(`Processing game: ${gameSlug}${isUnity ? " (Unity WebGL)" : ""}`);

  const publishConfig = await readUploadPublishConfig(gamePath);
  logSuccess(`Loaded publish.json: "${publishConfig.title}"`);

  if (uploadAsNew) {
    logInfo("Uploading as NEW game (ignoring existing gameId)");
  }

  let bundleHtml: string;
  let assets: AssetEntry[] | undefined;

  if (isUnity) {
    logInfo("Unity game — skipping build step (pre-built WebGL export expected)");
    bundleHtml = await readUnityBundleHtml(gamePath, { injectPrebootLogger: unityInjectPrebootLogger });
    logSuccess(`Read Unity bundle: ${(bundleHtml.length / 1024).toFixed(1)} KB`);
    logInfo("Collecting Unity build assets for CDN upload...");
    assets = await collectUnityAssets(gamePath);
    const assetSummary = summarizeAssetPayload(assets);
    logSuccess(`Collected ${assetSummary.count} Unity assets (${(assetSummary.approxBytes / 1024 / 1024).toFixed(1)} MB total)`);
  } else {
    if (!skipBuild) {
      await buildGame(gamePath);
    } else {
      logInfo("Skipping build (--skip-build)");
    }

    bundleHtml = await readBundleHtml(gamePath, useInlining, unityInjectPrebootLogger);
    logSuccess(`Read bundle: ${(bundleHtml.length / 1024).toFixed(1)} KB`);

    if (!useInlining) {
      logInfo("Collecting assets for CDN upload...");
      assets = await collectAssets(gamePath);
      const assetSummary = summarizeAssetPayload(assets);
      logSuccess(`Collected ${assetSummary.count} assets (${(assetSummary.approxBytes / 1024 / 1024).toFixed(1)} MB total)`);
    }
  }

  const thumbnailBase64 = await readThumbnail(gamePath);
  const payload: UploadPayload = {
    title: publishConfig.title,
    slug: gameSlug,
    description: publishConfig.description,
    category: publishConfig.category,
    email: auth?.creatorEmail || "",
    gameId: uploadAsNew ? undefined : publishConfig.gameId,
    isMultiplayer: publishConfig.isMultiplayer,
    maxPlayers: publishConfig.maxPlayers,
    verticalOnly: orientationOverride ?? publishConfig.verticalOnly,
    thumbnailBase64,
    bundleHtml,
    ...(assets ? { assets } : {}),
  };

  if (dryRun) {
    logInfo("Dry run mode - skipping upload");
    console.log("");
    console.log("Would upload:");
    console.log(`  Title: ${payload.title}`);
    console.log(`  Slug: ${payload.slug}`);
    console.log(`  Category: ${payload.category}`);
    console.log(`  Description: ${payload.description}`);
    console.log(`  Creator Email: ${payload.email || "(from login at runtime)"}`);
    console.log(`  Has Thumbnail: ${Boolean(payload.thumbnailBase64)}`);
    console.log(`  Vertical Only: ${payload.verticalOnly ?? true} (default: true)`);
    console.log(`  Bundle Size: ${(payload.bundleHtml.length / 1024).toFixed(1)} KB`);
    console.log(`  Type: ${isUnity ? "Unity WebGL" : useInlining ? "Inline (legacy)" : "CDN Assets (presigned)"}`);
    if (assets) {
      const assetSummary = summarizeAssetPayload(assets);
      console.log(`  Assets: ${assetSummary.count} files (${formatBytes(assetSummary.approxBytes)})`);
      console.log("  Asset Transport: CDN assets via presigned R2 upload");
    }
    console.log(`  Game ID: ${payload.gameId || "(will be assigned)"}`);
    return;
  }

  const result = await uploadGame(payload, auth!.token);
  if (!publishConfig.gameId && result.gameId) {
    await writePublishConfig(gamePath, {
      ...publishConfig,
      gameId: result.gameId,
    });
    logSuccess("Saved gameId to publish.json");
  }

  if (forceActivate && result.draftId) {
    const activateUrl = getApiUrl("/api/upload/activate");
    logInfo(`Activating uploaded draft via ${activateUrl}...`);
    const response = await fetch(activateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth!.token}`,
      },
      body: JSON.stringify({ draftId: result.draftId }),
    });

    if (!response.ok) {
      throw new Error(`Activation failed (${response.status}): ${await response.text()}`);
    }
    logSuccess("Activated uploaded draft");
  } else if (forceActivate) {
    logInfo("Upload succeeded, but the API did not return a draftId to activate");
  }
}

export const __uploadTestHooks = {
  applyJsonJsAssetUrlRewrites,
  buildCdnUrl,
  collectAssets,
  collectUnityAssets,
  injectPrebootLoggerIntoHtml,
  readBundleHtml,
  readUnityBundleHtml,
  summarizeAssetPayload,
};

export async function runUploadCli(args: string[] = []): Promise<void> {
  loadEnvSync();

  if (args.includes("--list") || args.includes("-l")) {
    await listUploadGames();
    return;
  }

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printUploadHelp();
    return;
  }

  const gameFolder = args[0];
  if (!gameFolder || gameFolder.startsWith("-")) {
    throw new Error("Usage: oasiz upload <game-folder>");
  }

  await runUploadCommand(gameFolder, args.slice(1));
}

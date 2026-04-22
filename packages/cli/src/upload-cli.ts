import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { getApiUrl, readStoredCredentials, requireAuthToken } from "./lib/auth.ts";
import { type PublishConfig, writePublishConfig } from "./lib/game.ts";
import { getProjectRoot, toPosixPath } from "./lib/runtime.ts";

const MAX_UPLOAD_ASSET_SIZE_MB = 100;
const MAX_UPLOAD_ASSET_SIZE_BYTES = MAX_UPLOAD_ASSET_SIZE_MB * 1024 * 1024;
const UNITY_DIR = "Unity";

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
  assets?: Record<string, string>;
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
        var entries = [];
        function push(level, message) {
          var row = "[" + level.toUpperCase() + "] " + message;
          entries.push(row);
          try { console[level === "error" ? "error" : "log"](row); } catch (_e) {}
        }
        window.addEventListener("error", function (event) {
          push("error", event.message || "Unknown window error");
        }, true);
        window.addEventListener("unhandledrejection", function (event) {
          push("error", "Unhandled promise rejection: " + String(event.reason));
        });
        return {
          info: function () { push("info", Array.prototype.slice.call(arguments).join(" ")); },
          warn: function () { push("warn", Array.prototype.slice.call(arguments).join(" ")); },
          error: function () { push("error", Array.prototype.slice.call(arguments).join(" ")); },
          getEntries: function () { return entries.slice(); },
        };
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
  html = html
    .replace(/var buildUrl\s*=\s*["']Build["'];?\s*/g, "")
    .replace(/buildUrl\s*\+\s*["']\/Build\.loader\.js["']/g, '"Build/Build.loader.js"')
    .replace(/buildUrl\s*\+\s*["'](\/Build\.data(?:\.br|\.gz)?)["']/g, '"Build$1"')
    .replace(/buildUrl\s*\+\s*["'](\/Build\.framework\.js(?:\.br|\.gz)?)["']/g, '"Build$1"')
    .replace(/buildUrl\s*\+\s*["'](\/Build\.wasm(?:\.br|\.gz)?)["']/g, '"Build$1"')
    .replace(/buildUrl\s*\+\s*["']\/StreamingAssets\/?["']/g, '"StreamingAssets"');
  logInfo("  Expanded JS path concatenations to literal strings");

  const dynamicLoaderPattern = /var script\s*=\s*document\.createElement\("script"\);[\s\S]*?document\.body\.appendChild\(script\);/;
  const loaderBlock = injectPrebootLogger
    ? `var prebootUnityLoaderSrc = "Build/Build.loader.js";
      ${getUnityPrebootLoggerBlock()}
      prebootLogger.info("Preparing Unity loader:", prebootUnityLoaderSrc);
      var unityLoadingBar = document.querySelector("#unity-loading-bar");
      if (unityLoadingBar) unityLoadingBar.style.display = "block";
      var script = document.createElement("script");
      script.src = prebootUnityLoaderSrc;
      script.onerror = function () { prebootLogger.error("Failed to load Unity loader script:", prebootUnityLoaderSrc); };
      script.onload = function () {
        if (typeof createUnityInstance !== "function") {
          prebootLogger.error("Unity loader script did not expose createUnityInstance");
          alert("Unity loader script did not expose createUnityInstance");
          return;
        }
        prebootLogger.info("Calling createUnityInstance");
        createUnityInstance(canvas, config, function (progress) {
          var progressBar = document.querySelector("#unity-progress-bar-full");
          if (progressBar) progressBar.style.width = 100 * progress + "%";
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
      document.body.appendChild(script);`
    : getUnityPlainLoaderBlock();

  if (dynamicLoaderPattern.test(html)) {
    html = html.replace(dynamicLoaderPattern, loaderBlock);
    html = html.replace(/\s*<script src="Build\/Build\.loader\.js"><\/script>\s*/g, "\n    ");
    logInfo(injectPrebootLogger ? "  Replaced Unity loader injection with logged dynamic loading" : "  Replaced Unity loader injection with dynamic loading (no on-page logger)");
  } else {
    logInfo("  Warning: could not find dynamic script-loading block — HTML may not load correctly");
  }

  html = html.replace(/\s*var loaderUrl\s*=\s*[^;]+;\s*/g, "\n      ");
  if (injectPrebootLogger) {
    logInfo("  Injected Unity preboot logger overlay");
  } else {
    logInfo("  Skipped Unity preboot DOM logger (use --withlog to inject loader log overlay)");
  }

  return html;
}

async function collectAssets(gamePath: string): Promise<Record<string, string>> {
  const distPath = join(gamePath, "dist");
  const assets: Record<string, string> = {};
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
    assets[relativePath] = buffer.toString("base64");
  }

  return assets;
}

async function collectUnityAssets(gamePath: string): Promise<Record<string, string>> {
  const buildDir = join(gamePath, "Build");
  const assets: Record<string, string> = {};
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
    assets[relativePath] = buffer.toString("base64");
  }
  return assets;
}

async function readBundleHtml(gamePath: string, useInlining: boolean = false): Promise<string> {
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

function summarizeAssetPayload(assets: Record<string, string> | undefined): { count: number; approxBytes: number } {
  if (!assets) return { count: 0, approxBytes: 0 };
  return {
    count: Object.keys(assets).length,
    approxBytes: Object.values(assets).reduce((sum, base64) => sum + base64.length * 0.75, 0),
  };
}

async function uploadGame(payload: UploadPayload, token: string): Promise<{ gameId?: string; draftId?: string }> {
  const apiUrl = getApiUrl("/api/upload/game");
  const requestBody = JSON.stringify(payload);
  logInfo(`Uploading ${payload.title} to ${apiUrl}... (${(requestBody.length / 1024 / 1024).toFixed(1)} MB)`);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError(`Upload failed (${response.status}): ${errorText}`);
      if (response.status === 413) {
        logError("Payload exceeds the API/edge limit (often ~100MB). Base64 JSON is ~4/3 the size of your dist/ assets. Remove or compress large files under public/ (or use --inline only if the bundle stays small), then rebuild.");
      }
      throw new Error("Upload failed");
    }

    const result = (await response.json()) as { gameId?: string; draftId?: string };
    logSuccess("Upload complete!");
    if (result.gameId) {
      logSuccess("Uploaded game successfully");
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === "Upload failed") throw error;
    logError(`Upload request failed: ${String(error)}`);
    throw error;
  }
}

async function validateAuthForUpload(): Promise<{ token: string; creatorEmail: string }> {
  const token = await requireAuthToken();
  const storedCredentials = await readStoredCredentials();
  const creatorEmail = storedCredentials?.email;
  if (!creatorEmail) {
    logError("No creator email found in saved login credentials");
    console.log("");
    console.log("Run `oasiz login` again so the CLI can save your registered Oasiz email.");
    throw new Error("Missing creator email");
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
  console.log("  --withlog      Unity WebGL only: inject on-page loader log overlay");
  console.log("  --activate     Activate uploaded draft if the API returns a draftId");
  console.log("  --help, -h     Show this help message");
  console.log("");
  console.log("By default, assets are uploaded separately for CDN delivery.");
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
  let assets: Record<string, string> | undefined;

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

    bundleHtml = await readBundleHtml(gamePath, useInlining);
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
    console.log(`  Type: ${isUnity ? "Unity WebGL" : useInlining ? "Inline (legacy)" : "CDN Assets"}`);
    if (assets) {
      console.log(`  Assets: ${Object.keys(assets).length} files`);
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

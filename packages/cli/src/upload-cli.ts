/**
 * Upload Game Script
 *
 * Builds and uploads a game to the Oasiz platform.
 *
 * Usage:
 *   oasiz upload <game-folder>
 *   npx @oasiz/cli upload <game-folder>
 *
 * Requirements:
 *   - OASIZ_UPLOAD_TOKEN env var must be set
 *   - OASIZ_API_URL env var (defaults to production)
 *   - Game folder must have a publish.json file
 *
 * Example:
 *   export OASIZ_UPLOAD_TOKEN=your_token_here
 *   oasiz upload block-blast
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const PROJECT_ROOT = resolve(process.env.OASIZ_PROJECT_ROOT ?? process.cwd());

type NodeFileHandle = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
  readonly size: number;
};

function createNodeFileHandle(filePath: string): NodeFileHandle {
  return {
    async arrayBuffer(): Promise<ArrayBuffer> {
      const buffer = await readFile(filePath);
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
    },
    async text(): Promise<string> {
      return await readFile(filePath, "utf8");
    },
    get size(): number {
      return statSync(filePath).size;
    },
  };
}

const Bun = {
  file: createNodeFileHandle,
};

// Load .env file if it exists (synchronous version using fs)
function loadEnvSync(): void {
  const envPath = resolve(PROJECT_ROOT, ".env");
  if (!existsSync(envPath)) return;

  try {
    // Read .env file synchronously
    const envText = readFileSync(envPath, "utf-8");
    
    // Parse .env file
    const lines = envText.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // Remove quotes if present
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Only set if not already in process.env (env vars take precedence)
      if (key && typeof process.env[key] === "undefined") {
        process.env[key] = value;
      }
    }
  } catch {
    // Silently fail if .env can't be read
  }
}

// Load .env before reading env vars
loadEnvSync();

// Configuration
const DEFAULT_API_URL = "https://api.oasiz.ai/api/upload/game";
const API_URL = process.env.OASIZ_API_URL || DEFAULT_API_URL;
const API_TOKEN = process.env.OASIZ_UPLOAD_TOKEN;
const CREATOR_EMAIL = process.env.OASIZ_EMAIL;
const MAX_UPLOAD_ASSET_SIZE_MB = 100;
const MAX_UPLOAD_ASSET_SIZE_BYTES = MAX_UPLOAD_ASSET_SIZE_MB * 1024 * 1024;

// Unity games live under this subfolder of the repo root
const UNITY_DIR = "Unity";

// Types
interface PublishConfig {
  title: string;
  description: string;
  category: "arcade" | "puzzle" | "party" | "action" | "strategy" | "casual";
  gameId?: string;
  isMultiplayer?: boolean;
  maxPlayers?: number;
  verticalOnly?: boolean;
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
  /** Asset files to upload separately (path -> base64 content) */
  assets?: Record<string, string>;
}

// Helpers
function logInfo(message: string): void {
  console.log(`[upload-game] ${message}`);
}

function logError(message: string): void {
  console.error(`[upload-game] ERROR: ${message}`);
}

function logSuccess(message: string): void {
  console.log(`[upload-game] ✓ ${message}`);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapThumbnailTitle(title: string): string[] {
  const normalized = title.trim().replace(/\s+/g, " ");
  const fallback = normalized || "Untitled Game";
  const words = fallback.split(" ");
  const lines: string[] = [];
  const maxCharsPerLine = 16;
  const maxLines = 3;
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (candidate.length <= maxCharsPerLine || currentLine.length === 0) {
      currentLine = candidate;
      continue;
    }

    lines.push(currentLine);
    currentLine = word;

    if (lines.length === maxLines - 1) {
      break;
    }
  }

  const remainingWords =
    lines.length === maxLines - 1
      ? words.slice(lines.join(" ").split(" ").filter(Boolean).length)
      : [];
  const finalLineSource = remainingWords.length
    ? [currentLine, ...remainingWords].filter(Boolean).join(" ")
    : currentLine;

  if (finalLineSource) {
    lines.push(finalLineSource);
  }

  while (lines.length > maxLines) {
    const overflow = lines.pop();
    if (!overflow) {
      break;
    }
    lines[maxLines - 1] = `${lines[maxLines - 1]} ${overflow}`.trim();
  }

  if (lines.length === 0) {
    lines.push(fallback);
  }

  const lastIndex = lines.length - 1;
  if (lines[lastIndex].length > 22) {
    lines[lastIndex] = `${lines[lastIndex].slice(0, 21).trimEnd()}…`;
  }

  return lines;
}

function createGeneratedThumbnail(title: string): string {
  const lines = wrapThumbnailTitle(title);
  const fontSize =
    lines.length === 1 ? 112 : lines.length === 2 ? 96 : 82;
  const lineHeight = fontSize + 14;
  const startY = 315 - ((lines.length - 1) * lineHeight) / 2;
  const textSvg = lines
    .map((line, index) => {
      const y = startY + index * lineHeight;
      return `<text class="title" x="90" y="${y}">${escapeXml(line)}</text>`;
    })
    .join("");

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="55%" stop-color="#1d4ed8" />
      <stop offset="100%" stop-color="#0ea5e9" />
    </linearGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18" />
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
    </linearGradient>
    <style>
      .eyebrow { fill: rgba(255,255,255,0.78); font: 700 28px Arial, Helvetica, sans-serif; letter-spacing: 0.28em; }
      .title { fill: #ffffff; font: 800 ${fontSize}px Arial, Helvetica, sans-serif; letter-spacing: -0.04em; }
      .footer { fill: rgba(255,255,255,0.88); font: 600 26px Arial, Helvetica, sans-serif; }
    </style>
  </defs>
  <rect width="1200" height="630" rx="36" fill="url(#bg)" />
  <circle cx="1010" cy="96" r="190" fill="url(#glow)" />
  <circle cx="1110" cy="520" r="220" fill="rgba(255,255,255,0.07)" />
  <rect x="58" y="58" width="1084" height="514" rx="28" fill="rgba(9, 13, 32, 0.18)" stroke="rgba(255,255,255,0.18)" stroke-width="2" />
  <text class="eyebrow" x="90" y="116">OASIZ DRAFT</text>
  ${textSvg}
  <text class="footer" x="90" y="536">Generated preview from game title</text>
</svg>`.trim();

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function detectPackageManager(projectPath: string): "bun" | "npm" {
  if (
    existsSync(join(projectPath, "bun.lock")) ||
    existsSync(join(projectPath, "bun.lockb"))
  ) {
    return "bun";
  }

  return "npm";
}

async function runCommand(
  argv: string[],
  cwd: string,
  quiet: boolean = false,
): Promise<void> {
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

      rejectPromise(
        new Error(
          `Command failed (${argv.join(" ")})` +
            (stderr ? `\n${stderr.trim()}` : ""),
        ),
      );
    });
  });
}

async function validateEnvironment(): Promise<void> {
  if (!API_TOKEN) {
    logError("OASIZ_UPLOAD_TOKEN environment variable not set");
    console.log("");
    console.log("To set up your upload token:");
    console.log("  1. Get your token from the Oasiz team");
    console.log("  2. Option A - Add to .env file (recommended):");
    console.log("     Create a .env file in the project root with:");
    console.log("     OASIZ_UPLOAD_TOKEN=your_token_here");
    console.log("     OASIZ_EMAIL=your-email@example.com");
    console.log("");
    console.log("  3. Option B - Set in your shell:");
    console.log("     PowerShell: $env:OASIZ_UPLOAD_TOKEN='your_token_here'");
    console.log("     Bash/Zsh:   export OASIZ_UPLOAD_TOKEN=your_token_here");
    console.log("");
    process.exit(1);
  }

  if (!CREATOR_EMAIL) {
    logError("OASIZ_EMAIL environment variable not set");
    console.log("");
    console.log("Set your registered Oasiz email:");
    console.log("  Option A - Add to .env file:");
    console.log("    OASIZ_EMAIL=your-email@example.com");
    console.log("");
    console.log("  Option B - Set in your shell:");
    console.log("    PowerShell: $env:OASIZ_EMAIL='your-email@example.com'");
    console.log("    Bash/Zsh:   export OASIZ_EMAIL=your-email@example.com");
    console.log("");
    console.log("This email must be registered in the Oasiz platform.");
    process.exit(1);
  }
}

function getGameFolders(): string[] {
  const rootDir = PROJECT_ROOT;
  const excludeDirs = new Set([
    "scripts",
    "template",
    "node_modules",
    ".git",
    "unfinished-games",
    "perfect-drop",
  ]);

  return readdirSync(rootDir, { withFileTypes: true })
    .filter((dirent) => {
      if (!dirent.isDirectory()) return false;
      if (excludeDirs.has(dirent.name)) return false;
      if (dirent.name.startsWith(".")) return false;

      // Check if it looks like a game folder (has src/main.ts or index.html)
      const gamePath = join(rootDir, dirent.name);
      return (
        existsSync(join(gamePath, "src", "main.ts")) ||
        existsSync(join(gamePath, "index.html"))
      );
    })
    .map((dirent) => dirent.name);
}

async function readPublishConfig(gamePath: string): Promise<PublishConfig> {
  const publishPath = join(gamePath, "publish.json");
  const gameFolder = gamePath.split("/").pop() || "unknown";

  // Default config if publish.json doesn't exist
  const defaultConfig: PublishConfig = {
    title: gameFolder,
    description: "test",
    category: "arcade",
  };

  if (!existsSync(publishPath)) {
    logInfo(`No publish.json found, using defaults`);
    return defaultConfig;
  }

  const content = await Bun.file(publishPath).text();
  const config = JSON.parse(content) as Partial<PublishConfig>;

  // Merge with defaults for any missing fields
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

    logInfo(`Installing dependencies with ${packageManager}...`);
    await runCommand(
      packageManager === "bun" ? ["bun", "install"] : ["npm", "install"],
      gamePath,
      true,
    );

    // Check if game has a custom build script in package.json
    const packageJsonPath = join(gamePath, "package.json");
    let useCustomBuild = false;
    
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(await Bun.file(packageJsonPath).text());
      if (packageJson.scripts?.build) {
        useCustomBuild = true;
      }
    }

    // Use the game's own build command if available, otherwise fallback to vite
    logInfo("Running build...");
    if (useCustomBuild) {
      await runCommand(
        packageManager === "bun"
          ? ["bun", "run", "build"]
          : ["npm", "run", "build"],
        gamePath,
        true,
      );
    } else {
      await runCommand(
        packageManager === "bun"
          ? ["bunx", "--bun", "vite", "build"]
          : ["npx", "vite", "build"],
        gamePath,
        true,
      );
    }
    logSuccess(`Built ${gameFolder}`);
  } catch (error) {
    logError(`Build failed for ${gameFolder}`);
    console.error(error);
    process.exit(1);
  }
}

/**
 * Get MIME type for a file based on extension
 */
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

/**
 * Recursively get all files in a directory
 */
function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  if (!existsSync(dirPath)) return arrayOfFiles;
  
  const files = readdirSync(dirPath);
  
  for (const file of files) {
    const fullPath = join(dirPath, file);
    if (statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  }
  
  return arrayOfFiles;
}

/**
 * Collect all assets from the dist folder for separate upload
 * Returns a map of relative path -> base64 content
 */
async function collectAssets(gamePath: string): Promise<Record<string, string>> {
  const distPath = join(gamePath, "dist");
  const assets: Record<string, string> = {};
  
  if (!existsSync(distPath)) {
    logError("Dist folder not found");
    return assets;
  }
  
  const allFiles = getAllFiles(distPath);
  
  for (const filePath of allFiles) {
    const relativePath = relative(distPath, filePath).replace(/\\/g, "/");
    
    // Skip HTML files - they're sent separately as bundleHtml
    if (relativePath.endsWith('.html')) continue;
    
    // Skip very large files that exceed the upload cap
    const file = Bun.file(filePath);
    if (file.size > MAX_UPLOAD_ASSET_SIZE_BYTES) {
      logInfo(
        `  Skipping very large file: ${relativePath} (${(file.size / 1024 / 1024).toFixed(1)} MB > ${MAX_UPLOAD_ASSET_SIZE_MB} MB limit)`
      );
      continue;
    }
    
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    assets[relativePath] = base64;
  }
  
  return assets;
}

/**
 * Check if a build has external assets that need inlining
 */
function hasExternalAssets(html: string): boolean {
  // Check for external script/link references
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

/**
 * Inline all external assets into the HTML
 * This handles JS, CSS, images, audio, and other assets
 */
async function inlineAssets(gamePath: string, html: string): Promise<string> {
  const distPath = join(gamePath, "dist");
  let result = html;
  
  // Get all files in dist
  const allFiles = getAllFiles(distPath);
  
  // Create a map of relative paths to file contents
  const fileMap = new Map<string, { content: string; isText: boolean }>();
  
  // Max size for inlining binary assets (10MB - to include background music)
  const MAX_BINARY_SIZE = 10 * 1024 * 1024; // 10MB
  
  for (const filePath of allFiles) {
    const relativePath = relative(distPath, filePath);
    const ext = extname(filePath).toLowerCase();
    const isTextFile = [".js", ".mjs", ".css", ".json", ".svg"].includes(ext);
    
    if (isTextFile) {
      const content = await Bun.file(filePath).text();
      fileMap.set(relativePath, { content, isText: true });
    } else {
      // Binary files - check size first
      const file = Bun.file(filePath);
      const fileSize = file.size;
      
      if (fileSize > MAX_BINARY_SIZE) {
        logInfo(`  Skipping large file: ${relativePath} (${(fileSize / 1024 / 1024).toFixed(1)}MB > 1MB limit)`);
        continue;
      }
      
      // Convert to base64 data URI
      const buffer = await file.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const mimeType = getMimeType(filePath);
      const dataUri = `data:${mimeType};base64,${base64}`;
      fileMap.set(relativePath, { content: dataUri, isText: false });
    }
  }
  
  // Step 1: Inline CSS files
  // Match: <link rel="stylesheet" href="./style.css"> or href="/style.css"
  const cssLinkRegex = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  let cssMatch;
  while ((cssMatch = cssLinkRegex.exec(html)) !== null) {
    const fullMatch = cssMatch[0];
    let href = cssMatch[1];
    
    // Normalize path
    if (href.startsWith("./")) href = href.slice(2);
    if (href.startsWith("/")) href = href.slice(1);
    
    const fileData = fileMap.get(href);
    if (fileData && fileData.isText) {
      // Inline asset references within CSS
      let cssContent = fileData.content;
      cssContent = await inlineUrlsInCss(cssContent, fileMap, href);
      result = result.replace(fullMatch, `<style>${cssContent}</style>`);
      logInfo(`Inlined CSS: ${href}`);
    }
  }
  
  // Also handle link tags where href comes before rel
  const cssLinkRegex2 = /<link[^>]*href=["']([^"']+\.css)["'][^>]*>/gi;
  while ((cssMatch = cssLinkRegex2.exec(result)) !== null) {
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
  
  // Step 2: Remove modulepreload links (not needed when inlined)
  result = result.replace(/<link[^>]*rel=["']modulepreload["'][^>]*>/gi, "");
  
  // Step 3: Inline JS files
  // Match: <script type="module" src="./assets/index-xxx.js">
  const jsScriptRegex = /<script[^>]*src=["']([^"']+\.m?js)["'][^>]*><\/script>/gi;
  let jsMatch;
  const jsReplacements: { fullMatch: string; replacement: string }[] = [];
  
  // Reset regex
  jsScriptRegex.lastIndex = 0;
  while ((jsMatch = jsScriptRegex.exec(result)) !== null) {
    const fullMatch = jsMatch[0];
    let src = jsMatch[1];
    
    // Normalize path
    if (src.startsWith("./")) src = src.slice(2);
    if (src.startsWith("/")) src = src.slice(1);
    
    const fileData = fileMap.get(src);
    if (fileData && fileData.isText) {
      // Process JS content to inline imported assets
      let jsContent = fileData.content;
      jsContent = inlineAssetsInJs(jsContent, fileMap, src);
      
      // CRITICAL: Escape ALL HTML-like patterns in JS content
      // The app's prepareHtmlForMobile does string replacements like:
      //   html.replace('</body>', '<script>...</script></body>')
      // If JS contains these strings literally, it would break the injection
      const htmlTagPatterns = [
        /<\/script/gi,
        /<\/body/gi,
        /<\/head/gi,
        /<\/html/gi,
        /<!--/g,
        /-->/g,
      ];
      for (const pattern of htmlTagPatterns) {
        jsContent = jsContent.replace(pattern, (match) => {
          return match.replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
        });
      }
      
      // Escape emoji and other non-ASCII characters that might cause encoding issues
      jsContent = jsContent.replace(/[\u0080-\uFFFF]/g, (char) => {
        return '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0');
      });
      
      // Preserve module type if present
      const isModule = fullMatch.includes('type="module"') || fullMatch.includes("type='module'");
      const scriptTag = isModule 
        ? `<script type="module">${jsContent}</script>`
        : `<script>${jsContent}</script>`;
      
      jsReplacements.push({ fullMatch, replacement: scriptTag });
      logInfo(`Inlined JS: ${src} (${(jsContent.length / 1024).toFixed(1)} KB)`);
    }
  }
  
  // Apply JS replacements
  for (const { fullMatch, replacement } of jsReplacements) {
    result = result.replace(fullMatch, replacement);
  }
  
  // Step 4: Inline remaining asset references in HTML (images, etc.)
  // Match src="./assets/..." or src="/assets/..."
  const assetSrcRegex = /(src=["'])(\.?\/?)assets\/([^"']+)(["'])/gi;
  result = result.replace(assetSrcRegex, (match, prefix, slash, assetPath, suffix) => {
    const fullPath = `assets/${assetPath}`;
    const fileData = fileMap.get(fullPath);
    if (fileData && !fileData.isText) {
      return `${prefix}${fileData.content}${suffix}`;
    }
    return match;
  });
  
  // Also handle href for assets
  const assetHrefRegex = /(href=["'])(\.?\/?)assets\/([^"']+)(["'])/gi;
  result = result.replace(assetHrefRegex, (match, prefix, slash, assetPath, suffix) => {
    const fullPath = `assets/${assetPath}`;
    const fileData = fileMap.get(fullPath);
    if (fileData && !fileData.isText) {
      return `${prefix}${fileData.content}${suffix}`;
    }
    return match;
  });
  
  return result;
}

/**
 * Inline url() references in CSS content
 */
async function inlineUrlsInCss(
  cssContent: string, 
  fileMap: Map<string, { content: string; isText: boolean }>,
  cssPath: string
): Promise<string> {
  // Match url('./something') or url("./something") or url(./something)
  const urlRegex = /url\(["']?([^"')]+)["']?\)/gi;
  
  return cssContent.replace(urlRegex, (match, url) => {
    // Skip data URIs and external URLs
    if (url.startsWith("data:") || url.startsWith("http://") || url.startsWith("https://")) {
      return match;
    }
    
    // Resolve relative to CSS file location
    let resolvedPath = url;
    if (url.startsWith("./")) resolvedPath = url.slice(2);
    if (url.startsWith("/")) resolvedPath = url.slice(1);
    
    // If CSS is in assets/, resolve relative to that
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

/**
 * Inline asset references in JS content (for dynamic imports and asset URLs)
 * Used in legacy --inline mode
 */
function inlineAssetsInJs(
  jsContent: string,
  fileMap: Map<string, { content: string; isText: boolean }>,
  jsPath: string
): string {
  let result = jsContent;
  
  // Replace asset URL strings for common folder patterns
  // Matches: "assets/...", "audio/...", "./assets/...", "./audio/...", etc.
  const assetFolders = ['assets', 'audio', 'images', 'sounds', 'music', 'fonts', 'data'];
  const folderPattern = assetFolders.join('|');
  const assetUrlRegex = new RegExp(`(["'])(\.?\/?)(${folderPattern})\/([^"']+)(["'])`, 'gi');
  
  result = result.replace(assetUrlRegex, (match, q1, prefix, folder, assetPath, q2) => {
    // Strip query string (e.g., ?h=abc123 cache-busting hashes from Vite)
    const assetPathClean = assetPath.split('?')[0];
    const fullPath = `${folder}/${assetPathClean}`;
    const fileData = fileMap.get(fullPath);
    
    if (fileData) {
      // Check file size - warn if large
      const estimatedSize = fileData.content.length;
      if (estimatedSize > 500000) {
        logInfo(`  Warning: Large asset ${fullPath} (${(estimatedSize / 1024).toFixed(0)}KB)`);
      }
      
      if (fileData.isText) {
        // For JSON files, process content to inline nested asset URLs
        if (assetPathClean.endsWith(".json")) {
          let jsonContent = fileData.content;
          
          // Replace asset URLs inside the JSON with data URIs
          const jsonUrlRegex = /"url"\s*:\s*"([^"]+)"/gi;
          jsonContent = jsonContent.replace(jsonUrlRegex, (match, url) => {
            if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
              return match;
            }
            
            const urlClean = url.split('?')[0];
            const assetData = fileMap.get(urlClean);
            
            if (assetData) {
              if (assetData.isText) {
                const assetBase64 = Buffer.from(assetData.content).toString("base64");
                const assetMime = getMimeType(url);
                return `"url": "data:${assetMime};base64,${assetBase64}"`;
              } else {
                return `"url": "${assetData.content}"`;
              }
            }
            return match;
          });
          
          const base64 = Buffer.from(jsonContent).toString("base64");
          return `${q1}data:application/json;base64,${base64}${q2}`;
        }
        
        // For other text files, convert to data URI
        const base64 = Buffer.from(fileData.content).toString("base64");
        const mimeType = getMimeType(fullPath);
        return `${q1}data:${mimeType};base64,${base64}${q2}`;
      }
      
      // Binary files already have data URI in fileData.content
      return `${q1}${fileData.content}${q2}`;
    }
    
    return match;
  });
  
  return result;
}

// ─── Unity helpers ────────────────────────────────────────────────────────────

/**
 * Returns true when a game folder lives inside the Unity/ directory.
 */
function isUnityGame(gamePath: string): boolean {
  const rootDir = PROJECT_ROOT;
  const unityDir = join(rootDir, UNITY_DIR);
  return gamePath.startsWith(unityDir + "/") || gamePath === unityDir;
}

/**
 * Resolve a game name to its absolute path.
 * Checks the repo root first (normal games), then the Unity/ subdirectory.
 * Returns { gamePath, isUnity }.
 */
function resolveGamePath(gameFolder: string): { gamePath: string; isUnity: boolean } {
  const rootDir = PROJECT_ROOT;

  // Allow an explicit "Unity/GameName" path passed by the user
  if (gameFolder.startsWith(`${UNITY_DIR}/`) || gameFolder.startsWith(`${UNITY_DIR}\\`)) {
    const gamePath = join(rootDir, gameFolder);
    if (!existsSync(gamePath)) {
      logError(`Unity game folder not found: ${gameFolder}`);
      process.exit(1);
    }
    return { gamePath, isUnity: true };
  }

  // Normal game at repo root
  const rootPath = join(rootDir, gameFolder);
  if (existsSync(rootPath)) {
    return { gamePath: rootPath, isUnity: false };
  }

  // Auto-detect: look inside Unity/
  const unityPath = join(rootDir, UNITY_DIR, gameFolder);
  if (existsSync(unityPath)) {
    logInfo(`Detected Unity game at Unity/${gameFolder}`);
    return { gamePath: unityPath, isUnity: true };
  }

  logError(`Game folder not found: ${gameFolder}`);
  console.log("");
  console.log("Available game folders:");
  const folders = getGameFolders();
  folders.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}

/**
 * Read the main HTML for a Unity WebGL build and prepare it for CDN delivery.
 *
 * Normal (Phaser/Vite) games have asset paths as literal HTML attributes like
 * src="./assets/index-xxx.js" — the backend finds those strings and rewrites
 * them to absolute CDN URLs before serving.
 *
 * Unity's template buries all asset paths inside JavaScript string concatenations:
 *   var buildUrl = "Build";
 *   config.dataUrl = buildUrl + "/Build.data";   ← backend can't find "Build/Build.data"
 *
 * Fix: expand every concatenation to a literal string, convert the dynamic
 * loader injection into a static <script src="Build/Build.loader.js"> tag,
 * and inject the preboot logger into the uploaded HTML only. The Unity export
 * on disk stays untouched.
 */
function getUnityPrebootLoggerBlock(): string {
  return `var prebootLogger = (() => {
        var entries = [];
        var maxEntries = 300;

        var root = document.createElement("div");
        root.id = "preboot-log-overlay";
        root.style.cssText = [
          "position:fixed",
          "top:12px",
          "right:12px",
          "z-index:2147483647",
          "width:min(520px,calc(100vw - 24px))",
          "max-height:min(42vh,360px)",
          "display:flex",
          "flex-direction:column",
          "background:rgba(9,14,20,0.95)",
          "border:1px solid #00A1E4",
          "border-radius:24px",
          "overflow:hidden",
          "font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace",
          "color:#ecf7ff",
        ].join(";");

        var header = document.createElement("div");
        header.style.cssText = [
          "display:flex",
          "align-items:center",
          "justify-content:space-between",
          "gap:8px",
          "padding:10px 12px",
          "border-bottom:1px solid rgba(0,161,228,0.35)",
          "background:rgba(0,161,228,0.10)",
        ].join(";");

        var title = document.createElement("div");
        title.textContent = "Loader Logs";
        title.style.cssText = [
          "font-weight:700",
          "letter-spacing:0.02em",
        ].join(";");

        var actions = document.createElement("div");
        actions.style.cssText = [
          "display:flex",
          "gap:8px",
        ].join(";");

        function makeButton(label, onClick) {
          var button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.style.cssText = [
            "appearance:none",
            "border:1px solid rgba(0,161,228,0.6)",
            "background:rgba(0,161,228,0.08)",
            "color:#ecf7ff",
            "border-radius:24px",
            "padding:6px 12px",
            "cursor:pointer",
          ].join(";");
          button.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            onClick();
          });
          return button;
        }

        var body = document.createElement("div");
        body.style.cssText = [
          "display:flex",
          "flex-direction:column",
          "overflow:auto",
          "padding:6px 0",
        ].join(";");

        function render() {
          body.replaceChildren();
          if (entries.length === 0) {
            var empty = document.createElement("div");
            empty.textContent = "No loader logs yet";
            empty.style.cssText = "padding:8px 12px;color:rgba(236,247,255,0.7);";
            body.appendChild(empty);
            return;
          }

          entries.forEach(function (entry) {
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
            body.appendChild(row);
          });

          body.scrollTop = body.scrollHeight;
        }

        function pad(value, length) {
          var text = String(value);
          while (text.length < length) text = "0" + text;
          return text;
        }

        function formatNow() {
          var d = new Date();
          return (
            "[" +
            pad(d.getHours(), 2) +
            ":" +
            pad(d.getMinutes(), 2) +
            ":" +
            pad(d.getSeconds(), 2) +
            "." +
            pad(d.getMilliseconds(), 3) +
            "]"
          );
        }

        function toText(value) {
          if (value == null) return String(value);
          if (typeof value === "string") return value;
          if (value instanceof Error) return value.stack || (value.name + ": " + value.message);
          try {
            return JSON.stringify(value);
          } catch (_error) {
            return String(value);
          }
        }

        function push(level, message) {
          var text = formatNow() + " " + level.toUpperCase() + " " + message;
          entries.push({ level: level, text: text });
          if (entries.length > maxEntries) {
            entries.splice(0, entries.length - maxEntries);
          }
          render();
        }

        var clearButton = makeButton("Clear", function () {
          entries = [];
          render();
        });

        var downloadButton = makeButton("Download", function () {
          var blob = new Blob([entries.map(function (entry) { return entry.text; }).join("\\n")], {
            type: "text/plain;charset=utf-8",
          });
          var url = URL.createObjectURL(blob);
          var link = document.createElement("a");
          link.href = url;
          link.download = "loader-logs.txt";
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
        });

        actions.appendChild(clearButton);
        actions.appendChild(downloadButton);
        header.appendChild(title);
        header.appendChild(actions);
        root.appendChild(header);
        root.appendChild(body);
        document.body.appendChild(root);
        render();

        return {
          info: function () {
            push("info", Array.prototype.slice.call(arguments).map(toText).join(" "));
          },
          warn: function () {
            push("warn", Array.prototype.slice.call(arguments).map(toText).join(" "));
          },
          error: function () {
            push("error", Array.prototype.slice.call(arguments).map(toText).join(" "));
          },
        };
      })();`;
}

async function readUnityBundleHtml(gamePath: string): Promise<string> {
  const buildDir = join(gamePath, "Build");
  const htmlPath = join(buildDir, "index.html");

  if (!existsSync(htmlPath)) {
    logError(`Unity build HTML not found at Build/index.html`);
    logError(`Make sure you have exported a WebGL build from Unity into: ${buildDir}`);
    process.exit(1);
  }

  let html = await Bun.file(htmlPath).text();

  // ── 1. Expand buildUrl string concatenations to literal asset paths ──────────
  html = html
    .replace(/var buildUrl\s*=\s*["']Build["'];?\s*/g, "")
    .replace(/buildUrl\s*\+\s*["']\/Build\.loader\.js["']/g, '"Build/Build.loader.js"')
    .replace(/buildUrl\s*\+\s*["']\/Build\.data["']/g, '"Build/Build.data"')
    .replace(/buildUrl\s*\+\s*["']\/Build\.framework\.js["']/g, '"Build/Build.framework.js"')
    .replace(/buildUrl\s*\+\s*["']\/Build\.wasm["']/g, '"Build/Build.wasm"');

  logInfo("  Expanded JS path concatenations to literal strings");

  // ── 2. Replace dynamic loader injection with a logged dynamic loader flow ────
  const dynamicLoaderPattern =
    /var script\s*=\s*document\.createElement\("script"\);[\s\S]*?document\.body\.appendChild\(script\);/;

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

  if (dynamicLoaderPattern.test(html)) {
    html = html.replace(dynamicLoaderPattern, loggedLoaderBlock);
    html = html.replace(/\s*<script src="Build\/Build\.loader\.js"><\/script>\s*/g, "\n    ");
    logInfo("  Replaced Unity loader injection with logged dynamic loading");
  } else {
    logInfo("  Warning: could not find dynamic script-loading block — HTML may not load correctly");
  }

  // ── 3. Remove var loaderUrl (no longer used) ─────────────────────────────────
  html = html.replace(/\s*var loaderUrl\s*=\s*[^;]+;\s*/g, "\n      ");

  // ── 4. Inject preboot logger into uploaded HTML only ─────────────────────────
  if (!html.includes(`var prebootLogger = (() => {`)) {
    html = html.replace(
      /var canvas\s*=\s*document\.querySelector\(["']#unity-canvas["']\);\s*/,
      function (match: string) {
        return match + "\n      " + getUnityPrebootLoggerBlock() + "\n      ";
      }
    );
    logInfo("  Injected Unity preboot logger overlay");
  }

  if (!html.includes(`window.addEventListener("unhandledrejection"`)) {
    html = html.replace(
      /var warningBanner\s*=\s*document\.querySelector\(["']#unity-warning["']\);\s*/,
      function (match: string) {
        return (
          match +
          `
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
      `
        );
      }
    );
    logInfo("  Added Unity preload error hooks");
  }

  if (!html.includes(`prebootLogger.error("Unity banner:", msg)`)) {
    html = html.replace(
      /function unityShowBanner\(msg, type\) \{/,
      `function unityShowBanner(msg, type) {
        if (type === "error") prebootLogger.error("Unity banner:", msg);
        else if (type === "warning") prebootLogger.warn("Unity banner:", msg);
        else prebootLogger.info("Unity banner:", msg);`
    );
    logInfo("  Mirrored Unity banner messages into preboot logger");
  }

  return html;
}

/**
 * Collect all Unity build assets (everything under Build/ except index.html).
 * The backend stores each file on R2/CDN and rewrites the matching literal paths
 * in bundleHtml to absolute CDN URLs — the same mechanism used for Phaser games.
 */
async function collectUnityAssets(gamePath: string): Promise<Record<string, string>> {
  const buildDir = join(gamePath, "Build");
  const assets: Record<string, string> = {};

  if (!existsSync(buildDir)) {
    logError("Unity Build folder not found");
    return assets;
  }

  const allFiles = getAllFiles(buildDir);

  for (const filePath of allFiles) {
    const relativePath = relative(buildDir, filePath).replace(/\\/g, "/");

    if (relativePath === "index.html") continue;

    const file = Bun.file(filePath);
    const fileSize = file.size;

    if (fileSize > MAX_UPLOAD_ASSET_SIZE_BYTES) {
      logInfo(
        `  Skipping very large file: ${relativePath} (${(fileSize / 1024 / 1024).toFixed(1)} MB > ${MAX_UPLOAD_ASSET_SIZE_MB} MB limit)`
      );
      continue;
    }

    logInfo(`  Collecting: ${relativePath} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    assets[relativePath] = base64;
  }

  return assets;
}

// ─── End Unity helpers ────────────────────────────────────────────────────────

/**
 * Read the built HTML without inlining assets
 * Assets will be uploaded separately and URLs rewritten by the backend
 */
async function readBundleHtml(gamePath: string, useInlining: boolean = false): Promise<string> {
  const distPath = join(gamePath, "dist", "index.html");

  if (!existsSync(distPath)) {
    logError("Build output not found at dist/index.html");
    logError(
      "Make sure the game builds correctly with your package manager's build command.",
    );
    process.exit(1);
  }

  let html = await Bun.file(distPath).text();
  
  // Only inline if explicitly requested (legacy mode)
  if (useInlining && hasExternalAssets(html)) {
    logInfo("Detected multi-file build, inlining assets...");
    html = await inlineAssets(gamePath, html);
    logSuccess("All assets inlined into HTML");
  }

  return html;
}

async function readThumbnail(
  gamePath: string,
  gameTitle: string,
): Promise<string | undefined> {
  const thumbnailDir = join(gamePath, "thumbnail");

  if (!existsSync(thumbnailDir)) {
    logInfo("No thumbnail folder found. Generating title thumbnail.");
    return createGeneratedThumbnail(gameTitle);
  }

  // Find the first image file in the thumbnail directory
  const files = readdirSync(thumbnailDir);
  const imageFile = files.find((f) =>
    /\.(png|jpg|jpeg|webp|gif)$/i.test(f)
  );

  if (!imageFile) {
    logInfo("No thumbnail image found in thumbnail/ folder. Generating title thumbnail.");
    return createGeneratedThumbnail(gameTitle);
  }

  const thumbnailPath = join(thumbnailDir, imageFile);
  const buffer = await Bun.file(thumbnailPath).arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const mimeType = imageFile.endsWith(".png")
    ? "image/png"
    : imageFile.endsWith(".webp")
      ? "image/webp"
      : imageFile.endsWith(".gif")
        ? "image/gif"
        : "image/jpeg";

  logSuccess(`Found thumbnail: ${imageFile}`);
  return `data:${mimeType};base64,${base64}`;
}

async function uploadGame(payload: UploadPayload): Promise<void> {
  const requestBody = JSON.stringify(payload);
  logInfo(`Uploading ${payload.title} to ${API_URL}... (${(requestBody.length / 1024 / 1024).toFixed(1)} MB)`);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`,
      },
      body: requestBody,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError(`Upload failed (${response.status}): ${errorText}`);
      if (response.status === 413) {
        logError(
          "Payload exceeds the API/edge limit (often ~100MB). Base64 JSON is ~4/3 the size of your dist/ assets. Remove or compress large files under public/ (or use --inline only if the bundle stays small), then rebuild."
        );
      }
      process.exit(1);
    }

    const result = (await response.json()) as { gameId?: string };
    logSuccess(`Upload complete!`);
    if (result.gameId) {
      logSuccess(`Uploaded game successfully`);
    }
  } catch (error) {
    logError(`Upload request failed: ${error}`);
    process.exit(1);
  }
}

export async function runUploadCli(args: string[] = []): Promise<void> {

  // Handle --list flag
  if (args.includes("--list") || args.includes("-l")) {
    const rootDir = PROJECT_ROOT;

    console.log("Available games (TypeScript/Vite):");
    const folders = getGameFolders();
    folders.forEach((f) => {
      const hasPublish = existsSync(join(rootDir, f, "publish.json"));
      console.log(`  ${hasPublish ? "✓" : "○"} ${f}`);
    });

    console.log("");
    console.log("Available games (Unity WebGL):");
    const unityDir = join(rootDir, UNITY_DIR);
    if (existsSync(unityDir)) {
      const { readdirSync: rds } = await import("fs");
      const unityGames = rds(unityDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      unityGames.forEach((f) => {
        const hasPublish = existsSync(join(unityDir, f, "publish.json"));
        const hasBuild = existsSync(join(unityDir, f, "Build", "index.html"));
        console.log(`  ${hasPublish ? "✓" : "○"} ${f}${hasBuild ? "" : "  ⚠ no Build/index.html"}`);
      });
      if (unityGames.length === 0) console.log("  (none)");
    } else {
      console.log("  (Unity/ folder not found)");
    }

    console.log("");
    console.log("✓ = has publish.json, ○ = needs publish.json");
    return;
  }

  // Handle --help flag
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
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
    console.log("  --help, -h     Show this help message");
    console.log("");
    console.log("By default, assets are uploaded separately for CDN delivery.");
    console.log("Use --inline for games that need all assets in the HTML.");
    console.log("");
    console.log("Unity WebGL games:");
    console.log("  Place Unity WebGL exports under Unity/<game-name>/Build/");
    console.log("  The script auto-detects them — no build step is run.");
    console.log("  Both 'ThreadTangle' and 'Unity/ThreadTangle' are accepted.");
    console.log("");
    console.log("Examples:");
    console.log("  oasiz upload block-blast");
    console.log("  oasiz upload block-blast horizontal");
    console.log("  oasiz upload two-dots --skip-build");
    console.log("  oasiz upload endless-hexagon --inline");
    console.log("  oasiz upload ThreadTangle            # Unity game (auto-detected)");
    console.log("  oasiz upload Unity/ThreadTangle      # Unity game (explicit)");
    console.log("  oasiz upload --list");
    console.log("  npx @oasiz/cli upload block-blast");
    console.log("");
    console.log("Environment:");
    console.log("  OASIZ_UPLOAD_TOKEN  Your API token (required)");
    console.log("  OASIZ_EMAIL         Your registered Oasiz email (required)");
    console.log("  OASIZ_API_URL       API endpoint (optional, has default)");
    return;
  }

  const gameFolder = args[0];
  const skipBuild = args.includes("--skip-build");
  const dryRun = args.includes("--dry-run");
  const useInlining = args.includes("--inline");
  const uploadAsNew = args.includes("new");

  // Orientation: "horizontal" → verticalOnly=false, "vertical" or omitted → verticalOnly=true
  const hasHorizontal = args.includes("horizontal");
  const hasVertical = args.includes("vertical");
  const orientationOverride: boolean | undefined = hasHorizontal ? false : hasVertical ? true : undefined;

  // Validate environment
  if (!dryRun) {
    await validateEnvironment();
  }

  // Resolve game path — auto-detects Unity/ games
  const { gamePath, isUnity } = resolveGamePath(gameFolder);
  // Canonical slug is always just the bare game name (strip leading Unity/ prefix)
  const gameSlug = gameFolder.replace(/^Unity\//, "");
  logInfo(`Processing game: ${gameSlug}${isUnity ? " (Unity WebGL)" : ""}`);

  // Read publish config
  const publishConfig = await readPublishConfig(gamePath);
  logSuccess(`Loaded publish.json: "${publishConfig.title}"`);

  if (uploadAsNew) {
    logInfo("Uploading as NEW game (ignoring existing gameId)");
  }

  let bundleHtml: string;
  let assets: Record<string, string> | undefined;

  if (isUnity) {
    // ── Unity WebGL upload path ──────────────────────────────────────────────
    logInfo("Unity game — skipping build step (pre-built WebGL export expected)");

    bundleHtml = await readUnityBundleHtml(gamePath);
    logSuccess(`Read Unity bundle: ${(bundleHtml.length / 1024).toFixed(1)} KB`);

    logInfo("Collecting Unity build assets for CDN upload...");
    assets = await collectUnityAssets(gamePath);
    const assetCount = Object.keys(assets).length;
    const totalSize = Object.values(assets).reduce((sum, b64) => sum + b64.length * 0.75, 0);
    logSuccess(`Collected ${assetCount} Unity assets (${(totalSize / 1024 / 1024).toFixed(1)} MB total)`);
  } else {
    // ── Normal (TypeScript/Vite) upload path ─────────────────────────────────
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
      const assetCount = Object.keys(assets).length;
      const totalSize = Object.values(assets).reduce((sum, b64) => sum + b64.length * 0.75, 0);
      logSuccess(`Collected ${assetCount} assets (${(totalSize / 1024 / 1024).toFixed(1)} MB total)`);
    }
  }

  // Read thumbnail if available
  const thumbnailBase64 = await readThumbnail(gamePath, publishConfig.title);

  // Prepare payload
  const payload: UploadPayload = {
    title: publishConfig.title,
    slug: gameSlug,
    description: publishConfig.description,
    category: publishConfig.category,
    email: CREATOR_EMAIL!,
    gameId: uploadAsNew ? undefined : publishConfig.gameId,
    isMultiplayer: publishConfig.isMultiplayer,
    maxPlayers: publishConfig.maxPlayers,
    verticalOnly: orientationOverride ?? publishConfig.verticalOnly,
    thumbnailBase64,
    bundleHtml,
    ...(assets && { assets }),
  };

  if (dryRun) {
    logInfo("Dry run mode - skipping upload");
    console.log("");
    console.log("Would upload:");
    console.log(`  Title: ${payload.title}`);
    console.log(`  Slug: ${payload.slug}`);
    console.log(`  Category: ${payload.category}`);
    console.log(`  Description: ${payload.description}`);
    console.log(`  Creator Email: ${payload.email}`);
    console.log(`  Has Thumbnail: ${!!payload.thumbnailBase64}`);
    console.log(`  Vertical Only: ${payload.verticalOnly ?? true} (default: true)`);
    console.log(`  Bundle Size: ${(payload.bundleHtml.length / 1024).toFixed(1)} KB`);
    console.log(`  Type: ${isUnity ? "Unity WebGL" : useInlining ? "Inline (legacy)" : "CDN Assets"}`);
    if (assets) {
      console.log(`  Assets: ${Object.keys(assets).length} files`);
    }
    console.log(`  Game ID: ${payload.gameId || "(will be assigned)"}`);
    return;
  }

  // Upload!
  await uploadGame(payload);
}

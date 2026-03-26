import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { toPosixPath } from "./runtime.ts";

export interface UploadAssetMap {
  [relativePath: string]: string;
}

export interface DistSummary {
  htmlBytes: number;
  assetCount: number;
  assetBytes: number;
  totalBytes: number;
  topAssets: Array<{ path: string; bytes: number }>;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }
  if (bytes >= 1024) {
    return (bytes / 1024).toFixed(1) + " KB";
  }
  return bytes + " B";
}

function detectPackageManager(projectPath: string): "bun" | "npm" {
  if (existsSync(join(projectPath, "bun.lock")) || existsSync(join(projectPath, "bun.lockb"))) {
    return "bun";
  }

  return "npm";
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

      rejectPromise(
        new Error(
          "Command failed (" + argv.join(" ") + ")" + (stderr ? "\n" + stderr.trim() : ""),
        ),
      );
    });
  });
}

export async function buildGame(gamePath: string): Promise<void> {
  const packageManager = detectPackageManager(gamePath);
  await runCommand(packageManager === "bun" ? ["bun", "install"] : ["npm", "install"], gamePath, true);

  const packageJsonPath = join(gamePath, "package.json");
  let useCustomBuild = false;
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    useCustomBuild = Boolean(packageJson.scripts?.build);
  }

  if (useCustomBuild) {
    await runCommand(packageManager === "bun" ? ["bun", "run", "build"] : ["npm", "run", "build"], gamePath, true);
    return;
  }

  await runCommand(packageManager === "bun" ? ["bunx", "--bun", "vite", "build"] : ["npx", "vite", "build"], gamePath, true);
}

export async function readBundleHtml(gamePath: string): Promise<string> {
  const distIndexPath = join(gamePath, "dist", "index.html");
  if (!existsSync(distIndexPath)) {
    throw new Error("Build output not found at dist/index.html");
  }

  return readFile(distIndexPath, "utf8");
}

export async function collectAssets(gamePath: string): Promise<UploadAssetMap> {
  const distPath = join(gamePath, "dist");
  const assets: UploadAssetMap = {};

  if (!existsSync(distPath)) {
    return assets;
  }

  const allFiles = getAllFiles(distPath);
  for (const filePath of allFiles) {
    const relPath = toPosixPath(relative(distPath, filePath));
    if (relPath.endsWith(".html")) continue;

    const fileSize = statSync(filePath).size;
    if (fileSize > 50 * 1024 * 1024) continue;

    const buffer = await readFile(filePath);
    assets[relPath] = buffer.toString("base64");
  }

  return assets;
}

export async function readThumbnail(gamePath: string): Promise<string | undefined> {
  const thumbnailPath = join(gamePath, "thumbnail");
  if (!existsSync(thumbnailPath)) return undefined;

  const files = readdirSync(thumbnailPath);
  const imageFile = files.find((file) => /\.(png|jpe?g|webp|gif)$/i.test(file));
  if (!imageFile) return undefined;

  const fullPath = join(thumbnailPath, imageFile);
  const buffer = await readFile(fullPath);
  const lower = imageFile.toLowerCase();
  const mimeType = lower.endsWith(".png")
    ? "image/png"
    : lower.endsWith(".webp")
      ? "image/webp"
      : lower.endsWith(".gif")
        ? "image/gif"
        : "image/jpeg";

  return "data:" + mimeType + ";base64," + buffer.toString("base64");
}

export function summarizeDist(gamePath: string): DistSummary {
  const distPath = join(gamePath, "dist");
  if (!existsSync(distPath)) {
    throw new Error("dist folder not found");
  }

  const files = getAllFiles(distPath);
  let htmlBytes = 0;
  let assetBytes = 0;
  let assetCount = 0;
  const assets: Array<{ path: string; bytes: number }> = [];

  for (const filePath of files) {
    const relPath = toPosixPath(relative(distPath, filePath));
    const bytes = statSync(filePath).size;
    const ext = extname(filePath).toLowerCase();
    const isHtml = ext === ".html";

    if (isHtml) {
      htmlBytes += bytes;
      continue;
    }

    assetCount += 1;
    assetBytes += bytes;
    assets.push({ path: relPath, bytes });
  }

  assets.sort((a, b) => b.bytes - a.bytes);

  return {
    htmlBytes,
    assetCount,
    assetBytes,
    totalBytes: htmlBytes + assetBytes,
    topAssets: assets.slice(0, 5),
  };
}

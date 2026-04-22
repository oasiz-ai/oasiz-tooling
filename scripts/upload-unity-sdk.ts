#!/usr/bin/env bun

/**
 * Package and upload a Unity SDK package to R2.
 *
 * Accepts either a directory (UPM package root) or a pre-built .unitypackage file.
 * When given a directory, builds a proper .unitypackage (GUID-based tar.gz) first.
 *
 * Usage:
 *   bun run scripts/upload-unity-sdk.ts <path> [--dry-run]
 *
 * Examples:
 *   bun run scripts/upload-unity-sdk.ts ./packages/OasizSDK
 *   bun run scripts/upload-unity-sdk.ts ./OasizSDK.unitypackage
 *   bun run scripts/upload-unity-sdk.ts ./packages/OasizSDK --dry-run
 *
 * Required env vars (only when uploading; not needed for --dry-run):
 *   R2_BUCKET_URL          e.g. https://<account>.r2.cloudflarestorage.com/<bucket>
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_CUSTOM_DOMAIN       e.g. https://assets.oasiz.ai
 */

import { config } from "dotenv";
config();

import {
  existsSync,
  readFileSync,
  statSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { resolve, join, relative, extname, basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const R2_KEY = "sdk/unity/OasizSDK.unitypackage";
const ASSET_ROOT = "Assets/OasizSDK";

// ---------- R2 client ----------

function parseBucketUrl(raw: string) {
  const url = new URL(raw);
  const pathParts = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
  const bucket = pathParts[0];
  if (!bucket) {
    throw new Error(
      "R2_BUCKET_URL must include bucket name as path, e.g. https://<account>.r2.cloudflarestorage.com/<bucket>",
    );
  }
  return { bucket, endpoint: `${url.protocol}//${url.host}` };
}

function getR2() {
  const bucketUrl = process.env.R2_BUCKET_URL;
  if (!bucketUrl) throw new Error("Missing R2_BUCKET_URL environment variable");
  const { bucket, endpoint } = parseBucketUrl(bucketUrl);

  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  const s3 = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials:
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : undefined,
  });
  return { s3, bucket };
}

function buildR2PublicUrl(key: string): string {
  const customDomain = process.env.R2_CUSTOM_DOMAIN;
  if (!customDomain) {
    throw new Error("R2_CUSTOM_DOMAIN environment variable is required");
  }
  const safeKey = key
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const u = new URL(customDomain);
  return `${u.protocol}//${u.host}/${safeKey}`;
}

// ---------- .unitypackage builder ----------

function extractGuid(metaPath: string): string | null {
  const content = readFileSync(metaPath, "utf-8");
  const match = content.match(/guid:\s*([0-9a-f]+)/);
  return match?.[1] ?? null;
}

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkFiles(full));
    else results.push(full);
  }
  return results;
}

/**
 * Build a .unitypackage from a UPM-style directory.
 *
 * A .unitypackage is a gzipped tar containing one folder per asset,
 * named by the GUID from its .meta file. Each GUID folder contains:
 *   - asset       (the file itself; omitted for directory entries)
 *   - asset.meta  (the .meta file)
 *   - pathname    (text file with the Unity project-relative path)
 */
function buildUnityPackage(sourceDir: string): string {
  const stagingDir = join(tmpdir(), `oasiz-unity-pkg-${Date.now()}`);
  mkdirSync(stagingDir, { recursive: true });

  const sourceName = basename(resolve(sourceDir));
  const assetRootPrefix = ASSET_ROOT.endsWith(`/${sourceName}`)
    ? ASSET_ROOT.slice(0, ASSET_ROOT.length - sourceName.length - 1)
    : ASSET_ROOT;

  const allFiles = walkFiles(sourceDir);
  const metaFiles = allFiles.filter((f) => f.endsWith(".meta"));

  if (metaFiles.length === 0) {
    throw new Error(
      `No .meta files found in ${sourceDir}. ` +
        "A Unity package directory must contain .meta files (open the project in Unity at least once to generate them).",
    );
  }

  let entryCount = 0;
  const seenGuids = new Set<string>();

  for (const metaPath of metaFiles) {
    const guid = extractGuid(metaPath);
    if (!guid) {
      console.warn(`  skip (no GUID in meta): ${relative(sourceDir, metaPath)}`);
      continue;
    }
    if (seenGuids.has(guid)) {
      console.warn(
        `  skip (duplicate GUID ${guid}): ${relative(sourceDir, metaPath)}`,
      );
      continue;
    }
    seenGuids.add(guid);

    // The asset path is the .meta path with the .meta extension stripped.
    const assetPath = metaPath.slice(0, -".meta".length);
    const assetExists = existsSync(assetPath);

    // Project-relative pathname (POSIX style).
    const relFromSource = relative(sourceDir, assetPath).split("\\").join("/");
    const projectPath =
      `${assetRootPrefix}/${sourceName}/${relFromSource}`.replace(
        /\/+$/,
        "",
      );

    const guidDir = join(stagingDir, guid);
    mkdirSync(guidDir, { recursive: true });

    // Always include the .meta file.
    copyFileSync(metaPath, join(guidDir, "asset.meta"));

    // Project-relative path.
    writeFileSync(join(guidDir, "pathname"), projectPath, "utf-8");

    // Include the asset content if it exists and is a file (skip dirs).
    if (assetExists && statSync(assetPath).isFile()) {
      copyFileSync(assetPath, join(guidDir, "asset"));
    }

    entryCount += 1;
  }

  if (entryCount === 0) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw new Error(
      `No valid asset entries produced from ${sourceDir}. Check that .meta files contain GUIDs.`,
    );
  }

  const outputPath = join(
    tmpdir(),
    `OasizSDK-${Date.now()}.unitypackage`,
  );

  // Build gzipped tar of the staging directory contents.
  // Use -C to avoid embedding the staging dir name itself.
  execSync(
    `tar -czf ${JSON.stringify(outputPath)} -C ${JSON.stringify(stagingDir)} .`,
    { stdio: "inherit" },
  );

  rmSync(stagingDir, { recursive: true, force: true });

  console.log(
    `Built .unitypackage with ${entryCount} entries: ${outputPath}`,
  );
  return outputPath;
}

// ---------- Upload ----------

async function uploadToR2(filePath: string): Promise<string> {
  const { s3, bucket } = getR2();
  const body = readFileSync(filePath);

  console.log(
    `Uploading ${(body.byteLength / (1024 * 1024)).toFixed(2)} MiB to ` +
      `r2://${bucket}/${R2_KEY} ...`,
  );

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: R2_KEY,
      Body: body,
      ContentType: "application/gzip",
      CacheControl: "public, max-age=300",
    }),
  );

  return buildR2PublicUrl(R2_KEY);
}

// ---------- Main ----------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((a) => !a.startsWith("--"));
  const inputArg = positional[0];
  if (!inputArg) {
    console.error(
      "Usage: bun run scripts/upload-unity-sdk.ts <path> [--dry-run]",
    );
    console.error(
      "       <path> is either a UPM package directory or a .unitypackage file",
    );
    process.exit(1);
  }

  const inputPath = resolve(inputArg);
  if (!existsSync(inputPath)) {
    throw new Error(`Path does not exist: ${inputPath}`);
  }

  const stat = statSync(inputPath);
  let packagePath: string;
  let cleanupPackage = false;

  if (stat.isDirectory()) {
    console.log(`Building .unitypackage from directory: ${inputPath}`);
    packagePath = buildUnityPackage(inputPath);
    cleanupPackage = true;
  } else if (stat.isFile() && extname(inputPath) === ".unitypackage") {
    console.log(`Using pre-built .unitypackage: ${inputPath}`);
    packagePath = inputPath;
  } else {
    throw new Error(
      `Unsupported input: ${inputPath} (must be a directory or .unitypackage file)`,
    );
  }

  try {
    if (dryRun) {
      console.log("");
      console.log("Dry run - skipping upload.");
      console.log(`  Package: ${packagePath}`);
      console.log(
        `  Would upload to: r2://<bucket>/${R2_KEY}`,
      );
      // Keep the artifact around so the caller can inspect it.
      cleanupPackage = false;
      return;
    }
    const url = await uploadToR2(packagePath);
    console.log("");
    console.log("Upload complete!");
    console.log(`  Public URL: ${url}`);
  } finally {
    if (cleanupPackage) {
      try {
        rmSync(packagePath, { force: true });
      } catch {
        // best effort
      }
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});

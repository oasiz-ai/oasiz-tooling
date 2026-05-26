#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function usage() {
  console.error(
    "Usage: node scripts/publish-npm-workspace.mjs <package-dir> [--tag <tag>] [--dry-run]",
  );
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/.exec(version.trim());
  if (!match) {
    throw new Error(`Unsupported semver version: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function nextPatch(version) {
  const parsed = parseVersion(version);
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function npmView(args) {
  try {
    return execFileSync("npm", ["view", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function findAvailableVersion(packageName, requestedVersion) {
  let candidate = requestedVersion;
  while (npmView([`${packageName}@${candidate}`, "version", "--json"])) {
    candidate = nextPatch(candidate);
  }
  return candidate;
}

const args = process.argv.slice(2);
const packageDirArg = args.find((arg) => !arg.startsWith("--"));
if (!packageDirArg) {
  usage();
  process.exit(1);
}

const dryRun = args.includes("--dry-run");
const tagIndex = args.indexOf("--tag");
const tag = tagIndex >= 0 ? args[tagIndex + 1] : "latest";
if (!tag) {
  throw new Error("--tag requires a value");
}

const packageDir = resolve(packageDirArg);
const packageJsonPath = resolve(packageDir, "package.json");
if (!existsSync(packageJsonPath)) {
  throw new Error(`package.json not found: ${packageJsonPath}`);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
if (!packageJson.name || !packageJson.version) {
  throw new Error(`package.json must include name and version: ${packageJsonPath}`);
}

const latestVersion = npmView([packageJson.name, "version", "--json"]).replace(
  /^"|"$/g,
  "",
);
const requestedVersion =
  latestVersion && compareVersions(packageJson.version, latestVersion) <= 0
    ? nextPatch(latestVersion)
    : packageJson.version;
const publishVersion = findAvailableVersion(packageJson.name, requestedVersion);

console.log(`Package: ${packageJson.name}`);
console.log(`Local version: ${packageJson.version}`);
console.log(`npm latest: ${latestVersion || "(none)"}`);
console.log(`Publish version: ${publishVersion}`);
console.log(`Tag: ${tag}`);

if (packageJson.version !== publishVersion && dryRun) {
  console.log(`Would update ${packageJsonPath} to ${publishVersion}.`);
}

if (packageJson.version !== publishVersion && !dryRun) {
  packageJson.version = publishVersion;
  writeFileSync(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );
}

if (dryRun) {
  console.log("Dry run - skipping npm publish.");
  process.exit(0);
}

execFileSync("npm", ["publish", "--access", "public", "--tag", tag], {
  cwd: packageDir,
  env: process.env,
  stdio: "inherit",
});

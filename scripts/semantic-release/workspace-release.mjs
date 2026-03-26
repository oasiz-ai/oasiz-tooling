import { execFileSync } from "node:child_process";

const RELEASE_RANK = {
  patch: 1,
  minor: 2,
  major: 3,
};

function toPosixPath(path) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function getChangedFiles(hash) {
  const output = execFileSync(
    "git",
    ["diff-tree", "--no-commit-id", "--name-only", "-r", hash],
    { encoding: "utf8" },
  );
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(toPosixPath);
}

function commitTouchesWorkspace(commit, packagePath) {
  const normalizedPackagePath = `${toPosixPath(packagePath)}/`;
  const files = getChangedFiles(commit.hash);
  return files.some((file) => file.startsWith(normalizedPackagePath));
}

function getReleaseType(message) {
  const normalized = message.trim();
  const firstLine = normalized.split("\n")[0] ?? "";

  if (
    /BREAKING CHANGE:/m.test(normalized) ||
    /^[a-zA-Z0-9_-]+(\([^)]+\))?!:/.test(firstLine)
  ) {
    return "major";
  }

  if (/^feat(\([^)]+\))?:/.test(firstLine)) {
    return "minor";
  }

  if (/^(fix|perf|refactor)(\([^)]+\))?:/.test(firstLine)) {
    return "patch";
  }

  return null;
}

function filterCommits(commits, packagePath) {
  return commits.filter((commit) => commitTouchesWorkspace(commit, packagePath));
}

export async function analyzeCommits(pluginConfig, context) {
  const packagePath = pluginConfig.packagePath;
  const scopedCommits = filterCommits(context.commits, packagePath);

  if (scopedCommits.length === 0) {
    context.logger.log(
      `No releasable commits for ${packagePath}; skipping package release.`,
    );
    return null;
  }

  let nextReleaseType = null;
  for (const commit of scopedCommits) {
    const releaseType = getReleaseType(commit.message);
    if (!releaseType) {
      continue;
    }
    if (
      !nextReleaseType ||
      RELEASE_RANK[releaseType] > RELEASE_RANK[nextReleaseType]
    ) {
      nextReleaseType = releaseType;
    }
  }

  if (!nextReleaseType) {
    context.logger.log(
      `Commits touched ${packagePath}, but none require a release.`,
    );
  }

  return nextReleaseType;
}

export async function generateNotes(pluginConfig, context) {
  const packagePath = pluginConfig.packagePath;
  const packageName = pluginConfig.packageName;
  const scopedCommits = filterCommits(context.commits, packagePath);

  if (scopedCommits.length === 0) {
    return "";
  }

  const lines = [`## ${packageName}`, ""];
  for (const commit of scopedCommits) {
    const summary = (commit.subject || commit.message.split("\n")[0] || commit.hash)
      .trim();
    lines.push(`- ${summary} (${commit.shortHash || commit.hash.slice(0, 7)})`);
  }

  return `${lines.join("\n")}\n`;
}

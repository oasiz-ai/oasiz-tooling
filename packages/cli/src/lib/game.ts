import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { getAssetPath, getProjectRoot } from "./runtime.ts";

export type PublishCategory =
  | "arcade"
  | "puzzle"
  | "party"
  | "action"
  | "strategy"
  | "casual";

export interface PublishConfig {
  title: string;
  description: string;
  category: PublishCategory;
  gameId?: string;
  isMultiplayer?: boolean;
  maxPlayers?: number;
  verticalOnly?: boolean;
}

const EXCLUDE_DIRS = new Set([
  "scripts",
  "template",
  "templates",
  "node_modules",
  ".git",
  "unfinished-games",
  "perfect-drop",
]);

export function getTemplateRoot(): string {
  return getAssetPath("template");
}

export function getMainTemplateRoot(): string {
  return getAssetPath("templates");
}

export function isGameSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function getGameFolders(): string[] {
  const rootDir = getProjectRoot();

  return readdirSync(rootDir, { withFileTypes: true })
    .filter((dirent) => {
      if (!dirent.isDirectory()) return false;
      if (dirent.name.startsWith(".")) return false;
      if (EXCLUDE_DIRS.has(dirent.name)) return false;

      const gamePath = join(rootDir, dirent.name);
      return (
        existsSync(join(gamePath, "package.json")) &&
        (existsSync(join(gamePath, "src", "main.ts")) || existsSync(join(gamePath, "index.html")))
      );
    })
    .map((dirent) => dirent.name)
    .sort((a, b) => a.localeCompare(b));
}

export function getGamePath(gameFolder: string): string {
  return join(getProjectRoot(), gameFolder);
}

export function validateGameFolder(gameFolder: string): string {
  const gamePath = getGamePath(gameFolder);
  if (!existsSync(gamePath)) {
    throw new Error("Game folder not found: " + gameFolder);
  }

  return gamePath;
}

export async function readPublishConfig(gamePath: string): Promise<PublishConfig> {
  const publishPath = join(gamePath, "publish.json");
  const gameFolder = basename(gamePath) || "unknown";

  const defaults: PublishConfig = {
    title: slugToTitle(gameFolder),
    description: "",
    category: "arcade",
  };

  if (!existsSync(publishPath)) {
    return defaults;
  }

  const text = await readFile(publishPath, "utf8");
  const parsed = JSON.parse(text) as Partial<PublishConfig>;

  return {
    title: parsed.title || defaults.title,
    description: parsed.description || defaults.description,
    category: parsed.category || defaults.category,
    gameId: parsed.gameId,
    isMultiplayer: parsed.isMultiplayer,
    maxPlayers: parsed.maxPlayers,
    verticalOnly: parsed.verticalOnly,
  };
}

export async function writePublishConfig(gamePath: string, config: PublishConfig): Promise<void> {
  const publishPath = join(gamePath, "publish.json");
  await writeFile(publishPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

interface MainTemplateEntry {
  name: string;
  path: string;
}

function toTemplateName(fileName: string): string {
  if (fileName.endsWith(".ts.template")) {
    return fileName.slice(0, -".ts.template".length);
  }
  if (fileName.endsWith(".template")) {
    return fileName.slice(0, -".template".length);
  }

  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) return fileName;
  return fileName.slice(0, dotIndex);
}

function readTemplateEntriesFrom(rootPath: string): MainTemplateEntry[] {
  const files = readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => ({ name: toTemplateName(entry.name), path: join(rootPath, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (files.length === 0) {
    throw new Error("No templates found in: " + rootPath);
  }

  const seenNames = new Set<string>();
  for (const file of files) {
    if (seenNames.has(file.name)) {
      throw new Error("Duplicate template name found: " + file.name + " in " + rootPath);
    }
    seenNames.add(file.name);
  }

  return files;
}

function resolveMainTemplates(): MainTemplateEntry[] {
  const templateRoot = getMainTemplateRoot();
  if (!existsSync(templateRoot)) {
    throw new Error("Template directory not found. Package assets are missing.");
  }

  return readTemplateEntriesFrom(templateRoot);
}

export function listMainTemplates(): string[] {
  return resolveMainTemplates().map((template) => template.name);
}

export async function readMainTemplateByName(templateName: string): Promise<string> {
  const templates = resolveMainTemplates();
  const selected = templates.find((template) => template.name === templateName);
  if (!selected) {
    const options = templates.map((template) => template.name).join(", ");
    throw new Error("Unknown template: " + templateName + ". Available templates: " + options);
  }

  return readFile(selected.path, "utf8");
}

export function scaffoldFromTemplate(gameSlug: string): string {
  const targetPath = getGamePath(gameSlug);
  const templatePath = getTemplateRoot();

  if (existsSync(targetPath)) {
    throw new Error("Target directory already exists: " + gameSlug);
  }
  if (!existsSync(templatePath)) {
    throw new Error("Template directory not found: " + templatePath);
  }

  cpSync(templatePath, targetPath, { recursive: true });
  mkdirSync(join(targetPath, "src"), { recursive: true });
  return targetPath;
}

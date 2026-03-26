import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function getProjectRoot(): string {
  return resolve(process.env.OASIZ_PROJECT_ROOT ?? process.cwd());
}

export function getPackageRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}

export function getAssetPath(...segments: string[]): string {
  return join(getPackageRoot(), "assets", ...segments);
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

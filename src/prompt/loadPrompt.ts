import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config.js";
import type { Config } from "../types/common.js";

const PROMPT_FILENAME_PATTERN = /^prompt_(v\d+(?:\.\d+)*)\.md$/i;

export interface LoadPromptOverrides {
  getConfigFn?: () => Promise<Config>;
  readDirFn?: (dirpath: string) => Promise<string[]>;
  readFileFn?: (filepath: string, encoding: "utf-8") => Promise<string>;
}

const isLatestPromptVersion = (version: string | undefined): boolean => {
  if (!version) return true;
  const normalized = version.trim();
  return normalized === "" || normalized.toLowerCase() === "latest";
};

const comparePromptVersions = (a: string, b: string): number => {
  const aParts = a
    .replace(/^v/i, "")
    .split(".")
    .map((p) => Number.parseInt(p, 10));
  const bParts = b
    .replace(/^v/i, "")
    .split(".")
    .map((p) => Number.parseInt(p, 10));

  const length = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < length; i++) {
    const aValue = aParts[i] ?? 0;
    const bValue = bParts[i] ?? 0;
    if (aValue !== bValue) return aValue - bValue;
  }
  return 0;
};

const resolvePromptVersion = async (
  configuredVersion: string | undefined,
  promptsDir: string,
  readDirFn?: LoadPromptOverrides["readDirFn"],
): Promise<string> => {
  const normalizedVersion = configuredVersion?.trim();
  if (!isLatestPromptVersion(normalizedVersion)) {
    return normalizedVersion!;
  }

  const files = readDirFn
    ? await readDirFn(promptsDir)
    : await fs.readdir(promptsDir);
  const versions = files
    .map((name) => {
      const match = name.match(PROMPT_FILENAME_PATTERN);
      return match?.[1];
    })
    .filter((v): v is string => !!v);

  if (versions.length === 0) {
    throw new Error(`No prompt files found in ${promptsDir}`);
  }

  versions.sort(comparePromptVersions);
  return versions[versions.length - 1]!;
};

export const loadPrompt = async (
  overrides?: LoadPromptOverrides,
): Promise<string> => {
  const config = overrides?.getConfigFn
    ? await overrides.getConfigFn()
    : await getConfig();

  const promptsDir = path.join(process.cwd(), "prompts");
  const promptVersion = await resolvePromptVersion(
    config.batch.promptVersion,
    promptsDir,
    overrides?.readDirFn,
  );
  const filename = `prompt_${promptVersion}.md`;
  const filepath = path.join(promptsDir, filename);

  if (overrides?.readFileFn) {
    return await overrides.readFileFn(filepath, "utf-8");
  }
  return await fs.readFile(filepath, "utf-8");
};

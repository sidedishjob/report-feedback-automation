import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config.js";
import type { Config } from "../types/common.js";

export interface LoadPromptOverrides {
  getConfigFn?: () => Promise<Config>;
  readFileFn?: (filepath: string, encoding: "utf-8") => Promise<string>;
}

export const loadPrompt = async (
  overrides?: LoadPromptOverrides,
): Promise<string> => {
  const config = overrides?.getConfigFn
    ? await overrides.getConfigFn()
    : await getConfig();

  const filename = `prompt_${config.batch.promptVersion}.md`;
  const filepath = path.join(process.cwd(), "prompts", filename);

  if (overrides?.readFileFn) {
    return await overrides.readFileFn(filepath, "utf-8");
  }
  return await fs.readFile(filepath, "utf-8");
};

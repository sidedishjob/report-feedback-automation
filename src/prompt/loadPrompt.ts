import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config.js";

export const loadPrompt = async (): Promise<string> => {
  const config = await getConfig();

  const filename = `prompt_${config.batch.promptVersion}.md`;
  const filepath = path.join(process.cwd(), "prompts", filename);

  return await fs.readFile(filepath, "utf-8");
};

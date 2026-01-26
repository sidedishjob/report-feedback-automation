import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

export const loadPrompt = async () => {
    const filename = `prompt_${config.batch.promptVersion}.md`;
    const filepath = path.join(process.cwd(), 'prompts', filename);
    return await fs.readFile(filepath, 'utf-8');
};
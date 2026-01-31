import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadPrompt } from "./loadPrompt.js";
import type { Config } from "../types/common.js";

const mockConfig: Config = {
  notion: {
    token: "t",
    dataSourceId: "ds",
    version: "2025-09-03",
  },
  gemini: {
    apiKey: "k",
    model: "gemini-2.5-flash",
  },
  batch: {
    maxItemsPerRun: 5,
    minBodyChars: 80,
    geminiIntervalMs: 15_000,
    promptVersion: "v1.0",
    debug: false,
  },
};

describe("loadPrompt", () => {
  it("promptVersion に応じたファイルパスで readFile を呼び、内容を返す", async () => {
    let capturedPath = "";
    const content = "# プロンプト v1.0\nあなたはメンターです。";
    const result = await loadPrompt({
      getConfigFn: async () => mockConfig,
      readFileFn: async (filepath: string) => {
        capturedPath = filepath;
        return content;
      },
    });

    assert.ok(
      capturedPath.includes("prompts") &&
        capturedPath.includes("prompt_v1.0.md"),
      `path should contain prompts/prompt_v1.0.md, got: ${capturedPath}`,
    );
    assert.strictEqual(result, content);
  });

  it("promptVersion が v2.0 のとき prompt_v2.0.md を読む", async () => {
    let capturedPath = "";
    await loadPrompt({
      getConfigFn: async () => ({
        ...mockConfig,
        batch: { ...mockConfig.batch, promptVersion: "v2.0" },
      }),
      readFileFn: async (filepath: string) => {
        capturedPath = filepath;
        return "v2 content";
      },
    });

    assert.ok(
      capturedPath.endsWith("prompt_v2.0.md"),
      `path should end with prompt_v2.0.md, got: ${capturedPath}`,
    );
  });

  it("readFile が ENOENT のときエラーが伝播する", async () => {
    const err = new Error("ENOENT: no such file");
    (err as NodeJS.ErrnoException).code = "ENOENT";
    await assert.rejects(
      async () =>
        loadPrompt({
          getConfigFn: async () => mockConfig,
          readFileFn: async () => {
            throw err;
          },
        }),
      /ENOENT/,
    );
  });
});

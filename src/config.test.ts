import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { toInt, getConfig, resetConfigForTesting } from "./config.js";
import { clearCacheForTesting } from "./config/envLoader.js";

describe("toInt", () => {
  it("有効な数値文字列はその整数にパースする", () => {
    assert.strictEqual(toInt("42", 0), 42);
    assert.strictEqual(toInt("0", 10), 0);
    assert.strictEqual(toInt("15000", 5), 15_000);
  });

  it("undefined の場合は fallback を返す", () => {
    assert.strictEqual(toInt(undefined, 80), 80);
  });

  it("空文字の場合は fallback を返す", () => {
    assert.strictEqual(toInt("", 5), 5);
  });

  it("NaN になる文字列は fallback を返す", () => {
    assert.strictEqual(toInt("abc", 10), 10);
    assert.strictEqual(toInt("nope", 0), 0);
  });

  it("負の整数はパースする", () => {
    assert.strictEqual(toInt("-1", 0), -1);
  });
});

describe("getConfig", () => {
  const requiredEnv: Record<string, string> = {
    NOTION_TOKEN: "nt",
    NOTION_DATA_SOURCE_ID: "ds-id",
    GEMINI_API_KEY: "gk",
  };

  beforeEach(() => {
    clearCacheForTesting();
    resetConfigForTesting();
    for (const [k, v] of Object.entries(requiredEnv)) {
      process.env[k] = v;
    }
    delete process.env.NOTION_VERSION;
    delete process.env.GEMINI_MODEL;
    delete process.env.MAX_ITEMS_PER_RUN;
    delete process.env.MIN_BODY_CHARS;
    delete process.env.GEMINI_INTERVAL_MS;
    delete process.env.PROMPT_VERSION;
    delete process.env.DEBUG;
  });

  it("必須キーが揃っている場合、設計書のデフォルトで Config を返す", async () => {
    const config = await getConfig();
    assert.strictEqual(config.notion.token, "nt");
    assert.strictEqual(config.notion.dataSourceId, "ds-id");
    assert.strictEqual(config.notion.version, "2025-09-03");
    assert.strictEqual(config.gemini.apiKey, "gk");
    assert.strictEqual(config.gemini.model, "gemini-2.5-flash");
    assert.strictEqual(config.batch.maxItemsPerRun, 5);
    assert.strictEqual(config.batch.minBodyChars, 80);
    assert.strictEqual(config.batch.geminiIntervalMs, 15_000);
    assert.strictEqual(config.batch.promptVersion, "v1.0");
    assert.strictEqual(config.batch.debug, false);
  });

  it("オプション系を渡すとその値が使われる", async () => {
    process.env.NOTION_VERSION = "2024-01-01";
    process.env.GEMINI_MODEL = "gemini-pro";
    process.env.MAX_ITEMS_PER_RUN = "10";
    process.env.MIN_BODY_CHARS = "100";
    process.env.GEMINI_INTERVAL_MS = "20000";
    process.env.PROMPT_VERSION = "v2.0";
    process.env.DEBUG = "1";
    clearCacheForTesting();
    resetConfigForTesting();

    const config = await getConfig();
    assert.strictEqual(config.notion.version, "2024-01-01");
    assert.strictEqual(config.gemini.model, "gemini-pro");
    assert.strictEqual(config.batch.maxItemsPerRun, 10);
    assert.strictEqual(config.batch.minBodyChars, 100);
    assert.strictEqual(config.batch.geminiIntervalMs, 20_000);
    assert.strictEqual(config.batch.promptVersion, "v2.0");
    assert.strictEqual(config.batch.debug, true);
  });

  it("必須キー欠損時は getConfig が reject する", async () => {
    delete process.env.NOTION_TOKEN;
    clearCacheForTesting();
    resetConfigForTesting();

    await assert.rejects(async () => getConfig(), /Missing env: NOTION_TOKEN/);
  });
});

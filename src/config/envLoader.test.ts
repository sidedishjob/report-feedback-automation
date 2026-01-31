import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isLambda,
  getEnvValue,
  getRequiredEnvValue,
  clearCacheForTesting,
} from "./envLoader.js";

describe("isLambda", () => {
  const lambdaVars = [
    "AWS_LAMBDA_FUNCTION_NAME",
    "AWS_EXECUTION_ENV",
    "LAMBDA_TASK_ROOT",
  ];
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of lambdaVars) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of lambdaVars) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
      else delete process.env[k];
    }
  });

  it("AWS_LAMBDA_* 等が無いとき false", () => {
    assert.strictEqual(isLambda(), false);
  });

  it("AWS_LAMBDA_FUNCTION_NAME があるとき true", () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "my-fn";
    assert.strictEqual(isLambda(), true);
  });

  it("AWS_EXECUTION_ENV があるとき true", () => {
    process.env.AWS_EXECUTION_ENV = "node";
    assert.strictEqual(isLambda(), true);
  });
});

describe("getEnvValue", () => {
  beforeEach(() => {
    clearCacheForTesting();
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.AWS_EXECUTION_ENV;
    delete process.env.LAMBDA_TASK_ROOT;
  });

  it("ローカル時は process.env[key] を返す", async () => {
    process.env.TEST_ENV_KEY = "local-value";
    const v = await getEnvValue("TEST_ENV_KEY");
    assert.strictEqual(v, "local-value");
  });

  it("未設定なら undefined", async () => {
    const v = await getEnvValue("NONEXISTENT_KEY_XYZ");
    assert.strictEqual(v, undefined);
  });
});

describe("getRequiredEnvValue", () => {
  beforeEach(() => {
    clearCacheForTesting();
  });

  it("値ありならその値を返す", async () => {
    process.env.REQ_KEY = "required-value";
    const v = await getRequiredEnvValue("REQ_KEY");
    assert.strictEqual(v, "required-value");
  });

  it("値なしなら throw new Error(`Missing env: ${key}`)", async () => {
    delete process.env.MISSING_KEY_XYZ;
    clearCacheForTesting();
    await assert.rejects(
      async () => getRequiredEnvValue("MISSING_KEY_XYZ"),
      /Missing env: MISSING_KEY_XYZ/,
    );
  });
});

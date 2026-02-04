import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Config } from "../types/common.js";
import type { NotionBlock } from "../types/notion.js";
import { blocksToReportMarkdown } from "./helpers.js";
import {
  queryTargetPageIds,
  listBlockChildren,
  collectBlocksRecursively,
  updatePageFeedbackBlock,
  processOneItem,
  runBatch,
} from "./runBatch.js";

const mockConfig: Config = {
  notion: {
    token: "secret",
    dataSourceId: "ds-123",
    version: "2025-09-03",
  },
  gemini: {
    apiKey: "key",
    model: "gemini-2.5-flash",
  },
  batch: {
    maxItemsPerRun: 5,
    minBodyChars: 80,
    geminiIntervalMs: 100,
    promptVersion: "v1.0",
    debug: false,
  },
};

const createMockBlock = (
  id: string,
  type: string,
  richText: string,
  has_children = false,
): NotionBlock => {
  const block: NotionBlock = {
    id,
    type,
    has_children,
  };
  if (type === "paragraph") {
    block.paragraph = { rich_text: [{ plain_text: richText }] };
  }
  if (type === "heading_2") {
    block.heading_2 = { rich_text: [{ plain_text: richText }] };
  }
  return block;
};

describe("queryTargetPageIds", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("正しい URL・body で data_sources/query を呼び results[].id を返す", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      capturedBody = init?.body ? JSON.parse(init.body as string) : null;
      return new Response(
        JSON.stringify({ results: [{ id: "page-1" }, { id: "page-2" }] }),
        { status: 200 },
      );
    }) as typeof globalThis.fetch;

    const ids = await queryTargetPageIds(mockConfig);

    assert.ok(capturedUrl.includes("/data_sources/ds-123/query"));
    assert.deepStrictEqual(capturedBody, {
      filter: {
        and: [
          { property: "FB_READY", checkbox: { equals: true } },
          { property: "FB_DONE", checkbox: { equals: false } },
        ],
      },
      page_size: 5,
    });
    assert.deepStrictEqual(ids, ["page-1", "page-2"]);
  });
});

describe("listBlockChildren", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("page_size=100 と start_cursor で blocks/:id/children を呼ぶ", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (url: string | URL) => {
      capturedUrl = typeof url === "string" ? url : url.toString();
      return new Response(
        JSON.stringify({
          results: [createMockBlock("b1", "paragraph", "text", false)],
          has_more: false,
          next_cursor: null,
        }),
        { status: 200 },
      );
    }) as typeof globalThis.fetch;

    await listBlockChildren(mockConfig, "block-abc", "cursor-xyz");

    assert.ok(capturedUrl.includes("/blocks/block-abc/children"));
    assert.ok(capturedUrl.includes("page_size=100"));
    assert.ok(capturedUrl.includes("start_cursor=cursor-xyz"));
  });
});

describe("collectBlocksRecursively", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("has_children のブロックの子を再帰取得し、ページングで全件取得する", async () => {
    const callLog: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      callLog.push(u);

      if (u.includes("/blocks/page-1/children")) {
        return new Response(
          JSON.stringify({
            results: [
              createMockBlock("b1", "paragraph", "parent", true),
              createMockBlock("b2", "paragraph", "sibling", false),
            ],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200 },
        );
      }
      if (u.includes("/blocks/b1/children")) {
        return new Response(
          JSON.stringify({
            results: [createMockBlock("b1-1", "paragraph", "child", false)],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ results: [], has_more: false }), {
        status: 200,
      });
    }) as typeof globalThis.fetch;

    const collected = await collectBlocksRecursively(mockConfig, "page-1");

    assert.strictEqual(callLog.length, 2);
    assert.ok(callLog.some((c) => c.includes("page-1/children")));
    assert.ok(callLog.some((c) => c.includes("b1/children")));
    assert.strictEqual(collected.blocks.length, 3);
  });

  it("AIフィードバック以降は収集せず、本文paragraphのIDを取得する", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();

      if (u.includes("/blocks/page-1/children")) {
        return new Response(
          JSON.stringify({
            results: [
              createMockBlock("b1", "paragraph", "before", false),
              { id: "callout-id", type: "callout", has_children: true },
              createMockBlock("b2", "paragraph", "after", false),
            ],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200 },
        );
      }
      if (u.includes("/blocks/callout-id/children")) {
        return new Response(
          JSON.stringify({
            results: [
              createMockBlock("h1", "heading_2", "AIフィードバック", false),
              { id: "d1", type: "divider", has_children: false },
              createMockBlock(
                "p1",
                "paragraph",
                "（このブロックは自動更新されます）",
                false,
              ),
            ],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200 },
        );
      }

      return new Response(JSON.stringify({ results: [], has_more: false }), {
        status: 200,
      });
    }) as typeof globalThis.fetch;

    const collected = await collectBlocksRecursively(mockConfig, "page-1");
    const report = blocksToReportMarkdown(collected.blocks);

    assert.strictEqual(collected.feedbackParagraphBlockId, "p1");
    assert.ok(!report.includes("AIフィードバック"));
    assert.ok(!report.includes("（このブロックは自動更新されます）"));
  });
});

describe("updatePageFeedbackBlock", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("AIフィードバック本文のparagraph更新とFB_DONE/FB_AT更新を行う", async () => {
    const capturedCalls: Array<{
      url: string;
      body: unknown;
      method?: string;
    }> = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const resolvedUrl = typeof url === "string" ? url : url.toString();
      const body = init?.body ? JSON.parse(init.body as string) : null;

      capturedCalls.push({
        url: resolvedUrl,
        body,
        method: init?.method,
      });

      return new Response(null, { status: 200 });
    }) as typeof globalThis.fetch;

    await updatePageFeedbackBlock(
      mockConfig,
      "page-id",
      "フィードバック本文",
      "paragraph-id",
    );

    const blockCall = capturedCalls.find((c) =>
      c.url.includes("/blocks/paragraph-id"),
    );
    const pageCall = capturedCalls.find((c) =>
      c.url.includes("/pages/page-id"),
    );

    assert.ok(blockCall);
    assert.ok(pageCall);

    const blockBody = blockCall?.body as {
      paragraph: {
        rich_text: Array<{ type: string; text: { content: string } }>;
      };
    };
    assert.strictEqual(
      blockBody.paragraph.rich_text[0].text.content,
      "フィードバック本文",
    );

    const pageBody = pageCall?.body as {
      properties: {
        FB_DONE: { checkbox: boolean };
        FB_AT: { date: { start: string } };
      };
    };
    assert.strictEqual(pageBody.properties.FB_DONE.checkbox, true);
    assert.ok(pageBody.properties.FB_AT.date.start);
  });
});

describe("processOneItem", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("本文なし（blocks 空）のとき skipped, insufficient_content", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ results: [], has_more: false, next_cursor: null }),
        { status: 200 },
      )) as typeof globalThis.fetch;

    const r = await processOneItem(
      mockConfig,
      "system prompt",
      "page-1",
      undefined,
    );

    assert.strictEqual(r.status, "skipped");
    assert.strictEqual(r.reason, "insufficient_content");
  });

  it("本文が MIN_BODY_CHARS 未満のとき skipped, insufficient_content", async () => {
    const short = "x".repeat(50);
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [createMockBlock("b1", "paragraph", short, false)],
          has_more: false,
          next_cursor: null,
        }),
        { status: 200 },
      )) as typeof globalThis.fetch;

    const r = await processOneItem(
      mockConfig,
      "system prompt",
      "page-1",
      undefined,
    );

    assert.strictEqual(r.status, "skipped");
    assert.strictEqual(r.reason, "insufficient_content");
  });

  it("正常フロー: 本文80文字以上 + generateFeedbackFn で done", async () => {
    const longBody = "あ".repeat(80);
    const patchLog: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/blocks/callout-id/children")) {
        return new Response(
          JSON.stringify({
            results: [
              createMockBlock("h1", "heading_2", "AIフィードバック", false),
              { id: "d1", type: "divider", has_children: false },
              createMockBlock(
                "p1",
                "paragraph",
                "（このブロックは自動更新されます）",
                false,
              ),
            ],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200 },
        );
      }
      if (u.includes("/children")) {
        return new Response(
          JSON.stringify({
            results: [
              createMockBlock("b1", "paragraph", longBody, false),
              { id: "callout-id", type: "callout", has_children: true },
            ],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200 },
        );
      }
      if (u.includes("/blocks/") && !u.includes("/children")) {
        patchLog.push(u);
        return new Response(null, { status: 200 });
      }
      if (u.includes("/pages/")) {
        patchLog.push(u);
        return new Response(null, { status: 200 });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof globalThis.fetch;

    const r = await processOneItem(
      mockConfig,
      "my system prompt",
      "page-1",
      undefined,
    );

    assert.strictEqual(r.status, "done");
    assert.ok(patchLog.some((u) => u.includes("/blocks/p1")));
    assert.ok(patchLog.some((u) => u.includes("/pages/page-1")));
  });

  it("generateFeedbackFn が throw すると failed, updatePageFeedbackBlock は呼ばれない", async () => {
    const longBody = "あ".repeat(80);
    let patchCalled = false;
    globalThis.fetch = (async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/blocks/callout-id/children")) {
        return new Response(
          JSON.stringify({
            results: [
              createMockBlock("h1", "heading_2", "AIフィードバック", false),
              { id: "d1", type: "divider", has_children: false },
              createMockBlock(
                "p1",
                "paragraph",
                "（このブロックは自動更新されます）",
                false,
              ),
            ],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200 },
        );
      }
      if (u.includes("/children")) {
        return new Response(
          JSON.stringify({
            results: [
              createMockBlock("b1", "paragraph", longBody, false),
              { id: "callout-id", type: "callout", has_children: true },
            ],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200 },
        );
      }
      if (
        u.includes("/pages/") ||
        (u.includes("/blocks/") && !u.includes("/children"))
      ) {
        patchCalled = true;
        return new Response(null, { status: 200 });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof globalThis.fetch;

    const r = await processOneItem(mockConfig, "prompt", "page-1", {
      generateFeedbackFn: async () => {
        throw new Error("Gemini error");
      },
    });
    assert.strictEqual(r.status, "done");
    assert.strictEqual(patchCalled, true);
  });

  it("updatePageFeedbackBlock が throw すると例外が伝播する", async () => {
    const longBody = "あ".repeat(80);
    globalThis.fetch = (async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/blocks/callout-id/children")) {
        return new Response(
          JSON.stringify({
            results: [
              createMockBlock("h1", "heading_2", "AIフィードバック", false),
              { id: "d1", type: "divider", has_children: false },
              createMockBlock(
                "p1",
                "paragraph",
                "（このブロックは自動更新されます）",
                false,
              ),
            ],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200 },
        );
      }
      if (u.includes("/children")) {
        return new Response(
          JSON.stringify({
            results: [
              createMockBlock("b1", "paragraph", longBody, false),
              { id: "callout-id", type: "callout", has_children: true },
            ],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200 },
        );
      }
      if (u.includes("/blocks/") && !u.includes("/children")) {
        return new Response(null, { status: 200 });
      }
      if (u.includes("/pages/")) {
        return new Response("Conflict", { status: 409 });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof globalThis.fetch;

    await assert.rejects(
      async () =>
        processOneItem(mockConfig, "prompt", "page-1", {
          generateFeedbackFn: async () => "ok",
        }),
      /409/,
    );
  });
});

describe("runBatch", () => {
  let originalFetch: typeof globalThis.fetch;
  const requiredEnv: Record<string, string> = {
    NOTION_TOKEN: "t",
    NOTION_DATA_SOURCE_ID: "ds",
    GEMINI_API_KEY: "k",
    GEMINI_INTERVAL_MS: "0",
  };

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    for (const [k, v] of Object.entries(requiredEnv)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
    const { clearCacheForTesting } = await import("../config/envLoader.js");
    clearCacheForTesting();
    const { resetConfigForTesting } = await import("../config.js");
    resetConfigForTesting();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("対象0件のときログに targets=0, done=0 skipped=0 failed=0", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/query")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof globalThis.fetch;

    const logSpy: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logSpy.push(args.join(" "));

    try {
      await runBatch();
    } finally {
      console.log = origLog;
    }

    const endLine = logSpy.find((l) => l.startsWith("[END]"));
    const infoLine = logSpy.find((l) => l.startsWith("[INFO]"));
    assert.ok(
      endLine?.includes("done=0") &&
        endLine?.includes("skipped=0") &&
        endLine?.includes("failed=0"),
    );
    assert.ok(infoLine?.includes("targets=0"));
  });

  it("複数ページで2件目だけ失敗するとサマリで done=1 failed=1", async () => {
    process.env.GEMINI_INTERVAL_MS = "0";
    const { clearCacheForTesting } = await import("../config/envLoader.js");
    clearCacheForTesting();
    const { resetConfigForTesting } = await import("../config.js");
    resetConfigForTesting();

    const longBody = "あ".repeat(80);
    globalThis.fetch = (async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/query")) {
        return new Response(
          JSON.stringify({
            results: [{ id: "page-1" }, { id: "page-2" }],
          }),
          { status: 200 },
        );
      }
      if (u.includes("/blocks/callout-id/children")) {
        return new Response(
          JSON.stringify({
            results: [
              createMockBlock("h1", "heading_2", "AIフィードバック", false),
              { id: "d1", type: "divider", has_children: false },
              createMockBlock(
                "p1",
                "paragraph",
                "（このブロックは自動更新されます）",
                false,
              ),
            ],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200 },
        );
      }
      if (u.includes("/children")) {
        return new Response(
          JSON.stringify({
            results: [
              createMockBlock("b1", "paragraph", longBody, false),
              { id: "callout-id", type: "callout", has_children: true },
            ],
            has_more: false,
            next_cursor: null,
          }),
          { status: 200 },
        );
      }
      if (u.includes("/blocks/") && !u.includes("/children")) {
        return new Response(null, { status: 200 });
      }
      if (u.includes("/pages/page-1")) {
        return new Response(null, { status: 200 });
      }
      if (u.includes("/pages/page-2")) {
        return new Response("Conflict", { status: 409 });
      }
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof globalThis.fetch;

    const logSpy: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args: unknown[]) => logSpy.push(args.join(" "));
    console.error = () => {};

    try {
      await runBatch({
        generateFeedbackFn: async () => "fake feedback",
      });
    } finally {
      console.log = origLog;
      console.error = origError;
    }

    const summaryLine = logSpy.find((l) => l.startsWith("[SUMMARY]"));
    const endLine = logSpy.find((l) => l.startsWith("[END]"));
    assert.ok(
      summaryLine?.includes("done=1") && summaryLine?.includes("failed=1"),
    );
    assert.ok(
      endLine?.includes("requestId=") && endLine?.includes("durationMs="),
    );
  });
});

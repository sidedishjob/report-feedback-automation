import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  toPlainText,
  blockToMarkdownLine,
  blocksToReportMarkdown,
  toNotionRichText,
  notionHeaders,
} from "./helpers.js";
import type { NotionBlock } from "../types/notion.js";
import type { Config } from "../types/common.js";

const mockConfig: Config = {
  notion: {
    token: "secret-token",
    dataSourceId: "ds-123",
    version: "2025-09-03",
  },
  gemini: {
    apiKey: "gemini-key",
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

describe("toPlainText", () => {
  it("配列でない場合は空文字を返す", () => {
    assert.strictEqual(toPlainText(null), "");
    assert.strictEqual(toPlainText(undefined), "");
    assert.strictEqual(toPlainText("string"), "");
    assert.strictEqual(toPlainText(123), "");
  });

  it("各要素の plain_text を連結して返す", () => {
    assert.strictEqual(
      toPlainText([
        { plain_text: "Hello" },
        { plain_text: " " },
        { plain_text: "World" },
      ]),
      "Hello World",
    );
  });

  it("plain_text が無い要素は空文字として扱う", () => {
    assert.strictEqual(
      toPlainText([{ plain_text: "a" }, {}, { plain_text: "b" }]),
      "ab",
    );
  });
});

describe("blockToMarkdownLine", () => {
  it("heading_1 を # に変換する", () => {
    const block: NotionBlock = {
      id: "1",
      type: "heading_1",
      has_children: false,
      heading_1: { rich_text: [{ plain_text: "見出し1" }] },
    };
    assert.strictEqual(blockToMarkdownLine(block), "# 見出し1");
  });

  it("heading_2 を ## に変換する", () => {
    const block: NotionBlock = {
      id: "2",
      type: "heading_2",
      has_children: false,
      heading_2: { rich_text: [{ plain_text: "見出し2" }] },
    };
    assert.strictEqual(blockToMarkdownLine(block), "## 見出し2");
  });

  it("heading_3 を ### に変換する", () => {
    const block: NotionBlock = {
      id: "3",
      type: "heading_3",
      has_children: false,
      heading_3: { rich_text: [{ plain_text: "見出し3" }] },
    };
    assert.strictEqual(blockToMarkdownLine(block), "### 見出し3");
  });

  it("divider を --- に変換する", () => {
    const block: NotionBlock = {
      id: "4",
      type: "divider",
      has_children: false,
    };
    assert.strictEqual(blockToMarkdownLine(block), "---");
  });

  it("bulleted_list_item を - に変換する", () => {
    const block: NotionBlock = {
      id: "5",
      type: "bulleted_list_item",
      has_children: false,
      bulleted_list_item: { rich_text: [{ plain_text: "項目" }] },
    };
    assert.strictEqual(blockToMarkdownLine(block), "- 項目");
  });

  it("bulleted_list_item でテキストが空の場合は空文字", () => {
    const block: NotionBlock = {
      id: "5b",
      type: "bulleted_list_item",
      has_children: false,
      bulleted_list_item: { rich_text: [] },
    };
    assert.strictEqual(blockToMarkdownLine(block), "");
  });

  it("paragraph はプレーンテキストのまま", () => {
    const block: NotionBlock = {
      id: "6",
      type: "paragraph",
      has_children: false,
      paragraph: { rich_text: [{ plain_text: "本文" }] },
    };
    assert.strictEqual(blockToMarkdownLine(block), "本文");
  });

  it("paragraph で空の場合は空文字", () => {
    const block: NotionBlock = {
      id: "6b",
      type: "paragraph",
      has_children: false,
      paragraph: { rich_text: [] },
    };
    assert.strictEqual(blockToMarkdownLine(block), "");
  });

  it("callout を ## に変換する", () => {
    const block: NotionBlock = {
      id: "7",
      type: "callout",
      has_children: false,
      callout: { rich_text: [{ plain_text: "補足" }] },
    };
    assert.strictEqual(blockToMarkdownLine(block), "## 補足");
  });

  it("callout でテキストが空の場合は空文字", () => {
    const block: NotionBlock = {
      id: "7b",
      type: "callout",
      has_children: false,
      callout: { rich_text: [] },
    };
    assert.strictEqual(blockToMarkdownLine(block), "");
  });

  it("未対応の type は空文字", () => {
    const block: NotionBlock = {
      id: "8",
      type: "unsupported_type",
      has_children: false,
    };
    assert.strictEqual(blockToMarkdownLine(block), "");
  });
});

describe("blocksToReportMarkdown", () => {
  it("ブロック配列を1本のMarkdownに連結する", () => {
    const blocks: NotionBlock[] = [
      {
        id: "1",
        type: "heading_2",
        has_children: false,
        heading_2: { rich_text: [{ plain_text: "業務内容" }] },
      },
      {
        id: "2",
        type: "paragraph",
        has_children: false,
        paragraph: { rich_text: [{ plain_text: "タスクAを実施" }] },
      },
    ];
    assert.strictEqual(
      blocksToReportMarkdown(blocks),
      "## 業務内容\nタスクAを実施",
    );
  });

  it("空のブロックはスキップされ連続改行3つ以上は詰める", () => {
    const blocks: NotionBlock[] = [
      {
        id: "1",
        type: "paragraph",
        has_children: false,
        paragraph: { rich_text: [{ plain_text: "A" }] },
      },
      {
        id: "2",
        type: "paragraph",
        has_children: false,
        paragraph: { rich_text: [] },
      },
      {
        id: "3",
        type: "paragraph",
        has_children: false,
        paragraph: { rich_text: [{ plain_text: "B" }] },
      },
    ];
    const result = blocksToReportMarkdown(blocks);
    assert.ok(!/\n\n\n/.test(result), "3つ以上の連続改行は含まない");
    assert.strictEqual(result, "A\nB");
  });

  it("前後を trim する", () => {
    const blocks: NotionBlock[] = [
      {
        id: "1",
        type: "paragraph",
        has_children: false,
        paragraph: { rich_text: [{ plain_text: "  only  " }] },
      },
    ];
    assert.strictEqual(blocksToReportMarkdown(blocks), "only");
  });

  it("空のブロック配列は空文字", () => {
    assert.strictEqual(blocksToReportMarkdown([]), "");
  });
});

describe("toNotionRichText", () => {
  it("空文字は空配列を返す", () => {
    assert.deepStrictEqual(toNotionRichText(""), []);
  });

  it("limit 以下の文字列は1要素で返す", () => {
    const short = "短いテキスト";
    const result = toNotionRichText(short, 1990, 100);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, "text");
    assert.strictEqual(result[0].text.content, short);
  });

  it("limit を超えると分割する（1要素あたり limit 文字目安）", () => {
    const long = "x".repeat(3000);
    const result = toNotionRichText(long, 1000, 100);
    assert.ok(result.length >= 2);
    for (const r of result) {
      assert.ok(r.text.content.length <= 1001);
    }
  });

  it("改行が後ろ60%以降にある場合は改行で切る", () => {
    const limit = 100;
    const text = "a".repeat(50) + "\n" + "b".repeat(30) + "\n" + "c".repeat(30);
    const result = toNotionRichText(text, limit, 100);
    assert.ok(result.length >= 2);
    const first = result[0].text.content;
    assert.ok(first.length <= limit);
    if (first.includes("\n")) {
      assert.ok(first.length > limit * 0.6);
    }
  });

  it("maxChunks 超過時は末尾に注記を付与する", () => {
    const long = "x".repeat(200);
    const result = toNotionRichText(long, 10, 3);
    assert.strictEqual(result.length, 3);
    const last = result[result.length - 1].text.content;
    assert.ok(
      last.includes("…（文字数制限のため一部省略）"),
      `last chunk should contain note, got: ${last}`,
    );
  });
});

describe("notionHeaders", () => {
  it("Config から Notion 用ヘッダを生成する", () => {
    const headers = notionHeaders(mockConfig);
    assert.strictEqual(headers.Authorization, "Bearer secret-token");
    assert.strictEqual(headers["Notion-Version"], "2025-09-03");
    assert.strictEqual(headers["Content-Type"], "application/json");
  });
});

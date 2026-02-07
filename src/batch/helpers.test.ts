import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  toPlainText,
  blockToMarkdownLine,
  blocksToReportMarkdown,
  markdownToNotionBlocks,
  toNotionRichText,
  notionHeaders,
} from "./helpers.js";
import type {
  NotionBlock,
  NotionWriteBlock,
  NotionWriteBulletedListItemBlock,
} from "../types/notion.js";
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

const flattenWriteBlocks = (blocks: NotionWriteBlock[]): NotionWriteBlock[] => {
  const all: NotionWriteBlock[] = [];

  const visit = (node: NotionWriteBlock): void => {
    all.push(node);
    if (node.type === "bulleted_list_item" && node.children) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };

  for (const block of blocks) {
    visit(block);
  }
  return all;
};

describe("markdownToNotionBlocks", () => {
  const fullSample = `
### 1. 今日の良かった点

-   **早期に「聞くことの重要性」を再認識できたこと**
    -   「聞かないと進まないことに板挟みだった」と感じつつも、「やっぱり誰かに頼ることは大切だと感じた（早い段階で）」と、行動の重要性を素直に受け止められたのは素晴らしいね。早めに問題を共有する姿勢は、手戻りを減らし、結果的にチーム全体の生産性向上につながるよ。
-   **チームリーダーの視点に立って物事を考えられたこと**
    -   上位からの指示で作業が変更になるリーダーの苦悩や、それによってメンバーに発生する手間まで想像できたのは、非常に良い視点だね。将来自分がリーダーになった時に活かせる貴重な経験になるはずだよ。

### 2. 改善・深掘りポイント

-   **設計書と実装のギャップへの具体的な対処**
    -   「設計書を読んでも実装方法がわからず詰まってしまい」「設計書自体も間違っているという話もあり、設計書が間違っているのか自分の理解が間違っているのか判別ができない状態」というのは、よくあることだけど、この状態での製造はリスクが高いよ。
        -   **改善案:** 不明点や矛盾点を具体的にリストアップし、質問事項として整理しよう。口頭で聞くだけでなく、可能であれば「〜という理解で合っていますか？」「〜の部分は設計書と異なりますが、どちらが正しいですか？」といった形で、具体的な比較や提案を含めて質問すると、相手も回答しやすくなるし、認識齟齬も減らせるよ。
-   **忙しいメンバーへの効果的な質問術**
    -   「他のメンバーも忙しそうにしていて聞きづらい」という気持ちはよくわかる。でも、聞かないと進まないのも事実だよね。
        -   **改善案:** 質問する際は、事前に自分の理解と不明点を整理し、質問内容を簡潔にまとめてみよう。「〇〇の機能について、△△の部分で詰まっています。設計書にはAとありますが、Bの可能性もありますか？」のように、具体的なポイントを絞って聞くことで、相手も短時間で的確なアドバイスがしやすくなるよ。また、チャットツールなどで「〇〇について、少しお時間いただけますか？」とアポイントを取るのも有効な場合があるね。
-   **【本日の教訓】不確実な状況での「確認と記録」の徹底**
    -   設計書に不備があったり、ドメイン知識が不足している状況では、「自分の理解が正しいか」を常に疑い、**「確認」**と**「記録」**を徹底することが重要だよ。不明点を明確にし、質問し、得られた回答や判断結果を必ずどこかに記録しておこう。これにより、後からの手戻りを防ぎ、チーム内の知見として蓄積できるだけでなく、万が一問題が発生した際の原因究明にも役立つ。

### 3. 明日やること

-   **[高] イベント機能製造（1本目）に関する不明点・疑問点をリストアップし、質問事項として整理する**
-   **[中] 整理した質問事項を元に、適切なタイミングで知見のあるメンバーへ相談・確認を行う**
-   **[低] 回答や新たな知見を得た上で、実装可能な範囲からイベント機能製造を進める**

### 4. 思考を深める質問

-   今回のように設計書に不備があったり、ドメイン知識が不足している状況で、あなたは「品質」と「スピード」のどちらを優先し、どのようにバランスを取ることを目指しますか？その理由も教えてください。
-   チーム全体として、設計書の品質向上やドメイン知識の共有を促進するために、メンバーとして何か提案できることはないでしょうか？

### 5. 一言まとめ
不明点を早期に洗い出し、確認と記録を徹底することで、不確実な状況でも着実に前進できる。
`.trim();

  it("フルサンプルを見出し・箇条書き・太字付きのNotionブロックへ変換する", () => {
    const blocks = markdownToNotionBlocks(fullSample);
    const all = flattenWriteBlocks(blocks);

    const heading3Count = all.filter((b) => b.type === "heading_3").length;
    assert.strictEqual(heading3Count, 5);

    const topBullet = blocks.find(
      (b) =>
        b.type === "bulleted_list_item" &&
        b.bulleted_list_item.rich_text.some((rt) =>
          rt.text.content.includes("早期に「聞くことの重要性」"),
        ),
    ) as NotionWriteBulletedListItemBlock | undefined;
    assert.ok(topBullet, "トップレベルの箇条書きが存在する");
    assert.ok(topBullet?.children && topBullet.children.length > 0);

    const topBulletFirstRichText = topBullet?.bulleted_list_item.rich_text[0];
    assert.strictEqual(topBulletFirstRichText?.annotations?.bold, true);

    const improvementBullet = all.find(
      (b) =>
        b.type === "bulleted_list_item" &&
        b.bulleted_list_item.rich_text.some((rt) =>
          rt.text.content.includes("設計書に不備があったり"),
        ),
    ) as NotionWriteBulletedListItemBlock | undefined;
    assert.ok(improvementBullet, "「確認/記録」行が変換されている");

    const boldPieces =
      improvementBullet?.bulleted_list_item.rich_text.filter(
        (rt) => rt.annotations?.bold,
      ) || [];
    assert.ok(boldPieces.length >= 2, "「確認」と「記録」が太字で保持される");
  });

  it("未対応記法はparagraphへフォールバックする", () => {
    const blocks = markdownToNotionBlocks(
      "1. 番号付き\n```ts\nconst a = 1;\n```",
    );
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, "paragraph");
    if (blocks[0].type !== "paragraph") return;
    const paragraphText = blocks[0].paragraph.rich_text
      .map((rt) => rt.text.content)
      .join("");
    assert.ok(paragraphText.includes("1. 番号付き"));
    assert.ok(paragraphText.includes("```ts"));
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

import type { Config } from "../types/common.js";
import type {
  NotionBlock,
  NotionHeaders,
  NotionWriteBlock,
  NotionWriteBulletedListItemBlock,
  NotionWriteRichText,
} from "../types/notion.js";

export const notionHeaders = (config: Config): NotionHeaders => ({
  Authorization: `Bearer ${config.notion.token}`,
  "Notion-Version": config.notion.version,
  "Content-Type": "application/json",
});

export const toPlainText = (richTextArray: unknown): string => {
  if (!Array.isArray(richTextArray)) return "";
  return richTextArray
    .map((rt: { plain_text?: string }) => rt?.plain_text || "")
    .join("");
};

export const blockToMarkdownLine = (block: NotionBlock): string => {
  const type = block.type;

  if (type === "heading_1")
    return `# ${toPlainText(block.heading_1?.rich_text)}`.trim();
  if (type === "heading_2")
    return `## ${toPlainText(block.heading_2?.rich_text)}`.trim();
  if (type === "heading_3")
    return `### ${toPlainText(block.heading_3?.rich_text)}`.trim();

  if (type === "divider") return "---";

  if (type === "bulleted_list_item") {
    const text = toPlainText(block.bulleted_list_item?.rich_text).trim();
    return text ? `- ${text}` : "";
  }

  if (type === "paragraph") {
    const text = toPlainText(block.paragraph?.rich_text).trim();
    return text || "";
  }

  if (type === "callout") {
    const text = toPlainText(block.callout?.rich_text).trim();
    return text ? `## ${text}` : "";
  }

  return "";
};

export const blocksToReportMarkdown = (blocks: NotionBlock[]): string => {
  const lines: string[] = [];

  for (const b of blocks) {
    const line = blockToMarkdownLine(b);
    if (!line) continue;
    lines.push(line);
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const pushRichText = (
  out: NotionWriteRichText[],
  content: string,
  bold = false,
  limit = 1990,
): void => {
  if (!content) return;

  let rest = content;
  while (rest.length > 0) {
    const chunk = rest.slice(0, limit);
    out.push({
      type: "text",
      text: { content: chunk },
      ...(bold ? { annotations: { bold: true } } : {}),
    });
    rest = rest.slice(chunk.length);
  }
};

const parseInlineBold = (text: string): NotionWriteRichText[] => {
  if (!text) return [];

  const richTexts: NotionWriteRichText[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let cursor = 0;

  for (;;) {
    const match = re.exec(text);
    if (!match) break;

    const plain = text.slice(cursor, match.index);
    pushRichText(richTexts, plain, false);

    const bold = match[1] || "";
    pushRichText(richTexts, bold, true);

    cursor = match.index + match[0].length;
  }

  const tail = text.slice(cursor);
  pushRichText(richTexts, tail, false);
  return richTexts;
};

const toHeadingBlock = (level: number, text: string): NotionWriteBlock => {
  const richText = parseInlineBold(text.trim());

  if (level === 1) {
    return {
      object: "block",
      type: "heading_1",
      heading_1: { rich_text: richText },
    };
  }

  if (level === 2) {
    return {
      object: "block",
      type: "heading_2",
      heading_2: { rich_text: richText },
    };
  }

  return {
    object: "block",
    type: "heading_3",
    heading_3: { rich_text: richText },
  };
};

const toParagraphBlock = (text: string): NotionWriteBlock => ({
  object: "block",
  type: "paragraph",
  paragraph: {
    rich_text: parseInlineBold(text),
  },
});

export const markdownToNotionBlocks = (
  markdown: string,
): NotionWriteBlock[] => {
  if (!markdown?.trim()) return [];

  const blocks: NotionWriteBlock[] = [];
  const listStack: NotionWriteBulletedListItemBlock[] = [];
  const paragraphLines: string[] = [];

  const flushParagraph = (): void => {
    if (paragraphLines.length === 0) return;

    const text = paragraphLines.join("\n").trim();
    paragraphLines.length = 0;
    if (!text) return;
    blocks.push(toParagraphBlock(text));
  };

  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "    ");
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      listStack.length = 0;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      listStack.length = 0;
      blocks.push(
        toHeadingBlock(headingMatch[1].length, (headingMatch[2] || "").trim()),
      );
      continue;
    }

    const listMatch = line.match(/^(\s*)-\s+(.*)$/);
    if (listMatch) {
      flushParagraph();

      const indentSpaces = (listMatch[1] || "").length;
      const level = Math.floor(indentSpaces / 4);
      const text = (listMatch[2] || "").trim();
      if (!text) {
        listStack.length = level;
        continue;
      }

      const listItem: NotionWriteBulletedListItemBlock = {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: parseInlineBold(text),
        },
      };

      if (level === 0 || !listStack[level - 1]) {
        blocks.push(listItem);
      } else {
        const parent = listStack[level - 1];
        if (!parent.children) parent.children = [];
        parent.children.push(listItem);
      }

      listStack[level] = listItem;
      listStack.length = level + 1;
      continue;
    }

    listStack.length = 0;
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  return blocks;
};

/**
 * Notionのrich_textは「1要素あたりcontent最大2000文字」制限があるため、
 * 文字列をlimit未満で分割してrich_text配列へ変換する。
 *
 * - limit: 安全マージン込みで1990
 * - maxChunks: Notionのrich_text要素上限(一般に100)を超えないように制御
 */
export const toNotionRichText = (
  input: string,
  limit = 1990,
  maxChunks = 100,
): NotionWriteRichText[] => {
  if (!input) {
    return [];
  }

  const chunks: string[] = [];
  let rest = input;

  while (rest.length > 0 && chunks.length < maxChunks) {
    if (rest.length <= limit) {
      chunks.push(rest);
      break;
    }

    // できるだけ改行で切る（読みやすさ優先）
    const slice = rest.slice(0, limit);
    const lastNewline = slice.lastIndexOf("\n");

    // 改行が「そこそこ後ろ」にあるなら改行で切る（前半すぎる改行は無視してlimitで切る）
    const cutIndex =
      lastNewline > Math.floor(limit * 0.6) ? lastNewline + 1 : limit;

    chunks.push(rest.slice(0, cutIndex));
    rest = rest.slice(cutIndex);
  }

  // まだ残っている＝要素上限に達したので末尾に注記だけ追加（これ以上は保存できないため）
  if (rest.length > 0 && chunks.length >= maxChunks) {
    const note = "…（文字数制限のため一部省略）";
    const lastIndex = chunks.length - 1;
    const last = chunks[lastIndex] ?? "";
    const space = last.endsWith("\n") ? "" : "\n";
    const merged = `${last}${space}${note}`;

    chunks[lastIndex] = merged.length <= limit ? merged : note;
  }

  return chunks.map((content) => ({
    type: "text",
    text: { content },
  }));
};

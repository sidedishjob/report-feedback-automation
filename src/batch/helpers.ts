import type { Config } from "../types/common.js";
import type { NotionBlock, NotionHeaders } from "../types/notion.js";

export type NotionWriteRichText = {
  type: "text";
  text: { content: string };
};

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

import { GoogleGenerativeAI } from "@google/generative-ai";
import { getConfig } from "../config.js";
import { loadPrompt } from "../prompt/loadPrompt.js";
import {
  blocksToReportMarkdown,
  markdownToNotionBlocks,
  notionHeaders,
} from "./helpers.js";
import type {
  NotionAppendChildrenBody,
  NotionArchiveBlockBody,
  NotionBlock,
  NotionBlocksResponse,
  NotionQueryResponse,
  NotionUpdatePageBody,
} from "../types/notion.js";
import type { ProcessResult } from "../types/common.js";
import type { Config } from "../types/common.js";

/**
 * =====================================================================
 * Constants / Types
 * =====================================================================
 */

const NOTION_API_BASE = "https://api.notion.com/v1";

interface FetchError extends Error {
  status?: number;
  body?: unknown;
}

type CollectedBlocks = {
  blocks: NotionBlock[];
  feedbackContainerBlockId: string | null;
  feedbackDividerBlockId: string | null;
  feedbackContentBlockIds: string[];
};

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const fetchJson = async <T = unknown>(
  url: string,
  options: RequestInit,
): Promise<T> => {
  const res = await fetch(url, options);
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const msg = `HTTP ${res.status} ${res.statusText} - ${url}\n${text}`;
    const err = new Error(msg) as FetchError;
    err.status = res.status;
    err.body = json;
    throw err;
  }

  return json as T;
};

/**
 * =====================================================================
 * Core (Notion API / Gemini / Orchestration)
 *  - ここが「処理本体」
 * =====================================================================
 */

export const queryTargetPageIds = async (config: Config): Promise<string[]> => {
  const body = {
    filter: {
      and: [
        { property: "FB_READY", checkbox: { equals: true } },
        { property: "FB_DONE", checkbox: { equals: false } },
      ],
    },
    page_size: config.batch.maxItemsPerRun,
  };

  const json = await fetchJson<NotionQueryResponse>(
    `${NOTION_API_BASE}/data_sources/${config.notion.dataSourceId}/query`,
    {
      method: "POST",
      headers: notionHeaders(config),
      body: JSON.stringify(body),
    },
  );

  const results = json.results || [];
  return results.map((r) => r.id);
};

export const listBlockChildren = async (
  config: Config,
  blockId: string,
  startCursor: string | null = null,
): Promise<NotionBlocksResponse> => {
  const params = new URLSearchParams();
  params.set("page_size", "100");
  if (startCursor) params.set("start_cursor", startCursor);

  return await fetchJson<NotionBlocksResponse>(
    `${NOTION_API_BASE}/blocks/${blockId}/children?${params.toString()}`,
    {
      method: "GET",
      headers: notionHeaders(config),
    },
  );
};

const extractBlockText = (block: NotionBlock): string => {
  const richText =
    block.heading_1?.rich_text ||
    block.heading_2?.rich_text ||
    block.heading_3?.rich_text ||
    block.paragraph?.rich_text ||
    block.bulleted_list_item?.rich_text ||
    block.callout?.rich_text ||
    [];

  return richText.map((t) => t.plain_text || t.text?.content || "").join("");
};

export const collectBlocksRecursively = async (
  config: Config,
  rootBlockId: string,
): Promise<CollectedBlocks> => {
  const collected: NotionBlock[] = [];

  let feedbackContainerBlockId: string | null = null;
  let feedbackDividerBlockId: string | null = null;
  const feedbackContentBlockIds: string[] = [];
  let stopCollecting = false;

  const walk = async (blockId: string): Promise<void> => {
    // 初回は cursor=undefined で1回目を取得する
    let cursor: string | null | undefined = undefined;
    let mode: "collect" | "seek_divider" | "collect_feedback_content" =
      "collect";

    while (cursor !== null && !stopCollecting) {
      const json = await listBlockChildren(config, blockId, cursor);
      const results = json.results || [];

      for (const b of results) {
        if (stopCollecting) break;
        if (mode === "collect") {
          if (
            b.type === "heading_2" &&
            extractBlockText(b) === "AIフィードバック"
          ) {
            feedbackContainerBlockId = blockId;
            mode = "seek_divider";
            continue;
          }

          collected.push(b);

          if (b.has_children) {
            // Notionのレート軽減（約3 req/sec目安）
            await sleep(250);
            await walk(b.id);
          }
          continue;
        }

        if (mode === "seek_divider") {
          if (b.type === "divider") {
            feedbackDividerBlockId = b.id;
            mode = "collect_feedback_content";
          }
          continue;
        }

        if (mode === "collect_feedback_content") {
          feedbackContentBlockIds.push(b.id);
          continue;
        }
      }

      cursor = json.has_more ? json.next_cursor : null;

      if (cursor && !stopCollecting) {
        await sleep(250);
      }
    }

    if (!stopCollecting && mode !== "collect") {
      stopCollecting = true;
    }
  };

  await walk(rootBlockId);
  return {
    blocks: collected,
    feedbackContainerBlockId,
    feedbackDividerBlockId,
    feedbackContentBlockIds,
  };
};

export const generateFeedback = async (
  config: Config,
  systemPrompt: string,
  reportMarkdown: string,
): Promise<string> => {
  const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  const model = genAI.getGenerativeModel({
    model: config.gemini.model,
    systemInstruction: systemPrompt,
  });

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `日報本文:\n${reportMarkdown}\n\n` +
              `補足:\n` +
              `- この日報はNotionから抽出したblocksをMarkdown風に整形したものです。\n` +
              `- 見出しや箇条書きの構造を尊重し、文脈を読み取ってください。\n`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
    },
  });

  return result.response.text();
};

export const updatePageFeedbackBlock = async (
  config: Config,
  pageId: string,
  feedback: string,
  feedbackContainerBlockId: string,
  feedbackContentBlockIds: string[],
): Promise<void> => {
  for (const blockId of feedbackContentBlockIds) {
    const body: NotionArchiveBlockBody = { archived: true };
    await fetchJson(`${NOTION_API_BASE}/blocks/${blockId}`, {
      method: "PATCH",
      headers: notionHeaders(config),
      body: JSON.stringify(body),
    });
  }

  const notionBlocks = markdownToNotionBlocks(feedback);
  for (let i = 0; i < notionBlocks.length; i += 100) {
    const chunk = notionBlocks.slice(i, i + 100);
    const body: NotionAppendChildrenBody = { children: chunk };
    await fetchJson(
      `${NOTION_API_BASE}/blocks/${feedbackContainerBlockId}/children`,
      {
        method: "PATCH",
        headers: notionHeaders(config),
        body: JSON.stringify(body),
      },
    );
  }

  const now = new Date().toISOString();

  const body: NotionUpdatePageBody = {
    properties: {
      FB_DONE: { checkbox: true },
      FB_AT: { date: { start: now } },
    },
  };

  await fetchJson(`${NOTION_API_BASE}/pages/${pageId}`, {
    method: "PATCH",
    headers: notionHeaders(config),
    body: JSON.stringify(body),
  });
};

export interface ProcessOneItemOverrides {
  generateFeedbackFn?: (
    config: Config,
    systemPrompt: string,
    reportMarkdown: string,
  ) => Promise<string>;
}

export const processOneItem = async (
  config: Config,
  systemPrompt: string,
  pageId: string,
  overrides?: ProcessOneItemOverrides,
): Promise<ProcessResult> => {
  // blocks収集 → Markdown整形
  const collected = await collectBlocksRecursively(config, pageId);
  const reportMarkdown = blocksToReportMarkdown(collected.blocks);

  if (!reportMarkdown) {
    return { pageId, status: "skipped", reason: "insufficient_content" };
  }
  console.debug(`[DEBUG] reportMarkdownの文字数:\n${reportMarkdown.length}\n`);

  if (reportMarkdown.length < config.batch.minBodyChars) {
    return { pageId, status: "skipped", reason: "insufficient_content" };
  }

  if (config.batch.debug) {
    console.debug(
      `[DEBUG] ReportMarkdown (pageId=${pageId}):\n${reportMarkdown}\n`,
    );
  }

  // Gemini生成（テスト用に差し替え可能）
  const feedback = overrides?.generateFeedbackFn
    ? await overrides.generateFeedbackFn(config, systemPrompt, reportMarkdown)
    : await generateFeedback(config, systemPrompt, reportMarkdown);

  if (config.batch.debug) {
    console.debug(`[DEBUG] FeedBack (pageId=${pageId}):\n${feedback}\n`);
  }

  if (
    !collected.feedbackContainerBlockId ||
    !collected.feedbackDividerBlockId
  ) {
    throw new Error(
      `AIフィードバックの見出しまたはdividerが見つかりません pageId=${pageId}`,
    );
  }

  // Notionへ保存（AIフィードバック本文 / FB_DONE / FB_AT）
  await updatePageFeedbackBlock(
    config,
    pageId,
    feedback,
    collected.feedbackContainerBlockId,
    collected.feedbackContentBlockIds,
  );

  return { pageId, status: "done" };
};

export interface RunBatchOverrides {
  generateFeedbackFn?: (
    config: Config,
    systemPrompt: string,
    reportMarkdown: string,
  ) => Promise<string>;
}

export const runBatch = async (
  overrides?: RunBatchOverrides,
): Promise<void> => {
  const startTime = Date.now();
  const requestId =
    process.env.AWS_REQUEST_ID ||
    process.env.AWS_LAMBDA_LOG_STREAM_NAME ||
    "local";

  console.log(`[START] requestId=${requestId} ts=${new Date().toISOString()}`);

  // 設定を取得（SSMまたは環境変数から）
  const config = await getConfig();

  const pageIds = await queryTargetPageIds(config);

  console.log(`[INFO] requestId=${requestId} targets=${pageIds.length}`);

  if (pageIds.length === 0) {
    console.log(
      `[END] requestId=${requestId} durationMs=${Date.now() - startTime} done=0 skipped=0 failed=0`,
    );
    return;
  }

  const systemPrompt = await loadPrompt();
  const results: ProcessResult[] = [];
  const itemOverrides = overrides?.generateFeedbackFn
    ? { generateFeedbackFn: overrides.generateFeedbackFn }
    : undefined;

  for (let i = 0; i < pageIds.length; i++) {
    const pageId = pageIds[i];
    const itemStart = Date.now();

    if (i > 0) {
      console.log(
        `[WAIT] geminiIntervalMs=${config.batch.geminiIntervalMs} pageId=${pageId}`,
      );
      await sleep(config.batch.geminiIntervalMs);
    }

    try {
      console.log(`[ITEM_START] ${i + 1}/${pageIds.length} pageId=${pageId}`);

      const r = await processOneItem(
        config,
        systemPrompt,
        pageId,
        itemOverrides,
      );
      results.push(r);

      console.log(
        `[ITEM_END] pageId=${pageId} status=${r.status}` +
          (r.reason ? ` reason=${r.reason}` : "") +
          ` durationMs=${Date.now() - itemStart}`,
      );
    } catch (e) {
      const error = e as Error;
      const message = error?.message || String(e);
      console.error(
        `[ITEM_FAIL] pageId=${pageId} durationMs=${Date.now() - itemStart}`,
      );
      console.error(message);

      results.push({ pageId, status: "failed", reason: "exception", message });
    }
  }

  const done = results.filter((r) => r.status === "done").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  console.log(`[SUMMARY] done=${done} skipped=${skipped} failed=${failed}`);
  console.log(
    `[END] requestId=${requestId} durationMs=${Date.now() - startTime}`,
  );
};

import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import { loadPrompt } from '../prompt/loadPrompt.js';
import type {
	NotionBlock,
	NotionBlocksResponse,
	NotionHeaders,
	NotionQueryResponse,
	NotionUpdatePageBody,
} from '../types/notion.js';
import type { ProcessResult } from '../types/common.js';

const NOTION_API_BASE = 'https://api.notion.com/v1';

const notionHeaders = (): NotionHeaders => ({
	Authorization: `Bearer ${config.notion.token}`,
	'Notion-Version': config.notion.version,
	'Content-Type': 'application/json',
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface FetchError extends Error {
	status?: number;
	body?: unknown;
}

const fetchJson = async <T = unknown>(url: string, options: RequestInit): Promise<T> => {
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

const queryTargetPageIds = async (): Promise<string[]> => {
	const body = {
		filter: {
			and: [
				{ property: 'FB_READY', checkbox: { equals: true } },
				{ property: 'FB_DONE', checkbox: { equals: false } },
			],
		},
		page_size: config.batch.maxItemsPerRun,
	};

	const json = await fetchJson<NotionQueryResponse>(
		`${NOTION_API_BASE}/data_sources/${config.notion.dataSourceId}/query`,
		{
			method: 'POST',
			headers: notionHeaders(),
			body: JSON.stringify(body),
		}
	);

	const results = json.results || [];
	return results.map((r) => r.id);
};

const listBlockChildren = async (
	blockId: string,
	startCursor: string | null = null
): Promise<NotionBlocksResponse> => {
	const params = new URLSearchParams();
	params.set('page_size', '100');
	if (startCursor) params.set('start_cursor', startCursor);

	return await fetchJson<NotionBlocksResponse>(
		`${NOTION_API_BASE}/blocks/${blockId}/children?${params.toString()}`,
		{
			method: 'GET',
			headers: notionHeaders(),
		}
	);
};

const collectBlocksRecursively = async (rootBlockId: string): Promise<NotionBlock[]> => {
	const collected: NotionBlock[] = [];

	const walk = async (blockId: string): Promise<void> => {
		let cursor: string | null = null;

		do {
			const json = await listBlockChildren(blockId, cursor);
			const results = json.results || [];

			for (const b of results) {
				collected.push(b);

				if (b.has_children) {
					// Notionのレート軽減（約3 req/sec目安）
					await sleep(250);
					await walk(b.id);
				}
			}

			cursor = json.has_more ? json.next_cursor : null;

			if (cursor) {
				await sleep(250);
			}
		} while (cursor);
	};

	await walk(rootBlockId);
	return collected;
};

const toPlainText = (richTextArray: unknown): string => {
	if (!Array.isArray(richTextArray)) return '';
	return richTextArray.map((rt: { plain_text?: string }) => rt?.plain_text || '').join('');
};

const blockToMarkdownLine = (block: NotionBlock): string => {
	const type = block.type;

	if (type === 'heading_1') return `# ${toPlainText(block.heading_1?.rich_text)}`.trim();
	if (type === 'heading_2') return `## ${toPlainText(block.heading_2?.rich_text)}`.trim();
	if (type === 'heading_3') return `### ${toPlainText(block.heading_3?.rich_text)}`.trim();

	if (type === 'divider') return '---';

	if (type === 'bulleted_list_item') {
		const text = toPlainText(block.bulleted_list_item?.rich_text).trim();
		return text ? `- ${text}` : '';
	}

	if (type === 'paragraph') {
		const text = toPlainText(block.paragraph?.rich_text).trim();
		return text || '';
	}

	if (type === 'callout') {
		const text = toPlainText(block.callout?.rich_text).trim();
		return text ? `## ${text}` : '';
	}

	return '';
};

const blocksToReportMarkdown = (blocks: NotionBlock[]): string => {
	const lines: string[] = [];

	for (const b of blocks) {
		const line = blockToMarkdownLine(b);
		if (!line) continue;
		lines.push(line);
	}

	return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const generateFeedback = async (systemPrompt: string, reportMarkdown: string): Promise<string> => {
	const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
	const model = genAI.getGenerativeModel({
		model: config.gemini.model,
		systemInstruction: systemPrompt,
	});

	const result = await model.generateContent({
		contents: [
			{
				role: 'user',
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

const updatePageProperties = async (pageId: string, feedback: string): Promise<void> => {
	const now = new Date().toISOString();

	const body: NotionUpdatePageBody = {
		properties: {
			GPT_FB: {
				rich_text: [
					{
						type: 'text',
						text: { content: feedback },
					},
				],
			},
			FB_DONE: { checkbox: true },
			FB_AT: { date: { start: now } },
		},
	};

	await fetchJson(`${NOTION_API_BASE}/pages/${pageId}`, {
		method: 'PATCH',
		headers: notionHeaders(),
		body: JSON.stringify(body),
	});
};

const processOneItem = async (systemPrompt: string, pageId: string): Promise<ProcessResult> => {
	// blocks収集 → Markdown整形
	const blocks = await collectBlocksRecursively(pageId);
	const reportMarkdown = blocksToReportMarkdown(blocks);

	if (!reportMarkdown) {
		return { pageId, status: 'skipped', reason: 'insufficient_content' };
	}

	if (reportMarkdown.length < config.batch.minBodyChars) {
		return { pageId, status: 'skipped', reason: 'insufficient_content' };
	}

	if (config.batch.debug) {
		console.log(`ReportMarkdown (pageId=${pageId}):\n${reportMarkdown}\n`);
	}

	// Gemini生成
	const feedback = await generateFeedback(systemPrompt, reportMarkdown);

	// Notionへ保存（GPT_FB / FB_DONE / FB_AT）
	await updatePageProperties(pageId, feedback);

	return { pageId, status: 'done' };
};

export const runBatch = async (): Promise<void> => {
	const startTime = Date.now();
	const requestId =
		process.env.AWS_REQUEST_ID ||
		process.env.AWS_LAMBDA_LOG_STREAM_NAME ||
		'local';

	console.log(`[START] requestId=${requestId} ts=${new Date().toISOString()}`);

	const pageIds = await queryTargetPageIds();

	console.log(`[INFO] requestId=${requestId} targets=${pageIds.length}`);

	if (pageIds.length === 0) {
		console.log(`[END] requestId=${requestId} durationMs=${Date.now() - startTime} done=0 skipped=0 failed=0`);
		return;
	}

	const systemPrompt = await loadPrompt();
	const results: ProcessResult[] = [];

	for (let i = 0; i < pageIds.length; i++) {
		const pageId = pageIds[i];
		const itemStart = Date.now();

		if (i > 0) {
			console.log(`[WAIT] geminiIntervalMs=${config.batch.geminiIntervalMs} pageId=${pageId}`);
			await sleep(config.batch.geminiIntervalMs);
		}

		try {
			console.log(`[ITEM_START] ${i + 1}/${pageIds.length} pageId=${pageId}`);

			const r = await processOneItem(systemPrompt, pageId);
			results.push(r);

			console.log(
				`[ITEM_END] pageId=${pageId} status=${r.status}` +
				(r.reason ? ` reason=${r.reason}` : '') +
				` durationMs=${Date.now() - itemStart}`
			);
		} catch (e) {
			const error = e as Error;
			const message = error?.message || String(e);
			console.error(`[ITEM_FAIL] pageId=${pageId} durationMs=${Date.now() - itemStart}`);
			console.error(message);

			results.push({ pageId, status: 'failed', reason: 'exception', message });
		}
	}

	const done = results.filter((r) => r.status === 'done').length;
	const failed = results.filter((r) => r.status === 'failed').length;
	const skipped = results.filter((r) => r.status === 'skipped').length;

	console.log(`[SUMMARY] done=${done} skipped=${skipped} failed=${failed}`);
	console.log(`[END] requestId=${requestId} durationMs=${Date.now() - startTime}`);
};

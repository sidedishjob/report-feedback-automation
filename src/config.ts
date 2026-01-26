import type { Config } from './types/common.js';

const required = (key: string): string => {
	const value = process.env[key];
	if (!value) {
		throw new Error(`Missing env: ${key}`);
	}
	return value;
};

const toInt = (value: string | undefined, fallback: number): number => {
	const parsed = Number.parseInt(value ?? '', 10);
	return Number.isFinite(parsed) ? parsed : fallback;
};

export const config: Config = {
	notion: {
		token: required('NOTION_TOKEN'),
		dataSourceId: required('NOTION_DATA_SOURCE_ID'),
		version: process.env.NOTION_VERSION || '2025-09-03',
	},
	gemini: {
		apiKey: required('GEMINI_API_KEY'),
		model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
	},
	batch: {
		// 設計書の用語に合わせて ITEM 統一（ITEM = 日報1件 = Notion Page）
		maxItemsPerRun: toInt(process.env.MAX_ITEMS_PER_RUN, 5),

		// 本文が短い日はGeminiに投げても薄くなりがちなので、最低文字数でスキップ
		minBodyChars: toInt(process.env.MIN_BODY_CHARS, 80),

		// Gemini 5 RPM 対応（安全側のデフォルト）
		geminiIntervalMs: toInt(process.env.GEMINI_INTERVAL_MS, 15_000),

		// プロンプト外部ファイル切替
		promptVersion: process.env.PROMPT_VERSION || 'v1.0',

		// デバッグ用途（必要なら env でON）
		debug: process.env.DEBUG === '1',
	},
};

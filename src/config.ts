import 'dotenv/config';
import type { Config } from './types/common.js';
import { getRequiredEnvValue, getEnvValue, preloadEnvValues } from './config/envLoader.js';

const toInt = (value: string | undefined, fallback: number): number => {
	const parsed = Number.parseInt(value ?? '', 10);
	return Number.isFinite(parsed) ? parsed : fallback;
};

// 設定を非同期で初期化する関数
let configPromise: Promise<Config> | null = null;

const initializeConfig = async (): Promise<Config> => {
	const keys = [
		'NOTION_TOKEN',
		'NOTION_DATA_SOURCE_ID',
		'NOTION_VERSION',
		'GEMINI_API_KEY',
		'GEMINI_MODEL',
		'MAX_ITEMS_PER_RUN',
		'MIN_BODY_CHARS',
		'GEMINI_INTERVAL_MS',
		'PROMPT_VERSION',
		'DEBUG',
	];

	// Lambdaならここで一括プリロード（SSM API 1回）
	await preloadEnvValues(keys);

	const [
		notionToken,
		notionDataSourceId,
		notionVersion,
		geminiApiKey,
		geminiModel,
		maxItemsPerRun,
		minBodyChars,
		geminiIntervalMs,
		promptVersion,
		debug,
	] = await Promise.all([
		getRequiredEnvValue('NOTION_TOKEN'),
		getRequiredEnvValue('NOTION_DATA_SOURCE_ID'),
		getEnvValue('NOTION_VERSION'),
		getRequiredEnvValue('GEMINI_API_KEY'),
		getEnvValue('GEMINI_MODEL'),
		getEnvValue('MAX_ITEMS_PER_RUN'),
		getEnvValue('MIN_BODY_CHARS'),
		getEnvValue('GEMINI_INTERVAL_MS'),
		getEnvValue('PROMPT_VERSION'),
		getEnvValue('DEBUG'),
	]);

	return {
		notion: {
			token: notionToken,
			dataSourceId: notionDataSourceId,
			version: notionVersion || '2025-09-03',
		},
		gemini: {
			apiKey: geminiApiKey,
			model: geminiModel || 'gemini-2.5-flash',
		},
		batch: {
			// 設計書の用語に合わせて ITEM 統一（ITEM = 日報1件 = Notion Page）
			maxItemsPerRun: toInt(maxItemsPerRun, 5),

			// 本文が短い日はGeminiに投げても薄くなりがちなので、最低文字数でスキップ
			minBodyChars: toInt(minBodyChars, 80),

			// Gemini 5 RPM 対応（安全側のデフォルト）
			geminiIntervalMs: toInt(geminiIntervalMs, 15_000),

			// プロンプト外部ファイル切替
			promptVersion: promptVersion || 'v1.0',

			// デバッグ用途（必要なら env でON）
			debug: debug === '1',
		},
	};
};

// 設定を取得（初回のみ初期化、以降はキャッシュ）
export const getConfig = async (): Promise<Config> => {
	if (!configPromise) {
		configPromise = initializeConfig();
	}
	return configPromise;
};

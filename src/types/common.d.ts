// 共通型定義

export interface ProcessResult {
	pageId: string;
	status: 'done' | 'skipped' | 'failed';
	reason?: 'insufficient_content' | 'exception';
	message?: string;
}

export interface Config {
	notion: {
		token: string;
		dataSourceId: string;
		version: string;
	};
	gemini: {
		apiKey: string;
		model: string;
	};
	batch: {
		maxItemsPerRun: number;
		minBodyChars: number;
		geminiIntervalMs: number;
		promptVersion: string;
		debug: boolean;
	};
}

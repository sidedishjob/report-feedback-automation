// Notion API の型定義

export type NotionHeaders = Record<string, string> & {
	Authorization: string;
	'Notion-Version': string;
	'Content-Type': string;
};


export interface NotionRichText {
	plain_text: string;
	type?: string;
	text?: {
		content: string;
	};
}

export interface NotionBlock {
	id: string;
	type: string;
	has_children: boolean;
	heading_1?: {
		rich_text: NotionRichText[];
	};
	heading_2?: {
		rich_text: NotionRichText[];
	};
	heading_3?: {
		rich_text: NotionRichText[];
	};
	paragraph?: {
		rich_text: NotionRichText[];
	};
	bulleted_list_item?: {
		rich_text: NotionRichText[];
	};
	callout?: {
		rich_text: NotionRichText[];
	};
}

export interface NotionQueryResponse {
	results: Array<{
		id: string;
	}>;
}

export interface NotionBlocksResponse {
	results: NotionBlock[];
	has_more: boolean;
	next_cursor: string | null;
}

export interface NotionPageProperties {
	GPT_FB: {
		rich_text: Array<{
			type: 'text';
			text: {
				content: string;
			};
		}>;
	};
	FB_DONE: {
		checkbox: boolean;
	};
	FB_AT: {
		date: {
			start: string;
		};
	};
}

export interface NotionUpdatePageBody {
	properties: NotionPageProperties;
}

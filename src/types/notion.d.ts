// Notion API の型定義

export type NotionHeaders = Record<string, string> & {
  Authorization: string;
  "Notion-Version": string;
  "Content-Type": string;
};

export interface NotionRichText {
  plain_text: string;
  type?: string;
  text?: {
    content: string;
  };
}

export interface NotionWriteRichText {
  type: "text";
  text: {
    content: string;
  };
  annotations?: {
    bold?: boolean;
  };
}

export interface NotionWriteHeading1Block {
  object: "block";
  type: "heading_1";
  heading_1: {
    rich_text: NotionWriteRichText[];
  };
}

export interface NotionWriteHeading2Block {
  object: "block";
  type: "heading_2";
  heading_2: {
    rich_text: NotionWriteRichText[];
  };
}

export interface NotionWriteHeading3Block {
  object: "block";
  type: "heading_3";
  heading_3: {
    rich_text: NotionWriteRichText[];
  };
}

export interface NotionWriteParagraphBlock {
  object: "block";
  type: "paragraph";
  paragraph: {
    rich_text: NotionWriteRichText[];
  };
}

export interface NotionWriteBulletedListItemBlock {
  object: "block";
  type: "bulleted_list_item";
  bulleted_list_item: {
    rich_text: NotionWriteRichText[];
  };
  children?: NotionWriteBlock[];
}

export interface NotionWriteDividerBlock {
  object: "block";
  type: "divider";
  divider: Record<string, never>;
}

export type NotionWriteBlock =
  | NotionWriteHeading1Block
  | NotionWriteHeading2Block
  | NotionWriteHeading3Block
  | NotionWriteParagraphBlock
  | NotionWriteBulletedListItemBlock
  | NotionWriteDividerBlock;

export interface NotionAppendChildrenBody {
  children: NotionWriteBlock[];
}

export interface NotionArchiveBlockBody {
  archived: boolean;
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

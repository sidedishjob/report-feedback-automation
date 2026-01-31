# Notion API 設計メモ

（1日報を取得する時のリクエスト回数と内容）

## 目的

Notion の日報DBから「フィードバック対象の日報1件」を取得し、本文（blocks）を抽出して AI 入力にするために、最低何回の Notion API リクエストが必要かと、どのエンドポイントを叩く想定かを明確化する。

本プロジェクトは Notion API の最新版仕様（Notion-Version: 2025-09-03）に準拠する。

---

## 前提（Notion 側の構造）

- 日報DB：Notion Database（Data Source を持つ）
- 日報1件：Notion Page（DBの1行）
- 本文：Page 配下の Blocks ツリー
- 日報本文は callout（Notionの aside）でセクション分割していることが多い
  - 例：業務内容 / 反省・気づき / 明日取り組むこと / 備考欄
- callout は has_children: true になることが多く、中身は子ブロックとして取得する必要がある

---

## 必須ヘッダ（共通）

全リクエストに必ず付与する。

Authorization: Bearer <NOTION_TOKEN>  
Notion-Version: 2025-09-03  
Content-Type: application/json（POST時）

---

## 1日報あたりの「最小」リクエスト回数

### 結論

- 最小：3回
- 通常：4〜6回（calloutが複数あるため）

実装はブロックツリーの再帰取得により、callout数に依存せず動作させる。

---

## リクエスト一覧（処理フロー）

### (1) 対象日報（page_id）取得：Data source query

POST /v1/data_sources/{data_source_id}/query

目的：FB対象のページ（page_id）を一覧取得

代表フィルタ例：

- FB_READY = true
- FB_DONE = false

「1日報」だけ処理するなら、results[0].id を対象 page_id として扱う。  
実運用では複数件返る可能性があるため、ページ単位でループ処理する。

---

### (2) ページ直下 blocks 取得

GET /v1/blocks/{page_id}/children?page_size=100

目的：ページ直下のブロック一覧を取得

ポイント：

- callout が複数出ることが多い
- has_children: true のブロックがある場合、次の (3) で子を取得する必要がある

---

### (3) 子ブロック取得（再帰）：blocks children

GET /v1/blocks/{block_id}/children?page_size=100

目的：has_children: true のブロックの子を取得

回数：

- calloutが4つある場合 → 追加で4回（＝通常 1日報あたり 5〜6回）
- さらにネスト（toggle、入れ子箇条書き等）があると追加発生

---

## まとめ：最小3回 / 通常4〜6回の理由

### 最小3回になるケース

- discovery 済み（data_source_id が手元にある）
- ページ直下にテキストブロックのみ（has_children=false）
- callout等の入れ子がない

(1) query → page_id取得  
(2) page children  
(3) なし（再帰不要）

---

### 通常4〜6回になるケース（今回の想定）

page直下に callout（has_children=true）が複数ある  
各calloutのchildrenを取得する必要がある

例（callout4つ）：

(1) query  
(2) page children  
(3) callout#1 children  
(4) callout#2 children  
(5) callout#3 children  
(6) callout#4 children

---

## テキスト抽出ルール（AI入力用）

取得した blocks を markdown 風に整形して AI（Gemini）に渡す。

対象 type と変換ルール：

- heading_1 → # {plain_text}
- heading_2 → ## {plain_text}
- heading_3 → ### {plain_text}
- divider → ---
- bulleted_list_item → - {plain_text}
- paragraph → {plain_text}（空は捨てる）
- callout → ## {plain_text}

文字列は rich_text[].plain_text を連結して生成する。

---

## 実装方針（重要：リクエスト回数を固定で数えない）

手動検証では callout数だけ API を叩く必要があるが、実装は以下で吸収する。

1. page_id の children を取得
2. has_children: true を検出したら、その block_id の children を再帰取得
3. 取得したブロックからテキストを抽出して蓄積

これにより「セクション数が増える / ネストが増える」変更にも強くなる。

---

## 備考（運用時の最適化）

- data_source_id は固定なので初回取得後は保存し、運用時の discovery を省略する
- Notion API のレート制限（約3req/sec）に合わせ、複数日報処理時は軽く待機を入れる（例：200〜400ms）
- has_more: true の場合は start_cursor でページング取得する（ページ本文が長い場合のみ）

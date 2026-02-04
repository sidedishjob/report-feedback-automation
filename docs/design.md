# バッチ仕様（Notion → Gemini → Notion）

## 1. 目的

Notionの日報（本文）を読み取り、Gemini APIでフィードバックを生成し、  
Notion本文の「AIフィードバック」ブロックに書き戻す。

平日夜間に1回実行し、**未処理キュー方式（FB_READY / FB_DONE）**で日報を消化する。

---

## 2. 実行スケジュール

- 実行頻度：**平日（月〜金）1日1回**
- 実行時刻（例）：**23:30 JST**
- トリガー：**AWS EventBridge Scheduler → AWS Lambda**

※「指定時刻に必ず」ではなく、「夜間に1回実行できればOK」とする。

---

## 3. 対象データ（Notion）

### 必須プロパティ

- `FB_READY`（checkbox）
- `FB_DONE`（checkbox）
- `FB_AT`（date / time）

### 対象抽出条件

以下すべてを満たすページを処理対象とする。

- `FB_READY = true`
- `FB_DONE = false`

※ 当日中に日報を書けなかった場合も拾えるよう、**日付条件では絞らない**。

---

## 4. 処理件数とガード条件

### 1回あたりの最大処理件数

- **MAX_ITEMS_PER_RUN = 5**

目的：

- Gemini無料枠の安全運用
- 日報が溜まった場合の暴走防止

---

### 本文の最低文字数

- **MIN_BODY_CHARS = 80**

- 80文字未満の場合は「内容不足」としてスキップ
- スキップ時は `FB_DONE` を更新しない（次回以降に再判定）

※ 原則として本文に「AIフィードバック」ブロックが存在する前提。

---

## 5. 本文取得と整形ルール

### 本文取得

1. Notion Database Query API で対象ページを取得
2. 各 `page_id` に対して `blocks/children` API を呼び、本文を取得
3. ページング（`next_cursor`）に対応する

---

### 本文整形ルール（AI入力用）

- ブロックは上から順に連結
- 見出し：`## 見出し`
- 箇条書き：`- item`
- 装飾や aside はプレーンテキストに変換
- Markdown風のテキストとして整形
- 「AIフィードバック」ブロック以降はAI入力から除外

最終的なAI入力は以下の2部構成とする：

1. 定型プロンプト（役割・ルール・出力フォーマット）
2. 整形済みの日報本文

---

## 6. Gemini API 呼び出し仕様

### 入力

- 定型プロンプト（固定）
- 日報本文（変動）

### 出力

- 指定されたフォーマット（1)〜6)）を厳守
- 余計な前置き・結論は出力しない

### 使用モデル

- 無料枠前提の軽量モデル（Flash系）

### 生成設定（generationConfig）

- `temperature: 0.7` - 創造性と一貫性のバランス
- `topP: 0.95` - トークン選択の多様性

これらの設定により、フィードバック生成時に過度なばらつきを抑えつつ、
適度な創造性と一貫性を両立した出力を実現します。

---

## 7. Notion への書き戻し仕様

### 書き込み対象

- 「AIフィードバック」ブロック本文：フィードバック内容（**上書き**）
- `FB_DONE`：`true`
- `FB_AT`：処理実行時刻

### 更新ルール

- Gemini生成成功 **かつ**
- Notion更新成功  
  この両方を満たした場合のみ `FB_DONE = true` とする。

途中失敗時は `FB_DONE` を更新しない。

---

## 8. 冪等性（再実行対策）

- 処理対象は `FB_DONE = false` のみ
- 同一ページの二重処理は原則発生しない

### 再生成したい場合（手動）

- `FB_DONE` を `false` に戻す
- 次回バッチで再生成（「AIフィードバック」ブロック本文は上書き）

---

## 9. エラーハンドリング方針

### ページ単位で分離

- 1ページの失敗が、他ページ処理に影響しないようにする

### 失敗時の扱い

- `FB_DONE` は更新しない
- 次回バッチで再試行される

### ログに残す情報

- `page_id`
- エラー種別
  - Notion取得失敗
  - Gemini生成失敗
  - Notion更新失敗
- 簡潔なエラーメッセージ

---

## 10. ログ設計（CloudWatch）

### 1実行あたりのログ

- 実行開始（requestId、対象件数）
- 成功件数 / 失敗件数
- 失敗ページの `page_id` と理由
- 実行終了（処理時間）

※ 日報本文や生成結果の全文はログに出力しない。

---

## 11. 成功の定義

以下を満たした場合、処理成功とする。

- 対象ページの「AIフィードバック」ブロック本文が更新されている
- `FB_DONE = true` が設定されている
- `FB_AT` が更新されている

---

## 12. 環境変数・設定値（SSM Parameter Store）

| Key                     | 内容                                            |
| ----------------------- | ----------------------------------------------- |
| `NOTION_TOKEN`          | Notion Integration Token（SecureString）        |
| `NOTION_DATA_SOURCE_ID` | 対象Data Source ID                              |
| `NOTION_VERSION`        | 対象Notion API Version（default: 2025-09-03）   |
| `GEMINI_API_KEY`        | Gemini API Key（SecureString）                  |
| `GEMINI_MODEL`          | Gemini Model（default: gemini-2.5-flash）       |
| `MAX_ITEMS_PER_RUN`     | 最大処理件数（default: 5）                      |
| `MIN_BODY_CHARS`        | 本文最低文字数（default: 80）                   |
| `GEMINI_INTERVAL_MS`    | Gemini呼び出し間隔(ms)（default: 15000）        |
| `PROMPT_VERSION`        | プロンプトバージョン(例: v1.0)（defalut: v1.0） |
| `DEBUG`                 | 1=デバッグログON                                |

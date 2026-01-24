# Architecture

## 全体構成
本ツールは、Notionを中心としたシンプルなバッチ構成で動作します。

- **Notion**
  - 日報の入力
  - 処理状態（FB_READY / FB_DONE）の管理
  - フィードバック結果（GPT_FB）の保存
- **AWS EventBridge**
  - 平日夜間の定期実行トリガー
- **AWS Lambda**
  - バッチ処理本体
  - Notion ↔ Gemini API の制御
- **Gemini API**
  - 日報本文を元にしたフィードバック生成

---

## データフロー

1. ユーザーがNotionに日報を記入
2. フィードバック対象として `FB_READY = true` を設定
3. 平日夜間、EventBridge が Lambda を起動
4. Lambda が Notion DB を検索  
   - `FB_READY = true`
   - `FB_DONE = false`
5. 対象ページの本文（blocks）を取得
6. 定型プロンプト + 日報本文を Gemini API に送信
7. Gemini API がフィードバックを生成
8. Lambda が Notion に以下を更新
   - `GPT_FB`：フィードバック内容
   - `FB_DONE = true`
   - `FB_AT = 実行日時`

---

## 状態管理の考え方

### FB_READY
- ユーザーが「この日報はフィードバック対象」と判断したことを示すフラグ
- 日報を当日中に書けなかった場合も、後からONにできる

### FB_DONE
- バッチ処理済みかどうかを示すフラグ
- 冪等性と再実行制御のために使用

この2つのフラグにより、
- 未処理データのみを安全に処理
- 失敗時の自然なリトライ
- 手動での再生成

を可能にしています。

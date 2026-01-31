# Report Feedback Automation

Notionで記録した日報を対象に、  
夜間バッチでAIフィードバックを自動生成する  
**日報自動フィードバックツール**です。

「日報を書いて終わり」にせず、  
**翌日の行動改善につながる振り返り**を、低コスト・低運用負荷で実現します。

---

## Overview

- 日報は Notion に記入
- ユーザーが「フィードバック対象」としてチェックを入れる
- 平日夜間に自動バッチが実行
- AI（Gemini）がメンター視点でフィードバックを生成
- 結果は Notion に自動で書き戻される

本ツールは **未処理キュー方式**と**状態管理（READY / DONE）**により、
当日書けなかった日報や一時的な失敗も自然に吸収する設計になっています。

---

## System Architecture（概要）

- **Notion**
  - 日報の入力・状態管理・フィードバック保存
- **AWS EventBridge**
  - 平日夜間の定期トリガー
- **AWS Lambda**
  - バッチ処理本体
- **Gemini API**
  - フィードバック生成（無料枠前提）

※ 構成図はテキストベースで管理しています。

---

## Processing Flow

日報フィードバック処理の全体像は以下を参照してください。

- [Processing Flow（簡易シーケンス）](docs/processing-flow.md)

---

## State Management

| Property | Role                                   |
| -------- | -------------------------------------- |
| FB_READY | ユーザーの意思（フィードバック対象か） |
| FB_DONE  | 処理の結果（処理済みか）               |
| FB_AT    | 処理完了時刻（履歴・観測用）           |

- ユーザー操作とシステム状態を分離することで、  
  冪等性・再実行・失敗耐性を確保しています。

---

## Docs

詳細設計・運用方法は以下を参照してください。

- [Overview](docs/overview.md)
- [Architecture](docs/architecture.md)
- [Batch Design](docs/design.md)
- [Notion API Design](docs/notion-api.md)
- [Processing Flow](docs/processing-flow.md)
- [Tech Stack](docs/tech-stack.md)
- [Operation](docs/operation.md)

---

## Motivation

フリーランスのシステムエンジニアとして、

- 日々の業務が流れ作業になりやすい
- 振り返りが主観的・形骸化しやすい
- レビュアーが身近にいない

と感じたことが、本ツールを作ったきっかけです。

**「継続できる振り返り」を自動化する**ことを目的に設計しています。

---

## Status

- ドキュメント設計：完了
- 実装：完了（Notion API / Gemini API / AWS Lambda）

---

## Note

本リポジトリは **設計・構成・運用判断を含めたポートフォリオ用途**として公開しています。  
個人データや実際の日報内容は含まれていません。

# Processing Flow（簡易シーケンス）

本ドキュメントでは、  
日報フィードバック自動化バッチの **処理順序と責務分担** を  
簡易シーケンス図として示します。

---

## 処理概要

- 平日夜間に EventBridge からバッチが起動
- Notion から「未処理の日報」を取得
- 日報本文（blocks）を再帰的に取得・整形
- AI（Gemini）にフィードバック生成を依頼
- 結果を Notion に書き戻し、状態を更新

---

## シーケンス図

```mermaid
sequenceDiagram
    autonumber
    participant EB as EventBridge（平日夜間）
    participant L as Lambda（Batch）
    participant N as Notion API
    participant G as Gemini API

    EB->>L: 定期トリガー（cron）
    L->>N: data_sources/{data_source_id}/query<br/>(FB_READY=true, FB_DONE=false)
    N-->>L: 対象ページ一覧（page_id[]）

    loop page_id ごと
        L->>N: blocks/{page_id}/children<br/>(ページ直下ブロック取得)
        N-->>L: blocks（has_children含む）

        loop has_children を再帰取得
            L->>N: blocks/{block_id}/children<br/>(子ブロック取得)
            N-->>L: child blocks
        end

        L->>L: blocks → Markdown整形
        L->>G: フィードバック生成<br/>(prompt + 日報本文)
        G-->>L: フィードバック本文

        L->>N: ページ更新（PATCH）<br/>(GPT_FB, FB_DONE=true, FB_AT=now)
        N-->>L: 200 OK
    end

    L-->>EB: 処理完了（ログ出力）
```

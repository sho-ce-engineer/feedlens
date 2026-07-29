# feedlens

RSSフィードをAI(Gemini)でフィルタリング・要約し、Discordに配信する個人用ダイジェストBotです。

## 概要

任意のWebメディアのRSSフィードを毎日任意の時間に取得し、あらかじめ定義したテーマ(ジュニアエンジニアの成長に役立つ内容かどうか)に沿ってGeminiが判定・要約します。

- 判定を通過した記事(Hot) → 要約付きで個別にDiscordへ通知
- それ以外の記事 → タイトルとリンクだけをまとめてダイジェストとして通知

GitHub Actionsで毎日1回(07:00 JST)自動実行されます。  
*※RSSメディア、フィルタリング要件、時間や頻度などは、パラメータを変更することで任意の動作に変更できます。*

## アーキテクチャ

Clean Architectureの考え方を、必要な箇所にのみ選択的に適用しています。

```
src/
  domain/
    article.ts             # Article, ClassifiedArticle, ArticleError などのデータ型(zodスキーマ)
    classifier.ts          # Classifier interface(契約) — AI実装を差し替え可能にするための抽象化
    result.ts              # Result<T> 汎用の成功/失敗型
  infrastructure/
    gemini-classifier.ts   # Classifier の実装。Gemini API呼び出し・リトライ・構造化出力の検証
  config.ts                # 環境変数の検証・export
  feed-fetcher.ts          # RSS取得(rss-parser)
  discord-notifier.ts      # Discord Webhook通知
index.ts                   # 全体の組み立て役
```

interfaceによる抽象化は「**実装を差し替える可能性が現実的にある箇所**」(`Classifier`)にのみ適用し、それ以外(RSS取得・Discord通知)はシンプルな関数のままにしています。

## 処理フロー

```
① feed-fetcher.ts でRSSフィードを取得
② 直近24時間以内に公開された記事のみに絞り込み
③ 記事ごとに GeminiClassifier.judgeIsHot() で判定
     false → ダイジェスト用配列に追加
     true  → GeminiClassifier.summarize() で要約(URL context toolで本文を取得)
           → 要約付きで #hot-news に個別通知
④ ③の後、ダイジェスト用配列をまとめて #daily-digest に1回通知
⑤ 発生したエラーは処理を止めずに記録し、最後にまとめてログ出力
```

一部の記事やAPI呼び出しが失敗しても、処理全体は止まらずに続行します(部分的失敗の許容)。

## 技術スタック

- **実行環境**: [Bun](https://bun.sh/)
- **言語**: TypeScript
- **バリデーション**: [Zod](https://zod.dev/) v4
- **RSS取得**: [rss-parser](https://www.npmjs.com/package/rss-parser)
- **AI**: Google Gemini API(`@google/genai`, Interactions API)
  - 現行モデル: `gemini-3.5-flash-lite`(環境変数で変更可能)
- **通知**: Discord Incoming Webhooks
- **実行基盤**: GitHub Actions(cron)
- **Lint/Format**: [Biome](https://biomejs.dev/)

## セットアップ

### 1. 依存関係のインストール

```bash
bun install
```

### 2. 環境変数の設定

`.env`ファイルをプロジェクトルートに作成してください。

```
GEMINI_API_KEY = your_gemini_api_key
DISCORD_HOT_WEBHOOK_URL = your_hot_news_channel_webhook_url
DISCORD_DIGEST_WEBHOOK_UR L= your_digest_channel_webhook_url
GEMINI_MODEL = gemini-3.5-flash-lite
```

- Gemini APIキーは [Google AI Studio](https://ai.google.dev/) から取得できます
- Discord Webhook URLは、各チャンネルの設定 → 連携サービス → ウェブフック から発行できます

### 3. フィード一覧の設定

`feeds.json`に、取得したいRSSフィードのURLを配列で列挙します。

```json
//例
[
  "https://api.findy-code.io/rss/media/recent",
  "https://rss.itmedia.co.jp/rss/2.0/news_nettopics.xml"
]
```

### 4. 実行

```bash
bun run index.ts
```

## GitHub Actionsでの自動実行

`.github/workflows/`配下のワークフローにより、毎日07:00 JST(cron: `0 22 * * *`, UTC基準)に自動実行されます。

リポジトリの Settings → Secrets and variables → Actions で、以下を登録してください。

**Secrets**
- `GEMINI_API_KEY`
- `DISCORD_HOT_WEBHOOK_URL`
- `DISCORD_DIGEST_WEBHOOK_URL`

**Variables**
- `GEMINI_MODEL`

## 既知の制約

- **Gemini無料枠のレート制限**: モデルごとにRPM/RPDの上限があります。処理する記事数が多い場合、レート制限に達すると自動で待機（60秒）・再試行しますが、それでも失敗した記事はスキップされます。
- **既読管理を行わない設計**: 記事の重複通知防止は、既読ID管理ではなく「直近24時間以内に公開された記事のみを対象にする」という日付ベースのフィルタで実現しています。Actionsの実行が失敗・スキップされた場合、その間に公開された記事を見逃す可能性があります。
- **要約生成が稀に失敗することがある**: `summarize`はURL context toolで記事本文を取得しますが、ページによってはツール呼び出しが失敗し、その記事の要約・通知がスキップされることがあります。
- **Discordの表示設定**: クライアント側で「埋め込みとリンクのプレビューを表示」がオフになっていると、正常に送信されたメッセージでも中身(embed)が表示されません。あらかじめ設定変更の上、お楽しみください。

## ライセンス

MIT License. 詳細は[LICENSE](./LICENSE)を参照してください。
# feedlens

RSSフィードをAI(Gemini)でフィルタリング・要約し、Discordに配信する個人用ダイジェストBotです。

## 概要

任意のWebメディアのRSSフィードを毎日任意の時間に取得し、あらかじめ定義したテーマ(ジュニアエンジニアの成長に役立つ内容かどうか)に沿ってGeminiが判定・分類・採点します。

- 判定を通過した記事(Hot)を「技術記事」と「製品・ガジェット」に分け、それぞれ点数(1〜10)の高い順に、上限件数まで要約付きで #hot-news に通知
  - 上限は技術記事15件・製品・ガジェット5件(`src/pipeline.ts` の `categoryLimits`)
  - カテゴリごとに見出しを付けて送ります
- Hotでない記事、上限を超えた記事、会員限定の記事は通知しません(実行結果サマリに件数が出ます)

GitHub Actionsで毎日1回(05:00 JST)自動実行されます。  
*※RSSメディア、フィルタリング要件、時間や頻度などは、パラメータを変更することで任意の動作に変更できます。*

## アーキテクチャ

Clean Architectureの考え方を、必要な箇所にのみ選択的に適用しています。

```
src/
  domain/
    article.ts             # Article, ClassifiedArticle, カテゴリ(tech/product) などのデータ型(zodスキーマ)
    classifier.ts          # Classifier interface(契約) — AI実装を差し替え可能にするための抽象化
    criteria.ts            # Hot判定の基準(criteria.json)のスキーマ
    result.ts              # Result<T> 汎用の成功/失敗型
  infrastructure/
    gemini-classifier.ts   # Classifier の実装。Gemini API呼び出し・リトライ・構造化出力の検証
    prompts.ts             # Geminiに渡すプロンプトの組み立て
  config.ts                # 環境変数の検証・export
  feed-fetcher.ts          # RSS取得(rss-parser)
  url-normalize.ts         # URLの正規化(計測用クエリ・フラグメント・末尾スラッシュの除去など)
  dedupe.ts                # 正規化したURLが同じ記事を1件にまとめる
  discord-notifier.ts      # Discord Webhook通知(429リトライ・見出し・実行結果サマリ含む)
  pipeline.ts              # 判定→カテゴリ別に点数順→上限まで要約→通知の流れと失敗時のフォールバック
criteria.json              # Hot判定のテーマ・除外条件
index.ts                   # 全体の組み立て役
```

interfaceによる抽象化は「**実装を差し替える可能性が現実的にある箇所**」(`Classifier`)にのみ適用し、それ以外(RSS取得・Discord通知)はシンプルな関数のままにしています。

## 処理フロー

```
① feed-fetcher.ts でRSSフィードを取得
② 直近24時間以内に公開された記事のみに絞り込み
   さらに、同じURL(計測用クエリ・フラグメント・末尾スラッシュを除いて比較)の記事は1件にまとめる(最初に現れた記事を残す)
③ 記事ごとに GeminiClassifier.judge() で判定(Hotか・技術/製品の分類・1〜10の点数。GEMINI_CONCURRENCY 件まで並列に実行)
     Hotでない → 通知しない
     判定失敗 → 通知しない(エラーとして記録し、サマリに件数を出す)
④ Hotをカテゴリ別(技術記事/製品・ガジェット)に、点数の高い順(同点は公開日の新しい順)に並べる
⑤ カテゴリごとに、上位から上限件数まで GeminiClassifier.summarize() で要約(URL context toolで本文を取得)
     会員限定と判定された記事は破棄し、次の候補で枠を埋める
     要約失敗 → 要約なしで通知対象に残す
     上限に入らなかった記事は要約もしない(件数だけ「上限で省略」として数える)
⑥ カテゴリごとに、見出し → 記事の順で #hot-news に1件ずつ送る
⑦ 発生したエラーは処理を止めずに記録し、最後にまとめてログ出力
⑧ 実行結果サマリ(件数・上限で省略した数・エラー)を Discord に1回通知
```

各記事に出どころ(媒体名とドメイン)とおすすめ度(点数)を表示します。

一部の記事やAPI呼び出しが失敗しても、処理全体は止まらずに続行します(部分的失敗の許容)。

### 上限で省略された件数

実行結果サマリに、カテゴリごとの「Hot件数 → 通知数 / 上限で省略 / 会員限定で破棄」が出ます。Hot候補の半数を超えて上限で省略されたカテゴリには警告が付きます。大半が省略されている場合は、判定基準(`criteria.json`)や上限の見直しの目安にしてください。

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
DISCORD_LOG_WEBHOOK_URL = your_log_channel_webhook_url # 任意。実行結果サマリの通知先(未設定ならHotと同じチャンネル)
GEMINI_MODEL = gemini-3.5-flash-lite
GEMINI_CONCURRENCY = 3 # 任意。Geminiの同時呼び出し数(未設定なら3)
```

- Gemini APIキーは [Google AI Studio](https://ai.google.dev/) から取得できます
- Discord Webhook URLは、各チャンネルの設定 → 連携サービス → ウェブフック から発行できます
- 以前のダイジェスト用の `DISCORD_DIGEST_WEBHOOK_URL` は、アプリ本体では使いません。ワークフローの失敗通知だけが、`DISCORD_LOG_WEBHOOK_URL` が未設定のときの送り先として今も参照します

### 3. フィード一覧の設定

`feeds.json`に、取得したいRSSフィードのURLを配列で列挙します。

```json
//例
[
  "https://api.findy-code.io/rss/media/recent",
  "https://rss.itmedia.co.jp/rss/2.0/news_nettopics.xml"
]
```

### 4. 判定基準の設定

`criteria.json`で、記事を「Hot」と判定するテーマ(`themes`)と、Hotにしない記事の例(`rejects`)を編集できます。コードを変更せずに判定基準を調整できます。

技術記事と製品・ガジェットの分類、点数の付け方は、`src/infrastructure/prompts.ts` のプロンプトで指示しています。

### 5. 実行

```bash
bun run index.ts
```

## GitHub Actionsでの自動実行

`.github/workflows/`配下のワークフローにより、毎日05:00 JST(cron: `0 20 * * *`, UTC基準)に自動実行されます。

リポジトリの Settings → Secrets and variables → Actions で、以下を登録してください。

**Secrets**
- `GEMINI_API_KEY`
- `DISCORD_HOT_WEBHOOK_URL`
- `DISCORD_LOG_WEBHOOK_URL`(任意。実行結果サマリの通知先)

**Variables**
- `GEMINI_MODEL`
- `GEMINI_CONCURRENCY`(任意。Geminiの同時呼び出し数。未設定なら3。レート制限(429)に当たる場合は下げる)

## 既知の制約

- **Gemini無料枠のレート制限**: モデルごとにRPM/RPDの上限があります。処理する記事数が多い場合、レート制限に達すると自動で待機（60秒）・再試行しますが、それでも判定に失敗した記事は通知されません(実行結果サマリの「判定失敗」に件数が出ます)。Discord Webhookのレート制限(429)は`Retry-After`に従って自動で再試行します。
- **点数は判定時の情報で付く**: 点数はタイトルと本文抜粋だけから付けるため、本文まで読んだ上での評価より粗くなります。点数が特定の値に偏ると、並び順は実質的に公開日順に近づきます。
- **既読管理を行わない設計**: 記事の重複通知防止は、既読ID管理ではなく「直近24時間以内に公開された記事のみを対象にする」という日付ベースのフィルタで実現しています。Actionsの実行が失敗・スキップされた場合、その間に公開された記事を見逃す可能性があります。上限で省略された記事も、翌日には通知されません。
- **要約生成が稀に失敗することがある**: `summarize`はURL context toolで記事本文を取得しますが、ページによってはツール呼び出しが失敗し、要約なしの状態で通知されます(要約部分に失敗した旨が表示されます)。
- **会員限定の判定は完全ではない**: Geminiの判定と、URL context toolが返す取得結果(`paywall`)の両方から判定しています。ログインが必要でも本文の一部が読める記事などは、会員限定と判定されないことがあります。会員限定と判定された記事は通知しません。
- **Discordの表示設定**: クライアント側で「埋め込みとリンクのプレビューを表示」がオフになっていると、正常に送信されたメッセージでも中身(embed)が表示されません。あらかじめ設定変更の上、お楽しみください。

## ライセンス

MIT License. 詳細は[LICENSE](./LICENSE)を参照してください。

import { hotNewsWebhookUrl, logWebhookUrl } from "./config";
import {
	type Article,
	type Category,
	type ClassifiedArticle,
	categories,
	categoryLabels,
} from "./domain/article";
import type { Result } from "./domain/result";
import type { CategoryStats } from "./pipeline";

const toDay = new Date().toLocaleDateString("ja-JP", {
	timeZone: "Asia/Tokyo",
});

const maxRateLimitRetries = 3;
const maxRetryWaitMs = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 429時の待機時間(ms)。Retry-Afterヘッダ(秒)を優先し、無ければbodyのretry_after(秒)を見る
const getRetryWaitMs = (res: Response, bodyText: string): number => {
	let seconds = Number.parseFloat(res.headers.get("Retry-After") ?? "");
	if (Number.isNaN(seconds)) {
		try {
			const body = JSON.parse(bodyText) as { retry_after?: unknown };
			seconds = Number(body.retry_after);
		} catch {
			seconds = Number.NaN;
		}
	}
	if (Number.isNaN(seconds) || seconds < 0) {
		seconds = 1;
	}
	return seconds * 1000;
};

// Webhookへ送信する。429(レート制限)の場合は待機して限定回数リトライする
export const postWebhook = async (
	url: string,
	body: unknown,
	label: string,
): Promise<Result<void>> => {
	for (let attempt = 0; ; attempt++) {
		let res: Response;
		try {
			res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		} catch (error) {
			return {
				success: false,
				error: `${label}:Network Error:${error instanceof Error ? error.message : String(error)}`,
			};
		}

		if (res.ok) {
			return { success: true, data: undefined };
		}

		const bodyText = await res.text();

		if (res.status === 429 && attempt < maxRateLimitRetries) {
			const waitMs = getRetryWaitMs(res, bodyText);
			// 指定された待機時間が上限を超える場合は、待ちきれないためリトライせずエラーにする
			if (waitMs <= maxRetryWaitMs) {
				await sleep(waitMs);
				continue;
			}
		}

		return {
			success: false,
			error: `${label}: Discord webhook returned an error (status ${res.status} ${res.statusText}): ${bodyText}`,
		};
	}
};

// 記事の出どころ。媒体名とドメインを併記し、どちらかが取れない場合は取れた方だけにする
export const formatSource = (article: Article): string => {
	let domain = "";
	try {
		domain = new URL(article.link).hostname;
	} catch {
		domain = "";
	}
	if (article.sourceName && domain) {
		return `${article.sourceName} (${domain})`;
	}
	return article.sourceName || domain;
};

export const buildHotPayload = (classified: ClassifiedArticle) => ({
	embeds: [
		{
			title: classified.article.title,
			url: classified.article.link,
			description: classified.summary,
			footer: {
				text: `${formatSource(classified.article) || "出どころ不明"} ・ おすすめ度 ${classified.score}/10`,
			},
		},
	],
});

export const notifyHot = async (
	classified: ClassifiedArticle,
): Promise<Result<void>> => {
	return postWebhook(
		hotNewsWebhookUrl,
		buildHotPayload(classified),
		"notifyHot",
	);
};

export const buildHeading = (category: Category, count: number): string =>
	`## ${categoryLabels[category]}(${count}件)`;

export const notifyHeading = async (
	category: Category,
	count: number,
): Promise<Result<void>> => {
	return postWebhook(
		hotNewsWebhookUrl,
		{ content: buildHeading(category, count) },
		"notifyHeading",
	);
};

export type RunSummary = {
	feedCount: number;
	fetchErrorCount: number;
	parseErrorCount: number;
	articleCount: number;
	recentCount: number;
	duplicateCount: number;
	judgeFailedCount: number;
	categories: Record<Category, CategoryStats>;
	errors: string[];
};

//Discord：content上限2000文字に収める
const summaryTextLimit = 1900;
const summaryErrorLimit = 10;
const summaryErrorLength = 150;

export const isMostlyCut = (stats: CategoryStats): boolean =>
	stats.candidates > 0 && stats.cut * 2 > stats.candidates;

export const buildRunSummary = (summary: RunSummary): string => {
	const lines = [
		`📊 feedlens 実行結果(${toDay})`,
		`フィード: ${summary.feedCount}件(取得失敗 ${summary.fetchErrorCount}件)`,
		`記事: ${summary.articleCount}件(解析失敗 ${summary.parseErrorCount}件) → 直近24時間 ${summary.recentCount}件`,
		`重複除外: ${summary.duplicateCount}件`,
		`判定失敗: ${summary.judgeFailedCount}件(通知されません)`,
	];

	for (const category of categories) {
		const stats = summary.categories[category];
		lines.push(
			`${categoryLabels[category]}(上限${stats.limit}件): Hot ${stats.candidates}件 → 通知 ${stats.notified}件 / 上限で省略 ${stats.cut}件 / 会員限定で破棄 ${stats.paywalled}件`,
		);
	}
	for (const category of categories) {
		const stats = summary.categories[category];
		if (isMostlyCut(stats)) {
			lines.push(
				`⚠️ ${categoryLabels[category]}: Hot候補の半数超(${stats.cut}/${stats.candidates}件)が上限で省略されています。判定基準や上限の見直しを検討してください`,
			);
		}
	}

	if (summary.errors.length > 0) {
		lines.push(`⚠️ エラー ${summary.errors.length}件`);
		for (const error of summary.errors.slice(0, summaryErrorLimit)) {
			const oneLine = error.replace(/\s+/g, " ");
			lines.push(
				`- ${oneLine.length > summaryErrorLength ? `${oneLine.slice(0, summaryErrorLength)}…` : oneLine}`,
			);
		}
		if (summary.errors.length > summaryErrorLimit) {
			lines.push(`…ほか ${summary.errors.length - summaryErrorLimit}件`);
		}
	}

	const text = lines.join("\n");
	return text.length > summaryTextLimit
		? `${text.slice(0, summaryTextLimit)}…`
		: text;
};

export const notifyRunSummary = async (
	summary: RunSummary,
): Promise<Result<void>> => {
	return postWebhook(
		logWebhookUrl,
		{ content: buildRunSummary(summary) },
		"notifyRunSummary",
	);
};

import { digestWebhookUrl, hotNewsWebhookUrl, logWebhookUrl } from "./config";
import type {
	Article,
	ClassifiedArticle,
	DigestArticle,
} from "./domain/article";
import type { Result } from "./domain/result";

type Field = {
	name: string;
	value: string;
};
type Embed = { title: string; fields: Field[] };

const toDay = new Date().toLocaleDateString("ja-JP", {
	timeZone: "Asia/Tokyo",
});

//Discord：メッセージ文字数上限6000文字のため、titleとマージンを設けた値
const textLimit = 6000 * 0.9;

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

export const notifyHot = async (
	classified: ClassifiedArticle,
): Promise<Result<void>> => {
	return postWebhook(
		hotNewsWebhookUrl,
		{
			embeds: [
				{
					title: classified.article.title,
					url: classified.article.link,
					description: classified.summary,
					footer: { text: formatSource(classified.article) || "出どころ不明" },
				},
			],
		},
		"notifyHot",
	);
};

export const buildDigestMessages = (
	digestArticles: DigestArticle[],
): Embed[][] => {
	const fields: Field[] = digestArticles.map(({ article, isPaywalled }) => {
		const source = formatSource(article);
		const name = `${isPaywalled ? "🔒 会員限定 " : ""}${article.title}`;
		const value = source ? `${article.link}\n${source}` : article.link;
		return {
			name: name.slice(0, 256), //256文字制限に対応
			value: value.slice(0, 1024), //1024文字制限に対応
		};
	});

	const groupMessage: Embed[][] = [];
	let currentMessage: Embed[] = [];
	let messageTextLength = 0;
	let currentEmbed: Field[] = [];
	let currentEmbedTextLength = 0;

	for (const field of fields) {
		const fieldTextLength = field.name.length + field.value.length;
		if (
			currentEmbed.length >= 25 ||
			currentEmbedTextLength + fieldTextLength >= textLimit
		) {
			const completedEmbed: Embed = {
				title: "",
				fields: currentEmbed,
			};

			if (
				currentMessage.length >= 10 ||
				messageTextLength + currentEmbedTextLength >= textLimit
			) {
				groupMessage.push(currentMessage);
				currentMessage = [];
				messageTextLength = 0;
			}

			currentMessage.push(completedEmbed);
			messageTextLength = messageTextLength + currentEmbedTextLength;
			currentEmbed = [];
			currentEmbedTextLength = 0;
		}
		currentEmbed.push(field);
		currentEmbedTextLength = currentEmbedTextLength + fieldTextLength;
	}

	if (currentEmbed.length > 0) {
		const completedEmbed: Embed = {
			title: "",
			fields: currentEmbed,
		};
		if (
			currentMessage.length >= 10 ||
			messageTextLength + currentEmbedTextLength >= textLimit
		) {
			groupMessage.push(currentMessage);
			currentMessage = [];
			messageTextLength = 0;
		}
		currentMessage.push(completedEmbed);
	}
	if (currentMessage.length > 0) {
		groupMessage.push(currentMessage);
	}

	const totalEmbedCount = groupMessage.reduce(
		(sum, message) => sum + message.length,
		0,
	);
	let embedIndex = 0;
	for (const message of groupMessage) {
		for (const embed of message) {
			embedIndex++;
			embed.title = `${toDay}のダイジェスト(${embedIndex}/${totalEmbedCount})`;
		}
	}

	return groupMessage;
};

export const notifyDigest = async (
	digestArticles: DigestArticle[],
): Promise<Result<void>> => {
	const groupMessage = buildDigestMessages(digestArticles);

	const digestErrors: string[] = [];

	for (const message of groupMessage) {
		const result = await postWebhook(
			digestWebhookUrl,
			{ embeds: message },
			"notifyDigest",
		);
		if (!result.success) {
			digestErrors.push(result.error);
		}
	}
	if (digestErrors.length >= 1) {
		return { success: false, error: digestErrors.join(" / ") };
	}
	return { success: true, data: undefined };
};

export type RunSummary = {
	feedCount: number;
	fetchErrorCount: number;
	parseErrorCount: number;
	articleCount: number;
	recentCount: number;
	hotCount: number;
	digestCount: number;
	paywalledCount: number;
	errors: string[];
};

//Discord：content上限2000文字に収める
const summaryTextLimit = 1900;
const summaryErrorLimit = 10;
const summaryErrorLength = 150;

export const buildRunSummary = (summary: RunSummary): string => {
	const lines = [
		`📊 feedlens 実行結果(${toDay})`,
		`フィード: ${summary.feedCount}件(取得失敗 ${summary.fetchErrorCount}件)`,
		`記事: ${summary.articleCount}件(解析失敗 ${summary.parseErrorCount}件) → 直近24時間 ${summary.recentCount}件`,
		`通知: Hot ${summary.hotCount}件 / ダイジェスト ${summary.digestCount}件(うち会員限定 ${summary.paywalledCount}件)`,
	];

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

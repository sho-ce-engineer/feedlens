import { digestWebhookUrl, hotNewsWebhookUrl } from "./config";
import type { Article, ClassifiedArticle } from "./domain/article";
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
const getRetryWaitMs = async (res: Response): Promise<number> => {
	let seconds = Number.parseFloat(res.headers.get("Retry-After") ?? "");
	if (Number.isNaN(seconds)) {
		try {
			const body = (await res.json()) as { retry_after?: unknown };
			seconds = Number(body.retry_after);
		} catch {
			seconds = Number.NaN;
		}
	}
	if (Number.isNaN(seconds) || seconds < 0) {
		seconds = 1;
	}
	return Math.min(seconds * 1000, maxRetryWaitMs);
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

		if (res.status === 429 && attempt < maxRateLimitRetries) {
			await sleep(await getRetryWaitMs(res));
			continue;
		}

		const bodyText = await res.text();
		return {
			success: false,
			error: `${label}: Discord webhook returned an error (status ${res.status} ${res.statusText}): ${bodyText}`,
		};
	}
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
				},
			],
		},
		"notifyHot",
	);
};

export const buildDigestMessages = (articles: Article[]): Embed[][] => {
	const fields: Field[] = articles.map((article) => ({
		name: article.title.slice(0, 256), //256文字制限に対応
		value: article.link.slice(0, 1024), //1024文字制限に対応
	}));

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
	articles: Article[],
): Promise<Result<void>> => {
	const groupMessage = buildDigestMessages(articles);

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

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

export const notifyHot = async (
	classified: ClassifiedArticle,
): Promise<Result<void>> => {
	let res: Awaited<ReturnType<typeof fetch>>;
	try {
		res = await fetch(hotNewsWebhookUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				embeds: [
					{
						title: classified.article.title,
						url: classified.article.link,
						description: classified.summary,
					},
				],
			}),
		});
	} catch (error) {
		return {
			success: false,
			error: `notifyHot:Network Error:${error instanceof Error ? error.message : String(error)}`,
		};
	}

	if (!res.ok) {
		const bodyText = await res.text();
		return {
			success: false,
			error: `notifyHot: Discord webhook returned an error (status ${res.status} ${res.statusText}): ${bodyText}`,
		};
	}
	return { success: true, data: undefined };
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
	let res: Awaited<ReturnType<typeof fetch>>;

	const groupMessage = buildDigestMessages(articles);

	const digestErrors: string[] = [];

	for (const message of groupMessage) {
		try {
			res = await fetch(digestWebhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					embeds: message,
				}),
			});
		} catch (error) {
			digestErrors.push(error instanceof Error ? error.message : String(error));
			continue;
		}

		if (!res.ok) {
			const bodyText = await res.text();
			digestErrors.push(bodyText);
		}
	}
	if (digestErrors.length >= 1) {
		return { success: false, error: digestErrors.join(" / ") };
	}
	return { success: true, data: undefined };
};

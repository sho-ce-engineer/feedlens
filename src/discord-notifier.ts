import { digestWebhookUrl, hotNewsWebhookUrl } from "./config";
import type { Article, ClassifiedArticle } from "./domain/article";
import type { Result } from "./domain/result";

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

export const notifyDigest = async (
	articles: Article[],
): Promise<Result<void>> => {
	let res: Awaited<ReturnType<typeof fetch>>;

	const fields = articles.map((article) => ({
		name: article.title.slice(0, 256), //256文字制限に対応
		value: article.link.slice(0, 1024), //1024文字制限に対応
	}));

	const groupedFields = [];
	for (let i = 0; fields.length > i; i = i + 25) {
		groupedFields.push(fields.slice(i, i + 25));
	}
	const embeds = groupedFields.map((group) => ({
		title: "今日のダイジェスト",
		fields: group,
	}));

	const groupedEmbeds = [];
	for (let i = 0; embeds.length > i; i = i + 10) {
		groupedEmbeds.push(embeds.slice(i, i + 10));
	}

	const digestErrors: string[] = [];

	for (const group of groupedEmbeds) {
		try {
			res = await fetch(digestWebhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					embeds: group,
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

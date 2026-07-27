import Parser from "rss-parser";
import urls from "../feeds.json";
import {
	type Article,
	type ArticleError,
	ArticleSchema,
} from "./domain/article";

type FetchError = {
	reason: unknown;
	url?: string; //実際にはurlsとindexは同じものから参照しているためundefinedにはなり得ない
};

const parser = new Parser();

export const fetchFeeds = async (): Promise<{
	articles: Article[];
	articlesError: ArticleError[];
	fetchError: FetchError[];
}> => {
	const articles: Article[] = [];
	const articlesError: ArticleError[] = [];
	const fetchError: FetchError[] = [];

	const results = await Promise.allSettled(
		urls.map((url) => parser.parseURL(url)),
	);

	for (const [index, result] of results.entries()) {
		if (result.status === "fulfilled") {
			const feed = result.value;
			for (const rawItem of feed.items) {
				const parsed = ArticleSchema.safeParse({
					title: rawItem.title,
					link: rawItem.link,
					guid: rawItem.guid ?? rawItem.link,
					pubDate: rawItem.pubDate,
					description: rawItem.contentSnippet ?? rawItem.content ?? "",
					sourceName: feed.title,
				});
				if (parsed.success) {
					articles.push(parsed.data);
				} else {
					articlesError.push({
						error: parsed.error,
						siteName: feed.title,
						link: feed.link,
						pageName: rawItem.title,
						pageLink: rawItem.link,
						pageId: rawItem.guid,
					});
				}
			}
		} else {
			fetchError.push({
				reason: result.reason,
				url: urls[index],
			});
		}
	}

	return {
		articles: articles,
		articlesError: articlesError,
		fetchError: fetchError,
	};
};

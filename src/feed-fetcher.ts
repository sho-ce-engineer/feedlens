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

// 取得済みフィードの各記事を検証し、Articleに変換する
export const parseFeed = (
	feed: Parser.Output<Record<string, unknown>>,
): { articles: Article[]; articlesError: ArticleError[] } => {
	const articles: Article[] = [];
	const articlesError: ArticleError[] = [];

	for (const rawItem of feed.items) {
		const parsed = ArticleSchema.safeParse({
			title: rawItem.title?.trim(),
			link: rawItem.link,
			guid: rawItem.guid ?? rawItem.link,
			// RSS 1.0(RDF)形式はpubDateを持たずdc:dateで公開日を表すため、
			// rss-parserがpubDateまたはdc:dateから作るisoDateを優先する
			pubDate: rawItem.isoDate ?? rawItem.pubDate,
			description: rawItem.contentSnippet ?? rawItem.content ?? "",
			sourceName: feed.title?.trim() ?? "",
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

	return { articles, articlesError };
};

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
			const parsed = parseFeed(result.value);
			articles.push(...parsed.articles);
			articlesError.push(...parsed.articlesError);
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

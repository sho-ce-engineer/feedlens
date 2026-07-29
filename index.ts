import { notifyDigest, notifyHot } from "./src/discord-notifier";
import type { Article, ClassifiedArticle } from "./src/domain/article";
import { fetchFeeds } from "./src/feed-fetcher";
import { GeminiClassifier } from "./src/infrastructure/gemini-classifier";

const filterRecent = (articles: Article[]): Article[] => {
	const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
	return articles.filter((article) => article.pubDate > twentyFourHoursAgo);
};

const { articles, articlesError, fetchError } = await fetchFeeds();

const filteredArticle = filterRecent(articles);

const classifier = new GeminiClassifier();

const resultError: string[] = [];
const toDigestArticle: Article[] = [];

for (const article of filteredArticle) {
	const judgeResult = await classifier.judgeIsHot(article);

	if (!judgeResult.success) {
		resultError.push(judgeResult.error);
		continue;
	} else if (judgeResult.data === false) {
		toDigestArticle.push(article);
		continue;
	}

	const summarizeResult = await classifier.summarize(article);

	if (!summarizeResult.success) {
		resultError.push(summarizeResult.error);
		continue;
	}

	const classified: ClassifiedArticle = {
		article,
		summary: summarizeResult.data,
	};
	const resultHot = await notifyHot(classified);
	if (resultHot.success === false) {
		resultError.push(resultHot.error);
	}
}

if (toDigestArticle.length > 0) {
	const resultDigest = await notifyDigest(toDigestArticle);
	if (resultDigest.success === false) {
		resultError.push(resultDigest.error);
	}
}

if (
	articlesError.length > 0 ||
	fetchError.length > 0 ||
	resultError.length > 0
) {
	console.error("以下のエラーが発生しました:");
	console.error("articlesError:", articlesError);
	console.error("fetchError:", fetchError);
	console.error("resultError:", resultError);
}

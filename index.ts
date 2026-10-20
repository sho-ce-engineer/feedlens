import { notifyDigest, notifyHot } from "./src/discord-notifier";
import { fetchFeeds } from "./src/feed-fetcher";
import { GeminiClassifier } from "./src/infrastructure/gemini-classifier";
import { filterRecent, processArticles } from "./src/pipeline";

const { articles, articlesError, fetchError } = await fetchFeeds();

const filteredArticle = filterRecent(articles);

const classifier = new GeminiClassifier();

const { digestArticles, errors } = await processArticles(
	filteredArticle,
	classifier,
	notifyHot,
);

if (digestArticles.length > 0) {
	const resultDigest = await notifyDigest(digestArticles);
	if (resultDigest.success === false) {
		errors.push(resultDigest.error);
	}
}

if (articlesError.length > 0 || fetchError.length > 0 || errors.length > 0) {
	console.error("以下のエラーが発生しました:");
	console.error("articlesError:", articlesError);
	console.error("fetchError:", fetchError);
	console.error("resultError:", errors);
}

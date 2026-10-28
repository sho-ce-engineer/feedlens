import urls from "./feeds.json";
import { geminiConcurrency } from "./src/config";
import {
	notifyDigest,
	notifyHot,
	notifyRunSummary,
} from "./src/discord-notifier";
import { fetchFeeds } from "./src/feed-fetcher";
import { GeminiClassifier } from "./src/infrastructure/gemini-classifier";
import { filterRecent, processArticles } from "./src/pipeline";

const { articles, articlesError, fetchError } = await fetchFeeds();

const filteredArticle = filterRecent(articles);

const classifier = new GeminiClassifier();

const { hotCount, digestArticles, errors } = await processArticles(
	filteredArticle,
	classifier,
	notifyHot,
	geminiConcurrency,
);

if (digestArticles.length > 0) {
	const resultDigest = await notifyDigest(digestArticles);
	if (resultDigest.success === false) {
		errors.push(resultDigest.error);
	}
}

const fetchErrorMessages = fetchError.map(
	(e) => `フィード取得失敗 ${e.url}: ${String(e.reason)}`,
);

const allErrors = [...fetchErrorMessages, ...errors];

if (articlesError.length > 0 || fetchError.length > 0 || errors.length > 0) {
	console.error("以下のエラーが発生しました:");
	console.error("articlesError:", articlesError);
	console.error("fetchError:", fetchError);
	console.error("resultError:", errors);
}

const summaryResult = await notifyRunSummary({
	feedCount: urls.length,
	fetchErrorCount: fetchError.length,
	parseErrorCount: articlesError.length,
	articleCount: articles.length,
	recentCount: filteredArticle.length,
	hotCount,
	digestCount: digestArticles.length,
	paywalledCount: digestArticles.filter((d) => d.isPaywalled).length,
	errors: allErrors,
});
if (summaryResult.success === false) {
	console.error(summaryResult.error);
}

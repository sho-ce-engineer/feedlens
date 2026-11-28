import urls from "./feeds.json";
import { geminiConcurrency } from "./src/config";
import { dedupeArticles } from "./src/dedupe";
import {
	notifyHeading,
	notifyHot,
	notifyRunSummary,
} from "./src/discord-notifier";
import { fetchFeeds } from "./src/feed-fetcher";
import { GeminiClassifier } from "./src/infrastructure/gemini-classifier";
import { filterRecent, processArticles, sendSections } from "./src/pipeline";

const { articles, articlesError, fetchError } = await fetchFeeds();

const recentArticles = filterRecent(articles);
const { unique: filteredArticle, duplicateCount } =
	dedupeArticles(recentArticles);

const classifier = new GeminiClassifier();

const { sections, selection, judgeFailedCount, errors } = await processArticles(
	filteredArticle,
	classifier,
	geminiConcurrency,
);

const sent = await sendSections(sections, {
	heading: notifyHeading,
	hot: notifyHot,
});
errors.push(...sent.errors);

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
	recentCount: recentArticles.length,
	duplicateCount,
	judgeFailedCount,
	categories: {
		tech: { ...selection.tech, notified: sent.notified.tech },
		product: { ...selection.product, notified: sent.notified.product },
	},
	errors: allErrors,
});
if (summaryResult.success === false) {
	console.error(summaryResult.error);
}

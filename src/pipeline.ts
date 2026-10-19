import type { Article, ClassifiedArticle } from "./domain/article";
import type { Classifier } from "./domain/classifier";
import type { Result } from "./domain/result";

export const SUMMARY_FALLBACK =
	"⚠️ 要約の生成に失敗したため、要約なしで通知しています。リンク先をご確認ください。";

export const filterRecent = (
	articles: Article[],
	now: number = Date.now(),
): Article[] => {
	const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
	return articles.filter((article) => article.pubDate > twentyFourHoursAgo);
};

export type PipelineResult = {
	hotCount: number;
	digestArticles: Article[];
	errors: string[];
};

// 判定→要約→Hot通知を記事ごとに行う。
// 判定に失敗した記事はダイジェストへ、要約に失敗した記事は要約なしのHotとして通知し、通知から漏らさない。
export const processArticles = async (
	articles: Article[],
	classifier: Classifier,
	notify: (classified: ClassifiedArticle) => Promise<Result<void>>,
): Promise<PipelineResult> => {
	const errors: string[] = [];
	const digestArticles: Article[] = [];
	let hotCount = 0;

	for (const article of articles) {
		const judgeResult = await classifier.judgeIsHot(article);

		if (!judgeResult.success) {
			errors.push(judgeResult.error);
			digestArticles.push(article);
			continue;
		}
		if (judgeResult.data === false) {
			digestArticles.push(article);
			continue;
		}

		const summarizeResult = await classifier.summarize(article);

		let summary = SUMMARY_FALLBACK;
		if (summarizeResult.success) {
			summary = summarizeResult.data;
		} else {
			errors.push(summarizeResult.error);
		}

		const notifyResult = await notify({ article, summary });
		if (notifyResult.success) {
			hotCount++;
		} else {
			errors.push(notifyResult.error);
		}
	}

	return { hotCount, digestArticles, errors };
};

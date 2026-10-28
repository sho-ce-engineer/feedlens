import type {
	Article,
	ClassifiedArticle,
	DigestArticle,
} from "./domain/article";
import type { Classifier } from "./domain/classifier";
import type { Result } from "./domain/result";

export const summaryFallback =
	"⚠️ 要約の生成に失敗したため、要約なしで通知しています。リンク先をご確認ください。";

export const filterRecent = (
	articles: Article[],
	now: number = Date.now(),
): Article[] => {
	const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
	return articles.filter((article) => article.pubDate > twentyFourHoursAgo);
};

// エラーに処理名と記事のURLを付け、どの記事のどの処理で失敗したか分かるようにする
const withContext = (phase: string, article: Article, error: string): string =>
	`[${phase}] ${article.link} ${error}`;

export type PipelineResult = {
	hotCount: number;
	digestArticles: DigestArticle[];
	errors: string[];
};

// 判定→要約→Hot通知を記事ごとに行う。
// 判定に失敗した記事はダイジェストへ、要約に失敗した記事は要約なしのHotとして通知し、通知から漏らさない。
// 会員限定と判定された記事は、要約しても本文を読めないため、Hotにせずダイジェストへ回す。
export const processArticles = async (
	articles: Article[],
	classifier: Classifier,
	notify: (classified: ClassifiedArticle) => Promise<Result<void>>,
): Promise<PipelineResult> => {
	const errors: string[] = [];
	const digestArticles: DigestArticle[] = [];
	let hotCount = 0;

	for (const article of articles) {
		const judgeResult = await classifier.judgeIsHot(article);

		if (!judgeResult.success) {
			errors.push(withContext("判定", article, judgeResult.error));
			digestArticles.push({ article, isPaywalled: false });
			continue;
		}
		if (judgeResult.data === false) {
			digestArticles.push({ article, isPaywalled: false });
			continue;
		}

		const summarizeResult = await classifier.summarize(article);

		if (summarizeResult.success && summarizeResult.data.isPaywalled) {
			digestArticles.push({ article, isPaywalled: true });
			continue;
		}

		let summary = summaryFallback;
		if (summarizeResult.success) {
			summary = summarizeResult.data.summary;
		} else {
			errors.push(withContext("要約", article, summarizeResult.error));
		}

		const notifyResult = await notify({ article, summary });
		if (notifyResult.success) {
			hotCount++;
		} else {
			errors.push(withContext("Hot通知", article, notifyResult.error));
		}
	}

	return { hotCount, digestArticles, errors };
};

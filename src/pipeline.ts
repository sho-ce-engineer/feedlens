import { mapWithConcurrency } from "./concurrency";
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

type ClassifyOutcome =
	| { type: "digest"; digest: DigestArticle; errors: string[] }
	| { type: "hot"; classified: ClassifiedArticle; errors: string[] };

// 1記事を判定・要約し、Hot通知するかダイジェストに回すかを決める。
// 判定に失敗した記事はダイジェストへ、要約に失敗した記事は要約なしのHotとし、通知から漏らさない。
// 会員限定と判定された記事は、要約しても本文を読めないため、Hotにせずダイジェストへ回す。
const classifyArticle = async (
	article: Article,
	classifier: Classifier,
): Promise<ClassifyOutcome> => {
	const judgeResult = await classifier.judgeIsHot(article);

	if (!judgeResult.success) {
		return {
			type: "digest",
			digest: { article, isPaywalled: false },
			errors: [withContext("判定", article, judgeResult.error)],
		};
	}
	if (judgeResult.data === false) {
		return {
			type: "digest",
			digest: { article, isPaywalled: false },
			errors: [],
		};
	}

	const summarizeResult = await classifier.summarize(article);

	if (summarizeResult.success && summarizeResult.data.isPaywalled) {
		return {
			type: "digest",
			digest: { article, isPaywalled: true },
			errors: [],
		};
	}
	if (!summarizeResult.success) {
		return {
			type: "hot",
			classified: { article, summary: summaryFallback },
			errors: [withContext("要約", article, summarizeResult.error)],
		};
	}
	return {
		type: "hot",
		classified: { article, summary: summarizeResult.data.summary },
		errors: [],
	};
};

// 判定・要約(Geminiの呼び出し)は記事ごとに独立しているため、concurrency件まで並列に行う。
// Hot通知はDiscordのレート制限を避けるため、すべての判定・要約の後に元の記事の順で1件ずつ送る。
export const processArticles = async (
	articles: Article[],
	classifier: Classifier,
	notify: (classified: ClassifiedArticle) => Promise<Result<void>>,
	concurrency = 1,
): Promise<PipelineResult> => {
	const outcomes = await mapWithConcurrency(articles, concurrency, (article) =>
		classifyArticle(article, classifier),
	);

	const errors: string[] = [];
	const digestArticles: DigestArticle[] = [];
	let hotCount = 0;

	for (const outcome of outcomes) {
		errors.push(...outcome.errors);

		if (outcome.type === "digest") {
			digestArticles.push(outcome.digest);
			continue;
		}

		const notifyResult = await notify(outcome.classified);
		if (notifyResult.success) {
			hotCount++;
		} else {
			errors.push(
				withContext("Hot通知", outcome.classified.article, notifyResult.error),
			);
		}
	}

	return { hotCount, digestArticles, errors };
};

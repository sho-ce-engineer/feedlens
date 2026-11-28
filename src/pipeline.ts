import { mapWithConcurrency } from "./concurrency";
import {
	type Article,
	type Category,
	type ClassifiedArticle,
	categories,
} from "./domain/article";
import type { Classifier, HotJudgement } from "./domain/classifier";
import type { Result } from "./domain/result";

export const summaryFallback =
	"⚠️ 要約の生成に失敗したため、要約なしで通知しています。リンク先をご確認ください。";

export const categoryLimits: Record<Category, number> = {
	tech: 15,
	product: 5,
};

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

export type SelectionStats = {
	limit: number;
	candidates: number;
	cut: number;
	paywalled: number;
};

export type CategoryStats = SelectionStats & { notified: number };

export type Sections = Record<Category, ClassifiedArticle[]>;

export type PipelineResult = {
	sections: Sections;
	selection: Record<Category, SelectionStats>;
	judgeFailedCount: number;
	errors: string[];
};

type Candidate = { article: Article; judgement: HotJudgement };

const byRank = (a: Candidate, b: Candidate): number =>
	b.judgement.score - a.judgement.score ||
	b.article.pubDate.getTime() - a.article.pubDate.getTime();

type SummarizeOutcome =
	| { type: "paywalled"; errors: string[] }
	| { type: "ok"; classified: ClassifiedArticle; errors: string[] };

const summarizeCandidate = async (
	candidate: Candidate,
	classifier: Classifier,
): Promise<SummarizeOutcome> => {
	const { article, judgement } = candidate;
	const result = await classifier.summarize(article);

	if (result.success && result.data.isPaywalled) {
		return { type: "paywalled", errors: [] };
	}
	const base = {
		article,
		category: judgement.category,
		score: judgement.score,
	};
	if (!result.success) {
		return {
			type: "ok",
			classified: { ...base, summary: summaryFallback },
			errors: [withContext("要約", article, result.error)],
		};
	}
	return {
		type: "ok",
		classified: { ...base, summary: result.data.summary },
		errors: [],
	};
};

const selectCategory = async (
	candidates: Candidate[],
	limit: number,
	classifier: Classifier,
	concurrency: number,
): Promise<{
	selected: ClassifiedArticle[];
	stats: SelectionStats;
	errors: string[];
}> => {
	const selected: ClassifiedArticle[] = [];
	const errors: string[] = [];
	let paywalled = 0;
	let cursor = 0;

	while (selected.length < limit && cursor < candidates.length) {
		const batch = candidates.slice(cursor, cursor + (limit - selected.length));
		cursor += batch.length;
		const outcomes = await mapWithConcurrency(batch, concurrency, (c) =>
			summarizeCandidate(c, classifier),
		);
		for (const outcome of outcomes) {
			errors.push(...outcome.errors);
			if (outcome.type === "paywalled") {
				paywalled++;
			} else {
				selected.push(outcome.classified);
			}
		}
	}

	return {
		selected,
		stats: {
			limit,
			candidates: candidates.length,
			cut: candidates.length - cursor,
			paywalled,
		},
		errors,
	};
};

export const processArticles = async (
	articles: Article[],
	classifier: Classifier,
	concurrency = 1,
	limits: Record<Category, number> = categoryLimits,
): Promise<PipelineResult> => {
	const judged = await mapWithConcurrency(articles, concurrency, async (a) => ({
		article: a,
		result: await classifier.judge(a),
	}));

	const errors: string[] = [];
	let judgeFailedCount = 0;
	const candidates: Record<Category, Candidate[]> = { tech: [], product: [] };

	for (const { article, result } of judged) {
		if (!result.success) {
			judgeFailedCount++;
			errors.push(withContext("判定", article, result.error));
			continue;
		}
		if (!result.data.isHot) {
			continue;
		}
		candidates[result.data.category].push({
			article,
			judgement: result.data,
		});
	}

	const sections: Sections = { tech: [], product: [] };
	const selection = {} as Record<Category, SelectionStats>;

	// カテゴリを並列にすると、Geminiの同時呼び出し数がconcurrencyを超えてレート制限に当たる
	for (const category of categories) {
		const ranked = [...candidates[category]].sort(byRank);
		const result = await selectCategory(
			ranked,
			limits[category],
			classifier,
			concurrency,
		);
		sections[category] = result.selected;
		selection[category] = result.stats;
		errors.push(...result.errors);
	}

	return { sections, selection, judgeFailedCount, errors };
};

export type Sender = {
	heading: (category: Category, count: number) => Promise<Result<void>>;
	hot: (classified: ClassifiedArticle) => Promise<Result<void>>;
};

// Discordのレート制限を避けるため、1件ずつ送る
export const sendSections = async (
	sections: Sections,
	sender: Sender,
): Promise<{ notified: Record<Category, number>; errors: string[] }> => {
	const notified: Record<Category, number> = { tech: 0, product: 0 };
	const errors: string[] = [];

	for (const category of categories) {
		const items = sections[category];
		if (items.length === 0) {
			continue;
		}

		const headingResult = await sender.heading(category, items.length);
		if (!headingResult.success) {
			errors.push(`[見出し] ${category} ${headingResult.error}`);
		}

		for (const classified of items) {
			const result = await sender.hot(classified);
			if (result.success) {
				notified[category]++;
			} else {
				errors.push(withContext("Hot通知", classified.article, result.error));
			}
		}
	}

	return { notified, errors };
};

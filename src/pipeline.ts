import { mapWithConcurrency } from "./concurrency";
import {
	type Article,
	type Category,
	type ClassifiedArticle,
	categories,
} from "./domain/article";
import type { Classifier, Judgement } from "./domain/classifier";
import type { Result } from "./domain/result";

export const summaryFallback =
	"⚠️ 要約の生成に失敗したため、要約なしで通知しています。リンク先をご確認ください。";

// 通知する記事数の上限(カテゴリごと)。点数の高い順に、上限まで通知する
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

// カテゴリごとの絞り込みの結果。
// candidates: Hotと判定された数 / cut: 上限により要約・通知の対象にならなかった数 / paywalled: 会員限定で破棄した数
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

type Candidate = { article: Article; judgement: Judgement };

// 点数の高い順。同点なら公開日の新しい順
const byRank = (a: Candidate, b: Candidate): number =>
	b.judgement.score - a.judgement.score ||
	b.article.pubDate.getTime() - a.article.pubDate.getTime();

type SummarizeOutcome =
	| { type: "paywalled"; errors: string[] }
	| { type: "ok"; classified: ClassifiedArticle; errors: string[] };

// 1記事を要約する。要約に失敗した記事は要約なしで残し、通知から漏らさない。
// 会員限定と判定された記事は、本文を読めないため破棄する。
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

// 順位の高い候補から要約し、会員限定で破棄された分は次の候補で埋める。
// 上限に達するか、候補を使い切るまで続ける。
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

// 全記事を判定し、Hotをカテゴリ別に点数順へ並べ、上限まで要約する(通知はしない)。
// 判定に失敗した記事は通知せず、エラーとして記録する。
// 判定・要約(Geminiの呼び出し)は記事ごとに独立しているため、concurrency件まで並列に行う。
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

	// Geminiのレート制限を避けるため、カテゴリは順に処理する
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

// カテゴリごとに、見出し → 記事の順で1件ずつ送る(Discordのレート制限を避けるため)。
// 記事が無いカテゴリは見出しも送らない。
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

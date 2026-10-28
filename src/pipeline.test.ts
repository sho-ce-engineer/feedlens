import { describe, expect, test } from "bun:test";
import type { Article, ClassifiedArticle } from "./domain/article";
import type { Classifier, Summary } from "./domain/classifier";
import type { Result } from "./domain/result";
import { filterRecent, processArticles, summaryFallback } from "./pipeline";

const makeArticle = (i: number, pubDate: Date = new Date()): Article => ({
	title: `記事${i}`,
	link: `https://test.com/${i}`,
	guid: `guid-${i}`,
	pubDate,
	description: "説明文",
	sourceName: "テストメディア",
});

const ok = <T>(data: T): Result<T> => ({ success: true, data });
const ng = <T>(error: string): Result<T> => ({ success: false, error });

const makeClassifier = (
	judge: Result<boolean>,
	summarize: Result<Summary>,
): Classifier => ({
	judgeIsHot: async () => judge,
	summarize: async () => summarize,
});

describe("filterRecent", () => {
	const now = new Date("2026-01-02T00:00:00Z").getTime();

	test("24時間以内の記事のみ残す", () => {
		const recent = makeArticle(1, new Date("2026-01-01T12:00:00Z"));
		const old = makeArticle(2, new Date("2025-12-31T23:59:59Z"));
		expect(filterRecent([recent, old], now)).toEqual([recent]);
	});

	test("ちょうど24時間前の記事は除外する", () => {
		const boundary = makeArticle(1, new Date("2026-01-01T00:00:00Z"));
		expect(filterRecent([boundary], now)).toEqual([]);
	});
});

describe("processArticles", () => {
	test("Hotでない記事はダイジェストに振り分ける", async () => {
		const article = makeArticle(1);
		const notified: ClassifiedArticle[] = [];
		const result = await processArticles(
			[article],
			makeClassifier(ok(false), ok({ summary: "要約", isPaywalled: false })),
			async (c) => {
				notified.push(c);
				return ok(undefined);
			},
		);
		expect(result.digestArticles).toEqual([{ article, isPaywalled: false }]);
		expect(result.hotCount).toBe(0);
		expect(notified).toEqual([]);
		expect(result.errors).toEqual([]);
	});

	test("Hotの記事は要約付きで通知する", async () => {
		const article = makeArticle(1);
		const notified: ClassifiedArticle[] = [];
		const result = await processArticles(
			[article],
			makeClassifier(ok(true), ok({ summary: "要約", isPaywalled: false })),
			async (c) => {
				notified.push(c);
				return ok(undefined);
			},
		);
		expect(notified).toEqual([{ article, summary: "要約" }]);
		expect(result.hotCount).toBe(1);
		expect(result.digestArticles).toEqual([]);
	});

	test("判定に失敗した記事はダイジェストへフォールバックし、エラーを記録する", async () => {
		const article = makeArticle(1);
		const result = await processArticles(
			[article],
			makeClassifier(
				ng("judge failed"),
				ok({ summary: "要約", isPaywalled: false }),
			),
			async () => ok(undefined),
		);
		expect(result.digestArticles).toEqual([{ article, isPaywalled: false }]);
		expect(result.errors).toEqual(["[判定] https://test.com/1 judge failed"]);
		expect(result.hotCount).toBe(0);
	});

	test("要約に失敗した記事は要約なしのHotとして通知し、エラーを記録する", async () => {
		const article = makeArticle(1);
		const notified: ClassifiedArticle[] = [];
		const result = await processArticles(
			[article],
			makeClassifier(ok(true), ng("summarize failed")),
			async (c) => {
				notified.push(c);
				return ok(undefined);
			},
		);
		expect(notified).toEqual([{ article, summary: summaryFallback }]);
		expect(result.errors).toEqual([
			"[要約] https://test.com/1 summarize failed",
		]);
		expect(result.hotCount).toBe(1);
		expect(result.digestArticles).toEqual([]);
	});

	test("会員限定と判定された記事はHot通知せず、印を付けてダイジェストに回す", async () => {
		const article = makeArticle(1);
		const notified: ClassifiedArticle[] = [];
		const result = await processArticles(
			[article],
			makeClassifier(ok(true), ok({ summary: "要約", isPaywalled: true })),
			async (c) => {
				notified.push(c);
				return ok(undefined);
			},
		);
		expect(notified).toEqual([]);
		expect(result.hotCount).toBe(0);
		expect(result.digestArticles).toEqual([{ article, isPaywalled: true }]);
		expect(result.errors).toEqual([]);
	});

	test("Hotの通知に失敗した場合はhotCountに含めず、エラーを記録する", async () => {
		const result = await processArticles(
			[makeArticle(1)],
			makeClassifier(ok(true), ok({ summary: "要約", isPaywalled: false })),
			async () => ng("notify failed"),
		);
		expect(result.hotCount).toBe(0);
		expect(result.errors).toEqual([
			"[Hot通知] https://test.com/1 notify failed",
		]);
	});

	test("並列に判定しても、ダイジェストとHot通知は元の記事の順になる", async () => {
		const articles = [1, 2, 3, 4].map((i) => makeArticle(i));
		// 先頭の記事ほど判定に時間がかかり、後ろの記事から先に終わるようにする
		const delays = new Map(articles.map((a, i) => [a.link, (4 - i) * 10]));
		const classifier: Classifier = {
			judgeIsHot: async (article) => {
				await new Promise((r) => setTimeout(r, delays.get(article.link)));
				// 偶数番目はHot、奇数番目はダイジェスト
				return ok(article.link.endsWith("2") || article.link.endsWith("4"));
			},
			summarize: async (article) =>
				ok({ summary: `要約${article.title}`, isPaywalled: false }),
		};
		const notified: string[] = [];
		const result = await processArticles(
			articles,
			classifier,
			async (c) => {
				notified.push(c.article.link);
				return ok(undefined);
			},
			4,
		);
		expect(notified).toEqual(["https://test.com/2", "https://test.com/4"]);
		expect(result.digestArticles.map((d) => d.article.link)).toEqual([
			"https://test.com/1",
			"https://test.com/3",
		]);
		expect(result.hotCount).toBe(2);
	});
});

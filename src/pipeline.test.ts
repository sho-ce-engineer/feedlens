import { describe, expect, test } from "bun:test";
import type { Article, Category, ClassifiedArticle } from "./domain/article";
import type { Classifier, Judgement, Summary } from "./domain/classifier";
import type { Result } from "./domain/result";
import {
	filterRecent,
	processArticles,
	sendSections,
	summaryFallback,
} from "./pipeline";

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

const hot = (category: Category, score: number): Judgement => ({
	isHot: true,
	category,
	score,
});
const notHot: Judgement = { isHot: false };
const fine: Summary = { summary: "要約", isPaywalled: false };

const makeClassifier = (
	judgements: Record<string, Result<Judgement>>,
	summaries: Record<string, Result<Summary>> = {},
): Classifier => ({
	judge: async (article) => judgements[article.link] ?? ok(notHot),
	summarize: async (article) => summaries[article.link] ?? ok(fine),
});

const links = (items: ClassifiedArticle[]) => items.map((c) => c.article.link);

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
	test("Hotでない記事は通知対象にならない", async () => {
		const result = await processArticles(
			[makeArticle(1)],
			makeClassifier({ "https://test.com/1": ok(notHot) }),
		);
		expect(result.sections).toEqual({ tech: [], product: [] });
		expect(result.selection.tech.candidates).toBe(0);
		expect(result.errors).toEqual([]);
	});

	test("Hotの記事は、カテゴリ別に要約・点数付きで振り分ける", async () => {
		const a = makeArticle(1);
		const b = makeArticle(2);
		const result = await processArticles(
			[a, b],
			makeClassifier({
				"https://test.com/1": ok(hot("tech", 8)),
				"https://test.com/2": ok(hot("product", 6)),
			}),
		);
		expect(result.sections.tech).toEqual([
			{ article: a, summary: "要約", category: "tech", score: 8 },
		]);
		expect(result.sections.product).toEqual([
			{ article: b, summary: "要約", category: "product", score: 6 },
		]);
	});

	test("点数の高い順に並べ、同点は公開日の新しい順にする", async () => {
		const old = makeArticle(1, new Date("2026-01-01T00:00:00Z"));
		const recent = makeArticle(2, new Date("2026-01-01T12:00:00Z"));
		const high = makeArticle(3, new Date("2026-01-01T06:00:00Z"));
		const result = await processArticles(
			[old, recent, high],
			makeClassifier({
				"https://test.com/1": ok(hot("tech", 5)),
				"https://test.com/2": ok(hot("tech", 5)),
				"https://test.com/3": ok(hot("tech", 9)),
			}),
		);
		expect(links(result.sections.tech)).toEqual([
			"https://test.com/3",
			"https://test.com/2",
			"https://test.com/1",
		]);
	});

	test("上限を超えた分は省略し、省略した件数を数える", async () => {
		const articles = [1, 2, 3, 4, 5].map((i) => makeArticle(i));
		const judgements = Object.fromEntries(
			articles.map((a, i) => [a.link, ok(hot("tech", 10 - i))]),
		);
		const result = await processArticles(
			articles,
			makeClassifier(judgements),
			1,
			{ tech: 3, product: 5 },
		);
		expect(links(result.sections.tech)).toEqual([
			"https://test.com/1",
			"https://test.com/2",
			"https://test.com/3",
		]);
		expect(result.selection.tech).toEqual({
			limit: 3,
			candidates: 5,
			cut: 2,
			paywalled: 0,
		});
	});

	test("上限はカテゴリごとで、余った枠をもう一方に回さない", async () => {
		const articles = [1, 2, 3].map((i) => makeArticle(i));
		const result = await processArticles(
			articles,
			makeClassifier({
				"https://test.com/1": ok(hot("product", 9)),
				"https://test.com/2": ok(hot("product", 8)),
				"https://test.com/3": ok(hot("tech", 1)),
			}),
			1,
			{ tech: 5, product: 1 },
		);
		expect(links(result.sections.product)).toEqual(["https://test.com/1"]);
		expect(result.selection.product.cut).toBe(1);
		expect(links(result.sections.tech)).toEqual(["https://test.com/3"]);
		expect(result.selection.tech.cut).toBe(0);
	});

	test("上限に入らなかった記事は要約しない", async () => {
		const articles = [1, 2, 3].map((i) => makeArticle(i));
		const summarized: string[] = [];
		const classifier: Classifier = {
			judge: async (article) =>
				ok(hot("tech", 10 - Number(article.link.slice(-1)))),
			summarize: async (article) => {
				summarized.push(article.link);
				return ok(fine);
			},
		};
		await processArticles(articles, classifier, 1, { tech: 2, product: 5 });
		expect(summarized.sort()).toEqual([
			"https://test.com/1",
			"https://test.com/2",
		]);
	});

	test("会員限定の記事は破棄し、次の候補で枠を埋める", async () => {
		const articles = [1, 2, 3, 4].map((i) => makeArticle(i));
		const result = await processArticles(
			articles,
			makeClassifier(
				{
					"https://test.com/1": ok(hot("tech", 9)),
					"https://test.com/2": ok(hot("tech", 8)),
					"https://test.com/3": ok(hot("tech", 7)),
					"https://test.com/4": ok(hot("tech", 6)),
				},
				{ "https://test.com/1": ok({ summary: "要約", isPaywalled: true }) },
			),
			1,
			{ tech: 2, product: 5 },
		);
		expect(links(result.sections.tech)).toEqual([
			"https://test.com/2",
			"https://test.com/3",
		]);
		expect(result.selection.tech).toEqual({
			limit: 2,
			candidates: 4,
			cut: 1,
			paywalled: 1,
		});
		expect(result.errors).toEqual([]);
	});

	test("判定に失敗した記事は通知せず、エラーと件数を記録する", async () => {
		const result = await processArticles(
			[makeArticle(1)],
			makeClassifier({ "https://test.com/1": ng("judge failed") }),
		);
		expect(result.sections).toEqual({ tech: [], product: [] });
		expect(result.judgeFailedCount).toBe(1);
		expect(result.errors).toEqual(["[判定] https://test.com/1 judge failed"]);
	});

	test("要約に失敗した記事は要約なしで残し、エラーを記録する", async () => {
		const a = makeArticle(1);
		const result = await processArticles(
			[a],
			makeClassifier(
				{ "https://test.com/1": ok(hot("tech", 7)) },
				{ "https://test.com/1": ng("summarize failed") },
			),
		);
		expect(result.sections.tech).toEqual([
			{ article: a, summary: summaryFallback, category: "tech", score: 7 },
		]);
		expect(result.errors).toEqual([
			"[要約] https://test.com/1 summarize failed",
		]);
	});

	test("並列に判定しても、同じ結果になる", async () => {
		const articles = [1, 2, 3, 4].map((i) => makeArticle(i));
		// 先頭の記事ほど判定に時間がかかり、後ろの記事から先に終わるようにする
		const delays = new Map(articles.map((a, i) => [a.link, (4 - i) * 10]));
		const classifier: Classifier = {
			judge: async (article) => {
				await new Promise((r) => setTimeout(r, delays.get(article.link)));
				return ok(hot("tech", 10 - Number(article.link.slice(-1))));
			},
			summarize: async () => ok(fine),
		};
		const result = await processArticles(articles, classifier, 4);
		expect(links(result.sections.tech)).toEqual([
			"https://test.com/1",
			"https://test.com/2",
			"https://test.com/3",
			"https://test.com/4",
		]);
	});
});

describe("sendSections", () => {
	const classified = (i: number, category: Category): ClassifiedArticle => ({
		article: makeArticle(i),
		summary: "要約",
		category,
		score: 5,
	});

	test("カテゴリごとに、見出し → 記事の順で送る", async () => {
		const sent: string[] = [];
		const result = await sendSections(
			{
				tech: [classified(1, "tech"), classified(2, "tech")],
				product: [classified(3, "product")],
			},
			{
				heading: async (category, count) => {
					sent.push(`見出し:${category}:${count}`);
					return ok(undefined);
				},
				hot: async (c) => {
					sent.push(c.article.link);
					return ok(undefined);
				},
			},
		);
		expect(sent).toEqual([
			"見出し:tech:2",
			"https://test.com/1",
			"https://test.com/2",
			"見出し:product:1",
			"https://test.com/3",
		]);
		expect(result.notified).toEqual({ tech: 2, product: 1 });
		expect(result.errors).toEqual([]);
	});

	test("記事が無いカテゴリは、見出しも送らない", async () => {
		const headings: string[] = [];
		await sendSections(
			{ tech: [], product: [classified(1, "product")] },
			{
				heading: async (category) => {
					headings.push(category);
					return ok(undefined);
				},
				hot: async () => ok(undefined),
			},
		);
		expect(headings).toEqual(["product"]);
	});

	test("通知に失敗した記事は件数に含めず、エラーを記録する", async () => {
		const result = await sendSections(
			{ tech: [classified(1, "tech")], product: [] },
			{
				heading: async () => ok(undefined),
				hot: async () => ng("notify failed"),
			},
		);
		expect(result.notified.tech).toBe(0);
		expect(result.errors).toEqual([
			"[Hot通知] https://test.com/1 notify failed",
		]);
	});
});

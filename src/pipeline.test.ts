import { describe, expect, test } from "bun:test";
import type { Article, ClassifiedArticle } from "./domain/article";
import type { Classifier } from "./domain/classifier";
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
	summarize: Result<string>,
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
			makeClassifier(ok(false), ok("要約")),
			async (c) => {
				notified.push(c);
				return ok(undefined);
			},
		);
		expect(result.digestArticles).toEqual([article]);
		expect(notified).toEqual([]);
		expect(result.errors).toEqual([]);
	});

	test("Hotの記事は要約付きで通知する", async () => {
		const article = makeArticle(1);
		const notified: ClassifiedArticle[] = [];
		const result = await processArticles(
			[article],
			makeClassifier(ok(true), ok("要約")),
			async (c) => {
				notified.push(c);
				return ok(undefined);
			},
		);
		expect(notified).toEqual([{ article, summary: "要約" }]);
		expect(result.digestArticles).toEqual([]);
	});

	test("判定に失敗した記事はダイジェストへフォールバックし、エラーを記録する", async () => {
		const article = makeArticle(1);
		const result = await processArticles(
			[article],
			makeClassifier(ng("judge failed"), ok("要約")),
			async () => ok(undefined),
		);
		expect(result.digestArticles).toEqual([article]);
		expect(result.errors).toEqual(["judge failed"]);
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
		expect(result.errors).toEqual(["summarize failed"]);
		expect(result.digestArticles).toEqual([]);
	});

	test("Hotの通知に失敗した場合はエラーを記録する", async () => {
		const result = await processArticles(
			[makeArticle(1)],
			makeClassifier(ok(true), ok("要約")),
			async () => ng("notify failed"),
		);
		expect(result.errors).toEqual(["notify failed"]);
	});
});

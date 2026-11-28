import { describe, expect, test } from "bun:test";
import { dedupeArticles } from "./dedupe";
import type { Article } from "./domain/article";

const make = (link: string, sourceName = "媒体"): Article => ({
	title: `記事 ${link}`,
	link,
	guid: link,
	pubDate: new Date("2026-10-23T00:00:00Z"),
	description: "",
	sourceName,
});

describe("dedupeArticles", () => {
	test("正規化して同じURLの記事は、最初の1件だけ残す", () => {
		const first = make("https://example.com/a", "元の媒体");
		const second = make("https://example.com/a?utm_source=menthas", "集約");
		const third = make("https://example.com/a/#top", "別の集約");
		const other = make("https://example.com/b");

		const { unique, duplicateCount } = dedupeArticles([
			first,
			second,
			other,
			third,
		]);

		expect(unique).toEqual([first, other]);
		expect(duplicateCount).toBe(2);
	});

	test("重複が無ければ、そのまま返す", () => {
		const articles = [
			make("https://example.com/a"),
			make("https://example.com/b"),
		];
		const { unique, duplicateCount } = dedupeArticles(articles);
		expect(unique).toEqual(articles);
		expect(duplicateCount).toBe(0);
	});

	test("識別になるクエリが違う記事は、別の記事として残す", () => {
		const { unique, duplicateCount } = dedupeArticles([
			make("https://example.com/p?id=1"),
			make("https://example.com/p?id=2"),
		]);
		expect(unique.length).toBe(2);
		expect(duplicateCount).toBe(0);
	});

	test("空の配列を渡せる", () => {
		expect(dedupeArticles([])).toEqual({ unique: [], duplicateCount: 0 });
	});
});

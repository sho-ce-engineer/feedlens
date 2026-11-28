import { describe, expect, test } from "bun:test";
import { normalizeUrl } from "./url-normalize";

describe("normalizeUrl", () => {
	test("utm_* などの計測用クエリを除く", () => {
		expect(
			normalizeUrl("https://example.com/a?utm_source=rss&utm_medium=feed"),
		).toBe("https://example.com/a");
		expect(normalizeUrl("https://example.com/a?fbclid=xyz&gclid=1")).toBe(
			"https://example.com/a",
		);
	});

	test("フラグメントを除く", () => {
		expect(normalizeUrl("https://example.com/a#comments")).toBe(
			"https://example.com/a",
		);
	});

	test("末尾スラッシュを除く(ルートの / は残す)", () => {
		expect(normalizeUrl("https://example.com/a/")).toBe(
			"https://example.com/a",
		);
		expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
	});

	test("ホスト名の大文字小文字を揃える", () => {
		expect(normalizeUrl("https://Example.COM/a")).toBe("https://example.com/a");
	});

	test("記事の識別になりうるクエリは残し、並び順を揃える", () => {
		expect(normalizeUrl("https://example.com/p?id=123&utm_source=x")).toBe(
			"https://example.com/p?id=123",
		);
		expect(normalizeUrl("https://example.com/p?b=2&a=1")).toBe(
			normalizeUrl("https://example.com/p?a=1&b=2"),
		);
	});

	test("通常のURLは変えない", () => {
		expect(normalizeUrl("https://zenn.dev/foo/articles/abc")).toBe(
			"https://zenn.dev/foo/articles/abc",
		);
	});

	test("URLとして解釈できない文字列は、そのまま返す", () => {
		expect(normalizeUrl("not a url")).toBe("not a url");
		expect(normalizeUrl("")).toBe("");
	});
});

import { describe, expect, test } from "bun:test";
import { buildDigestMessages } from "./discord-notifier";
import type { Article } from "./domain/article";

const makeArticle = (
	i: number,
	titleOverride?: string,
	linkOverride?: string,
): Article => ({
	title: titleOverride ?? `記事タイトル${i}`,
	link: linkOverride ?? `https://test.com/${i}`,
	guid: `guid-${i}`,
	pubDate: new Date(),
	description: "テストの説明文です",
	sourceName: "テストwebメディア",
});

describe("buildDigestMessages", () => {
	test("記事が0件の場合、空の配列を返す", () => {
		expect(buildDigestMessages([])).toEqual([]);
	});

	test("記事が1件の場合、1件の配列を返す", () => {
		const testArticle = makeArticle(1, "テストのタイトル", "https://test.com");
		const result = buildDigestMessages([testArticle]);

		const firstMessage = result[0];
		if (!firstMessage) {
			throw new Error("テストの前提が崩れている: メッセージが1つも無い");
		}
		expect(firstMessage.length).toBe(1);

		const firstEmbed = firstMessage[0];
		if (!firstEmbed) {
			throw new Error("テストの前提が崩れている: embedが1つも無い");
		}
		expect(firstEmbed.fields).toEqual([
			{ name: "テストのタイトル", value: "https://test.com" },
		]);
		expect(firstEmbed.title).toMatch(/のダイジェスト\(1\/1\)$/);
	});

	test("記事が2〜3件の場合、1つのembedにまとまる", () => {
		const articles = [makeArticle(1), makeArticle(2), makeArticle(3)];
		const result = buildDigestMessages(articles);

		const firstMessage = result[0];
		if (!firstMessage) {
			throw new Error("テストの前提が崩れている: メッセージが1つも無い");
		}
		expect(firstMessage.length).toBe(1);

		const firstEmbed = firstMessage[0];
		if (!firstEmbed) {
			throw new Error("テストの前提が崩れている: embedが1つも無い");
		}
		expect(firstEmbed.fields.length).toBe(3);
		expect(firstEmbed.fields).toEqual([
			{ name: "記事タイトル1", value: "https://test.com/1" },
			{ name: "記事タイトル2", value: "https://test.com/2" },
			{ name: "記事タイトル3", value: "https://test.com/3" },
		]);
	});

	test("記事がちょうど25件の場合、1つのembedに収まる", () => {
		const articles = Array.from({ length: 25 }, (_, i) => makeArticle(i + 1));
		const result = buildDigestMessages(articles);

		const firstMessage = result[0];
		if (!firstMessage) {
			throw new Error("テストの前提が崩れている: メッセージが1つも無い");
		}
		expect(firstMessage.length).toBe(1);

		const firstEmbed = firstMessage[0];
		if (!firstEmbed) {
			throw new Error("テストの前提が崩れている: embedが1つも無い");
		}
		expect(firstEmbed.fields.length).toBe(25);
	});

	test("記事が26件の場合、2つのembedに分かれる(25件+1件)", () => {
		const articles = Array.from({ length: 26 }, (_, i) => makeArticle(i + 1));
		const result = buildDigestMessages(articles);

		const firstMessage = result[0];
		if (!firstMessage) {
			throw new Error("テストの前提が崩れている: メッセージが1つも無い");
		}
		expect(firstMessage.length).toBe(2);

		const [firstEmbed, secondEmbed] = firstMessage;
		if (!firstEmbed || !secondEmbed) {
			throw new Error("テストの前提が崩れている: embedが2つ無い");
		}
		expect(firstEmbed.fields.length).toBe(25);
		expect(secondEmbed.fields.length).toBe(1);
	});

	test("1件のfieldが極端に長い場合、25件に満たなくてもembedが分かれる", () => {
		const longTitle = "あ".repeat(300);
		const longLink = `https://test.com/${"a".repeat(1100)}`;
		const articles = Array.from({ length: 5 }, (_, i) =>
			makeArticle(i + 1, longTitle, longLink),
		);

		const result = buildDigestMessages(articles);

		// 2つのembedは、文字数上限の都合で別々のメッセージに分かれる
		expect(result.length).toBe(2);

		const [firstMessage, secondMessage] = result;
		if (!firstMessage || !secondMessage) {
			throw new Error("テストの前提が崩れている: メッセージが2つ無い");
		}
		expect(firstMessage.length).toBe(1);
		expect(firstMessage[0]?.fields.length).toBe(4);
		expect(secondMessage.length).toBe(1);
		expect(secondMessage[0]?.fields.length).toBe(1);
	});

	test("embedが11個生まれる場合、メッセージが2通に分かれる(10embed+1embed)", () => {
		// 文字数制限に触れないよう、あえて極端に短い文字列を使い、
		// 「25件ごとにembedが分かれる」という個数の境界だけを検証する
		const articles = Array.from({ length: 275 }, (_, i) =>
			makeArticle(i + 1, "a", "a"),
		);
		const result = buildDigestMessages(articles);

		expect(result.length).toBe(2);

		const [firstMessage, secondMessage] = result;
		if (!firstMessage || !secondMessage) {
			throw new Error("テストの前提が崩れている: メッセージが2つ無い");
		}
		expect(firstMessage.length).toBe(10);
		expect(secondMessage.length).toBe(1);

		const allEmbeds = [...firstMessage, ...secondMessage];
		expect(allEmbeds.length).toBe(11);
		for (const embed of allEmbeds) {
			expect(embed.fields.length).toBe(25);
		}
	});
});

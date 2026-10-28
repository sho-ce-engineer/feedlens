import { afterEach, describe, expect, test } from "bun:test";
import {
	buildDigestMessages,
	buildRunSummary,
	formatSource,
	postWebhook,
	type RunSummary,
} from "./discord-notifier";
import type { Article, DigestArticle } from "./domain/article";

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

const makeDigest = (
	i: number,
	titleOverride?: string,
	linkOverride?: string,
	isPaywalled = false,
): DigestArticle => ({
	article: makeArticle(i, titleOverride, linkOverride),
	isPaywalled,
});

describe("buildDigestMessages", () => {
	test("記事が0件の場合、空の配列を返す", () => {
		expect(buildDigestMessages([])).toEqual([]);
	});

	test("記事が1件の場合、1件の配列を返す", () => {
		const testArticle = makeDigest(1, "テストのタイトル", "https://test.com");
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
			{
				name: "テストのタイトル",
				value: "https://test.com\nテストwebメディア (test.com)",
			},
		]);
		expect(firstEmbed.title).toMatch(/のダイジェスト\(1\/1\)$/);
	});

	test("記事が2〜3件の場合、1つのembedにまとまる", () => {
		const articles = [makeDigest(1), makeDigest(2), makeDigest(3)];
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
			{
				name: "記事タイトル1",
				value: "https://test.com/1\nテストwebメディア (test.com)",
			},
			{
				name: "記事タイトル2",
				value: "https://test.com/2\nテストwebメディア (test.com)",
			},
			{
				name: "記事タイトル3",
				value: "https://test.com/3\nテストwebメディア (test.com)",
			},
		]);
	});

	test("記事がちょうど25件の場合、1つのembedに収まる", () => {
		const articles = Array.from({ length: 25 }, (_, i) => makeDigest(i + 1));
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
		const articles = Array.from({ length: 26 }, (_, i) => makeDigest(i + 1));
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
			makeDigest(i + 1, longTitle, longLink),
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
			makeDigest(i + 1, "a", "a"),
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

	test("会員限定の記事はタイトルの先頭に🔒 会員限定を付ける", () => {
		const result = buildDigestMessages([
			makeDigest(1, "有料記事", "https://test.com/1", true),
		]);
		expect(result[0]?.[0]?.fields[0]?.name).toBe("🔒 会員限定 有料記事");
	});
});

describe("formatSource", () => {
	test("媒体名とドメインを併記する", () => {
		expect(
			formatSource(makeArticle(1, "t", "https://news.example.com/a")),
		).toBe("テストwebメディア (news.example.com)");
	});

	test("媒体名が無い場合はドメインのみ", () => {
		const article = {
			...makeArticle(1, "t", "https://news.example.com/a"),
			sourceName: "",
		};
		expect(formatSource(article)).toBe("news.example.com");
	});

	test("リンクがURLとして解釈できない場合は媒体名のみ", () => {
		expect(formatSource(makeArticle(1, "t", "not a url"))).toBe(
			"テストwebメディア",
		);
	});
});

describe("postWebhook", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	const mockFetch = (responses: Response[]) => {
		let calls = 0;
		globalThis.fetch = (async () => {
			const res = responses[calls];
			calls++;
			if (!res) {
				throw new Error("想定外の呼び出し");
			}
			return res;
		}) as unknown as typeof fetch;
		return () => calls;
	};

	const rateLimited = () =>
		new Response("rate limited", {
			status: 429,
			headers: { "Retry-After": "0" },
		});

	test("成功時はsuccessを返す", async () => {
		const calls = mockFetch([new Response(null, { status: 204 })]);
		const result = await postWebhook("https://example.com", {}, "test");
		expect(result.success).toBe(true);
		expect(calls()).toBe(1);
	});

	test("429の場合は待機してリトライし、成功すればsuccessを返す", async () => {
		const calls = mockFetch([
			rateLimited(),
			rateLimited(),
			new Response(null, { status: 204 }),
		]);
		const result = await postWebhook("https://example.com", {}, "test");
		expect(result.success).toBe(true);
		expect(calls()).toBe(3);
	});

	test("429が続く場合は上限回数でエラーを返す", async () => {
		const calls = mockFetch([
			rateLimited(),
			rateLimited(),
			rateLimited(),
			rateLimited(),
		]);
		const result = await postWebhook("https://example.com", {}, "test");
		expect(result.success).toBe(false);
		expect(calls()).toBe(4);
	});

	test("Retry-Afterが無い場合はbodyのretry_afterに従ってリトライする", async () => {
		const calls = mockFetch([
			new Response(JSON.stringify({ retry_after: 0 }), { status: 429 }),
			new Response(null, { status: 204 }),
		]);
		const result = await postWebhook("https://example.com", {}, "test");
		expect(result.success).toBe(true);
		expect(calls()).toBe(2);
	});

	test("待機時間が上限を超える429はリトライせずエラーを返す", async () => {
		const calls = mockFetch([
			new Response("rate limited", {
				status: 429,
				headers: { "Retry-After": "60" },
			}),
		]);
		const result = await postWebhook("https://example.com", {}, "test");
		expect(result.success).toBe(false);
		expect(calls()).toBe(1);
	});

	test("429以外のエラーはリトライせずエラーを返す", async () => {
		const calls = mockFetch([new Response("bad", { status: 400 })]);
		const result = await postWebhook("https://example.com", {}, "test");
		expect(result.success).toBe(false);
		expect(calls()).toBe(1);
	});

	test("ネットワークエラーはエラーを返す", async () => {
		globalThis.fetch = (async () => {
			throw new Error("network down");
		}) as unknown as typeof fetch;
		const result = await postWebhook("https://example.com", {}, "test");
		expect(result).toEqual({
			success: false,
			error: "test:Network Error:network down",
		});
	});
});

describe("buildRunSummary", () => {
	const base: RunSummary = {
		feedCount: 17,
		fetchErrorCount: 1,
		parseErrorCount: 2,
		articleCount: 120,
		recentCount: 35,
		hotCount: 4,
		digestCount: 28,
		paywalledCount: 3,
		errors: [],
	};

	test("件数がサマリに含まれ、エラーが無ければエラー欄は出ない", () => {
		const text = buildRunSummary(base);
		expect(text).toContain("フィード: 17件(取得失敗 1件)");
		expect(text).toContain("直近24時間 35件");
		expect(text).toContain("Hot 4件 / ダイジェスト 28件(うち会員限定 3件)");
		expect(text).not.toContain("エラー");
	});

	test("エラーは件数と内容を表示し、10件を超えた分は省略する", () => {
		const errors = Array.from({ length: 12 }, (_, i) => `error-${i}`);
		const text = buildRunSummary({ ...base, errors });
		expect(text).toContain("⚠️ エラー 12件");
		expect(text).toContain("- error-9");
		expect(text).not.toContain("- error-10");
		expect(text).toContain("…ほか 2件");
	});

	test("長大なエラーでも2000文字以内に収まる", () => {
		const errors = Array.from({ length: 50 }, () => "x".repeat(5000));
		expect(buildRunSummary({ ...base, errors }).length).toBeLessThanOrEqual(
			2000,
		);
	});
});

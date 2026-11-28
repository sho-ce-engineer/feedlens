import { afterEach, describe, expect, test } from "bun:test";
import {
	buildHeading,
	buildHotPayload,
	buildRunSummary,
	formatSource,
	isMostlyCut,
	postWebhook,
	type RunSummary,
} from "./discord-notifier";
import type { Article } from "./domain/article";
import type { CategoryStats } from "./pipeline";

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

describe("buildHotPayload", () => {
	test("タイトル・リンク・要約と、出どころ・おすすめ度を含む", () => {
		const payload = buildHotPayload({
			article: makeArticle(1, "テストのタイトル", "https://test.com/a"),
			summary: "要約です",
			category: "tech",
			score: 8,
		});
		expect(payload.embeds).toEqual([
			{
				title: "テストのタイトル",
				url: "https://test.com/a",
				description: "要約です",
				footer: { text: "テストwebメディア (test.com) ・ おすすめ度 8/10" },
			},
		]);
	});
});

describe("buildHeading", () => {
	test("カテゴリ名と件数の見出しにする", () => {
		expect(buildHeading("tech", 15)).toBe("## 技術記事(15件)");
		expect(buildHeading("product", 5)).toBe("## 製品・ガジェット(5件)");
	});
});

const stats = (overrides: Partial<CategoryStats> = {}): CategoryStats => ({
	limit: 15,
	candidates: 20,
	cut: 5,
	paywalled: 0,
	notified: 15,
	...overrides,
});

describe("isMostlyCut", () => {
	test("候補の半数を超えて省略されているときだけtrue", () => {
		expect(isMostlyCut(stats({ candidates: 20, cut: 11 }))).toBe(true);
		expect(isMostlyCut(stats({ candidates: 20, cut: 10 }))).toBe(false);
		expect(isMostlyCut(stats({ candidates: 20, cut: 5 }))).toBe(false);
	});

	test("候補が0件ならfalse", () => {
		expect(isMostlyCut(stats({ candidates: 0, cut: 0 }))).toBe(false);
	});
});

describe("buildRunSummary", () => {
	const base: RunSummary = {
		feedCount: 17,
		fetchErrorCount: 1,
		parseErrorCount: 2,
		articleCount: 120,
		recentCount: 35,
		duplicateCount: 6,
		judgeFailedCount: 2,
		categories: {
			tech: stats({ limit: 15, candidates: 20, notified: 15, cut: 5 }),
			product: stats({
				limit: 5,
				candidates: 3,
				notified: 2,
				cut: 0,
				paywalled: 1,
			}),
		},
		errors: [],
	};

	test("件数がサマリに含まれ、エラーが無ければエラー欄は出ない", () => {
		const text = buildRunSummary(base);
		expect(text).toContain("フィード: 17件(取得失敗 1件)");
		expect(text).toContain("直近24時間 35件");
		expect(text).toContain("重複除外: 6件");
		expect(text).toContain("判定失敗: 2件");
		expect(text).not.toContain("エラー");
	});

	test("カテゴリごとに、Hot件数・通知数・上限で省略した数・会員限定の破棄数を出す", () => {
		const text = buildRunSummary(base);
		expect(text).toContain(
			"技術記事(上限15件): Hot 20件 → 通知 15件 / 上限で省略 5件 / 会員限定で破棄 0件",
		);
		expect(text).toContain(
			"製品・ガジェット(上限5件): Hot 3件 → 通知 2件 / 上限で省略 0件 / 会員限定で破棄 1件",
		);
	});

	test("省略が少なければ、見直しの警告は出ない", () => {
		expect(buildRunSummary(base)).not.toContain("見直しを検討");
	});

	test("候補の半数超が省略されたカテゴリは、見直しの警告を出す", () => {
		const text = buildRunSummary({
			...base,
			categories: {
				...base.categories,
				tech: stats({ limit: 15, candidates: 40, notified: 15, cut: 25 }),
			},
		});
		expect(text).toContain(
			"⚠️ 技術記事: Hot候補の半数超(25/40件)が上限で省略されています",
		);
		expect(text).not.toContain("⚠️ 製品・ガジェット");
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

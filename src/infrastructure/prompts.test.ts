import { describe, expect, test } from "bun:test";
import type { Article } from "../domain/article";
import type { Criteria } from "../domain/criteria";
import { buildJudgePrompt } from "./prompts";

const article: Article = {
	title: "テストタイトル",
	link: "https://test.com/1",
	guid: "guid-1",
	pubDate: new Date(),
	description: "テスト本文",
	sourceName: "テストメディア",
};

const criteria: Criteria = {
	themes: ["テーマA", "テーマB"],
	rejects: ["雑談", "炎上ネタ"],
};

describe("buildJudgePrompt", () => {
	test("テーマ・除外条件・記事情報がプロンプトに含まれる", () => {
		const prompt = buildJudgePrompt(article, criteria);
		expect(prompt).toContain("- テーマA\n- テーマB");
		expect(prompt).toContain("雑談・炎上ネタ");
		expect(prompt).toContain("タイトル: テストタイトル");
		expect(prompt).toContain("本文抜粋: テスト本文");
	});
});

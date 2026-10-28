import { describe, expect, test } from "bun:test";
import type { Article } from "../domain/article";
import type { Criteria } from "../domain/criteria";
import {
	buildJudgePrompt,
	descriptionLimit,
	truncateDescription,
} from "./prompts";

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

describe("truncateDescription", () => {
	test("上限以下の本文はそのまま返す", () => {
		const text = "あ".repeat(descriptionLimit);
		expect(truncateDescription(text)).toBe(text);
	});

	test("上限を超える本文は上限文字数で切り詰め、末尾に…を付ける", () => {
		const text = "あ".repeat(descriptionLimit + 1);
		expect(truncateDescription(text)).toBe(`${"あ".repeat(descriptionLimit)}…`);
	});

	test("判定プロンプトには切り詰めた本文が入る", () => {
		const prompt = buildJudgePrompt(
			{ ...article, description: "い".repeat(descriptionLimit + 500) },
			criteria,
		);
		expect(prompt).toContain(`本文抜粋: ${"い".repeat(descriptionLimit)}…`);
		expect(prompt).not.toContain("い".repeat(descriptionLimit + 1));
	});
});

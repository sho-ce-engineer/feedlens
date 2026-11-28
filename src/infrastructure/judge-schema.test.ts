import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { judgeResponseSchema, toJudgement } from "./gemini-classifier";

const parse = (value: unknown) => judgeResponseSchema.safeParse(value).success;

describe("judgeResponseSchema", () => {
	test("isHotがtrueなら、category・score(1〜10の整数)を受け付ける", () => {
		expect(parse({ isHot: true, category: "tech", score: 8 })).toBe(true);
		expect(parse({ isHot: true, category: "product", score: 1 })).toBe(true);
	});

	test("isHotがfalseなら、categoryとscoreが無くてもよい", () => {
		expect(parse({ isHot: false })).toBe(true);
	});

	test("範囲外・小数の点数と、未知のcategoryは受け付けない", () => {
		expect(parse({ isHot: true, category: "tech", score: 0 })).toBe(false);
		expect(parse({ isHot: true, category: "tech", score: 11 })).toBe(false);
		expect(parse({ isHot: true, category: "tech", score: 7.5 })).toBe(false);
		expect(parse({ isHot: true, category: "news", score: 5 })).toBe(false);
	});

	test("JSON Schemaに変換でき、isHotだけが必須になる", () => {
		const json = z.toJSONSchema(judgeResponseSchema) as {
			required?: string[];
		};
		expect(json.required).toEqual(["isHot"]);
	});
});

describe("toJudgement", () => {
	test("isHotがtrueなら、category・scoreを持つ判定にする", () => {
		expect(toJudgement({ isHot: true, category: "tech", score: 8 })).toEqual({
			success: true,
			data: { isHot: true, category: "tech", score: 8 },
		});
	});

	test("isHotがfalseなら、categoryやscoreが付いていても捨てる", () => {
		expect(toJudgement({ isHot: false, category: "tech", score: 3 })).toEqual({
			success: true,
			data: { isHot: false },
		});
	});

	test("isHotがtrueでcategoryまたはscoreが無ければ失敗にする", () => {
		expect(toJudgement({ isHot: true, score: 8 }).success).toBe(false);
		expect(toJudgement({ isHot: true, category: "tech" }).success).toBe(false);
	});
});

import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { judgeSchema } from "./gemini-classifier";

const parse = (value: unknown) => judgeSchema.safeParse(value).success;

describe("judgeSchema", () => {
	test("isHot・category・score(1〜10の整数)を受け付ける", () => {
		expect(parse({ isHot: true, category: "tech", score: 8 })).toBe(true);
		expect(parse({ isHot: true, category: "product", score: 1 })).toBe(true);
		expect(parse({ isHot: false, category: "tech", score: 10 })).toBe(true);
	});

	test("範囲外・小数の点数と、未知のcategoryは受け付けない", () => {
		expect(parse({ isHot: true, category: "tech", score: 0 })).toBe(false);
		expect(parse({ isHot: true, category: "tech", score: 11 })).toBe(false);
		expect(parse({ isHot: true, category: "tech", score: 7.5 })).toBe(false);
		expect(parse({ isHot: true, category: "news", score: 5 })).toBe(false);
	});

	test("JSON Schemaに変換できる(Geminiの構造化出力に渡せる)", () => {
		const json = JSON.stringify(z.toJSONSchema(judgeSchema));
		expect(json).toContain("category");
		expect(json).toContain("score");
	});
});

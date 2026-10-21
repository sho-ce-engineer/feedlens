import { describe, expect, test } from "bun:test";
import { hasPaywalledUrl } from "./gemini-classifier";

type Steps = Parameters<typeof hasPaywalledUrl>[0];

const urlContextResult = (...statuses: string[]) => ({
	type: "url_context_result",
	call_id: "call-1",
	result: statuses.map((status) => ({ url: "https://test.com", status })),
});

describe("hasPaywalledUrl", () => {
	test("stepsが無い場合はfalse", () => {
		expect(hasPaywalledUrl(undefined)).toBe(false);
	});

	test("url_contextの結果にpaywallがあればtrue", () => {
		const steps = [urlContextResult("success", "paywall")] as Steps;
		expect(hasPaywalledUrl(steps)).toBe(true);
	});

	test("url_contextの結果がsuccess・errorのみならfalse", () => {
		const steps = [urlContextResult("success", "error")] as Steps;
		expect(hasPaywalledUrl(steps)).toBe(false);
	});
});

import { describe, expect, test } from "bun:test";
import { mapWithConcurrency } from "./concurrency";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mapWithConcurrency", () => {
	test("結果を入力と同じ順で返す", async () => {
		// 後ろの要素ほど早く終わるようにしても、順序は入力どおりになる
		const result = await mapWithConcurrency([30, 20, 10], 3, async (ms) => {
			await sleep(ms);
			return ms * 2;
		});
		expect(result).toEqual([60, 40, 20]);
	});

	test("同時に実行するのはlimit件まで", async () => {
		let running = 0;
		let maxRunning = 0;
		await mapWithConcurrency(
			Array.from({ length: 10 }, (_, i) => i),
			3,
			async () => {
				running++;
				maxRunning = Math.max(maxRunning, running);
				await sleep(5);
				running--;
			},
		);
		expect(maxRunning).toBe(3);
	});

	test("空の配列は空の配列を返す", async () => {
		expect(await mapWithConcurrency([], 3, async (x) => x)).toEqual([]);
	});
});

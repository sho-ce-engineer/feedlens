// itemsの各要素にfnを適用する。同時に実行するのはlimit件までで、結果はitemsと同じ順で返す
export const mapWithConcurrency = async <T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> => {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	const worker = async () => {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await fn(items[index] as T);
		}
	};

	const workerCount = Math.max(1, Math.min(limit, items.length));
	await Promise.all(Array.from({ length: workerCount }, worker));
	return results;
};

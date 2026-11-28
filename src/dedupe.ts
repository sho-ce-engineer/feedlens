import type { Article } from "./domain/article";
import { normalizeUrl } from "./url-normalize";

// 正規化したURLが同じ記事を1件にまとめる。最初に現れた記事を残す。
export const dedupeArticles = (
	articles: Article[],
): { unique: Article[]; duplicateCount: number } => {
	const seen = new Set<string>();
	const unique: Article[] = [];

	for (const article of articles) {
		const key = normalizeUrl(article.link);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(article);
	}

	return { unique, duplicateCount: articles.length - unique.length };
};

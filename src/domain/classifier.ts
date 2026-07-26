import type { Article } from "./article";

type Result<T> = { success: true; data: T } | { success: false; error: string };

interface Classifier {
	judgeIsHot(article: Article): Promise<Result<boolean>>;
	summarize(article: Article): Promise<Result<string>>;
}

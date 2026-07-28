import type { Article } from "./article";

export type Result<T> =
	| { success: true; data: T }
	| { success: false; error: string };

export interface Classifier {
	judgeIsHot(article: Article): Promise<Result<boolean>>;
	summarize(article: Article): Promise<Result<string>>;
}

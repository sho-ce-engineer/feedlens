import type { Article } from "./article";
import type { Result } from "./result";

export interface Classifier {
	judgeIsHot(article: Article): Promise<Result<boolean>>;
	summarize(article: Article): Promise<Result<string>>;
}

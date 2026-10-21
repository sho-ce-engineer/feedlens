import type { Article } from "./article";
import type { Result } from "./result";

export type Summary = {
	summary: string;
	// 本文の閲覧に会員登録・ログイン・有料購読が必要な記事か
	isPaywalled: boolean;
};

export interface Classifier {
	judgeIsHot(article: Article): Promise<Result<boolean>>;
	summarize(article: Article): Promise<Result<Summary>>;
}

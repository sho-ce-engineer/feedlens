import type { Article, Category } from "./article";
import type { Result } from "./result";

export type Summary = {
	summary: string;
	// 本文の閲覧に会員登録・ログイン・有料購読が必要な記事か
	isPaywalled: boolean;
};

// 判定結果。isHotがfalseの記事では、categoryとscoreは使わない
export type Judgement = {
	isHot: boolean;
	category: Category;
	// 読むべき度合い(1〜10の整数。大きいほど読むべき)
	score: number;
};

export interface Classifier {
	judge(article: Article): Promise<Result<Judgement>>;
	summarize(article: Article): Promise<Result<Summary>>;
}

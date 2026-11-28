import type { Article, Category } from "./article";
import type { Result } from "./result";

export type Summary = {
	summary: string;
	// 本文の閲覧に会員登録・ログイン・有料購読が必要な記事か
	isPaywalled: boolean;
};

export type HotJudgement = {
	isHot: true;
	category: Category;
	// 1〜10の整数。大きいほど読むべき
	score: number;
};

export type Judgement = { isHot: false } | HotJudgement;

export interface Classifier {
	judge(article: Article): Promise<Result<Judgement>>;
	summarize(article: Article): Promise<Result<Summary>>;
}

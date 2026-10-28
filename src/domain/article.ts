import { z } from "zod";

//RSSから取得した記事
export const ArticleSchema = z.object({
	title: z.string(),
	link: z.string(),
	guid: z.string(),
	pubDate: z.coerce.date(),
	description: z.string(),
	sourceName: z.string(),
});

export type Article = z.infer<typeof ArticleSchema>;

export type ArticleError = {
	error: z.ZodError;
	siteName?: string;
	link?: string;
	pageName?: string;
	pageLink?: string;
	pageId?: string;
};

// 記事評価後
export const ClassifiedArticleSchema = z.object({
	article: ArticleSchema,
	summary: z.string(),
});

export type ClassifiedArticle = z.infer<typeof ClassifiedArticleSchema>;

// ダイジェストに載せる記事。会員限定と判定された記事は印を付けて表示する
export type DigestArticle = {
	article: Article;
	isPaywalled: boolean;
};

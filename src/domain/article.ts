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
export const ClassifieldArticleSchema = z.object({
	article: ArticleSchema,
	summary: z.string(),
});

export type ClassifiedArticle = z.infer<typeof ClassifieldArticleSchema>;

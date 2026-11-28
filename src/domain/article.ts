import { z } from "zod";

// 記事の種類。技術系(tech)と、製品の紹介・レビュー系(product)を分けて扱う
export const categories = ["tech", "product"] as const;
export const CategorySchema = z.enum(categories);
export type Category = z.infer<typeof CategorySchema>;

export const categoryLabels: Record<Category, string> = {
	tech: "技術記事",
	product: "製品・ガジェット",
};

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

// 記事評価後。categoryは記事の種類、scoreは「読むべき度合い」(1〜10)
export const ClassifiedArticleSchema = z.object({
	article: ArticleSchema,
	summary: z.string(),
	category: CategorySchema,
	score: z.number(),
});

export type ClassifiedArticle = z.infer<typeof ClassifiedArticleSchema>;

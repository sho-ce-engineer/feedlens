import type { Article } from "../domain/article";
import type { Criteria } from "../domain/criteria";

export const buildJudgePrompt = (
	article: Article,
	criteria: Criteria,
): string => {
	const themes = criteria.themes.map((theme) => `- ${theme}`).join("\n");
	const rejects = criteria.rejects.join("・");

	return `
あなたは、ジュニアエンジニアのキャリア形成に役立つ技術記事を選定するアシスタントです。
以下の記事が、次のいずれかのテーマに該当するか判定してください。

${themes}

該当するならisHotをtrue、${rejects}など上記に当てはまらない場合はfalseとしてください。

タイトル: ${article.title}
本文抜粋: ${article.description}`;
};

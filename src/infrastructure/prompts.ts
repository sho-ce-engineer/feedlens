import type { Article } from "../domain/article";
import type { Criteria } from "../domain/criteria";

// プロンプトに渡す本文抜粋の上限文字数。長い記事でトークンを浪費しないよう切り詰める
export const descriptionLimit = 1000;

export const truncateDescription = (description: string): string =>
	description.length > descriptionLimit
		? `${description.slice(0, descriptionLimit)}…`
		: description;

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

isHotがtrueの場合は、次の2つも出力してください。
- category: 開発・技術・業界動向・キャリア・学びに関する記事は"tech"、ガジェット・PC・周辺機器・サービスの製品紹介やレビューは"product"としてください。
- score: 読むべき度合いを1〜10の整数で付けてください。10=絶対に読むべき、7〜9=読む価値が高い、5〜6=標準的、3〜4=時間があれば読めばよい、1〜2=読まなくてよい。記事ごとに差が付くよう、同じ点数に偏らないでください。

isHotがfalseの場合は、categoryを"tech"、scoreを1としてください。

タイトル: ${article.title}
本文抜粋: ${truncateDescription(article.description)}`;
};

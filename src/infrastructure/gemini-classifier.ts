import { ApiError } from "@google/genai";
import * as z from "zod";
import { ai } from "../config";
import type { Article } from "../domain/article";
import type { Classifier, Result } from "../domain/classifier";

const model = "gemini-3.5-flash";

const isHotSchema = z.object({
	isHot: z.boolean(),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const callGemini = async (
	prompt: string,
	schema: z.ZodType,
	tools?: Parameters<typeof ai.interactions.create>[0]["tools"],
) => {
	return await ai.interactions.create({
		model: model,
		input: prompt,
		response_format: {
			type: "text",
			mime_type: "application/json",
			schema: z.toJSONSchema(schema),
		},
		tools: tools,
	});
};

const callGeminiWithRetry = async (
	prompt: string,
	schema: z.ZodType,
	tools?: Parameters<typeof ai.interactions.create>[0]["tools"],
): Promise<Result<Awaited<ReturnType<typeof callGemini>>>> => {
	let res: Awaited<ReturnType<typeof callGemini>>;
	try {
		res = await callGemini(prompt, schema, tools);
	} catch (error) {
		if (error instanceof ApiError && error.status === 429) {
			await sleep(60000);
			try {
				res = await callGemini(prompt, schema, tools);
			} catch (retryError) {
				return {
					success: false,
					error: `callGeminiWithRetry: retried once after rate limit, but failed again: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
				};
			}
		} else {
			return {
				success: false,
				error: `callGeminiWithRetry: Gemini API call failed with a non-retryable error: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}
	return {
		success: true,
		data: res,
	};
};

class GeminiClassifier implements Classifier {
	async judgeIsHot(article: Article): Promise<Result<boolean>> {
		const isHotPrompt = `
        あなたは、ジュニアエンジニアのキャリア形成に役立つ技術記事を選定するアシスタントです。
        以下の記事が、次のいずれかのテーマに該当するか判定してください。

        - ジュニアエンジニアが知っておくべき技術・業界の基礎知識
        - ジュニアエンジニアの成長に役立つ情報(勉強法、練習方法など）
        - AI時代のキャリア戦略
        - IT業界全般のキャッチアップに役立つ情報
        - IT技術全般のキャッチアップに役立つ情報

        該当するならisHotをtrue、雑談・炎上ネタ・個別サービスの障害報告など上記に当てはまらない場合はfalseとしてください。

        タイトル: ${article.title}
        本文抜粋: ${article.description}`;

		const callResult = await callGeminiWithRetry(isHotPrompt, isHotSchema);
		if (!callResult.success) {
			return { success: false, error: callResult.error };
		}
		const res = callResult.data;

		if (!res.output_text) {
			return {
				success: false,
				error: "judgeIsHot: Gemini response contained no output_text.",
			};
		}

		let output: ReturnType<typeof isHotSchema.safeParse>;

		try {
			output = isHotSchema.safeParse(JSON.parse(res.output_text));
		} catch {
			return {
				success: false,
				error: `judgeIsHot: failed to parse output_text as JSON: ${res.output_text}`,
			};
		}

		if (output.success === true) {
			return { success: true, data: output.data.isHot };
		} else {
			return { success: false, error: output.error.toString() };
		}
	}

	async summarize(article: Article): Promise<Result<string>> {
		// ここに中身
	}
}

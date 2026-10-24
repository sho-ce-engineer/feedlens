import * as z from "zod";
import criteriaJson from "../../criteria.json";
import { ai, geminiModel } from "../config";
import type { Article } from "../domain/article";
import type { Classifier } from "../domain/classifier";
import { CriteriaSchema } from "../domain/criteria";
import type { Result } from "../domain/result";
import { buildJudgePrompt } from "./prompts";

const criteria = CriteriaSchema.parse(criteriaJson);

const isHotSchema = z.object({
	isHot: z.boolean(),
});

const summarizeSchema = z.object({
	summarize: z.string(),
});

const isRateLimitError = (error: unknown): boolean => {
	const text = error instanceof Error ? error.message : String(error);
	return /429|RESOURCE_EXHAUSTED|rate limit|quota/i.test(text);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const callGemini = async (
	prompt: string,
	schema: z.ZodType,
	tools?: Parameters<typeof ai.interactions.create>[0]["tools"],
) => {
	return await ai.interactions.create({
		model: geminiModel,
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
		if (isRateLimitError(error)) {
			await sleep(60000);
			try {
				res = await callGemini(prompt, schema, tools);
			} catch (retryError) {
				// メッセージだけでは原因を特定できないことがあるため、エラーの詳細をログに残す
				console.error("Gemini API error detail:", retryError);
				return {
					success: false,
					error: `callGeminiWithRetry: retried once after rate limit, but failed again: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
				};
			}
		} else {
			console.error("Gemini API error detail:", error);
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

export class GeminiClassifier implements Classifier {
	async judgeIsHot(article: Article): Promise<Result<boolean>> {
		const isHotPrompt = buildJudgePrompt(article, criteria);

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
		const summarizePrompt = `
        あなたは、ジュニアエンジニアの情報収集を助けるアシスタントです。
        以下のURLの記事本文を読み、内容を要約してください。

        要約の目的は、読者がこの要約を読むだけである程度内容を把握でき、
        「これは本文まで読む価値がありそうだ」と感じた場合に記事へアクセスするかどうかを
        判断できるようにすることです。

        単なる一言コメントではなく、記事が何を伝えているのか具体的に分かる要約にしてください。

		また、おすすめ度をレーティングしてください。
		（例：これが基準→★★★☆☆、絶対読むべき→★★★★★、もしかしたら何かで役立つかも等→★☆☆☆☆）

        URL: ${article.link}
        タイトル: ${article.title}
        本文抜粋: ${article.description}
		
		もし”会員しか記事情報が取得できない記事”の場合は、どのRSSから取得したものか末尾に掲載してください。
		`;

		const callResult = await callGeminiWithRetry(
			summarizePrompt,
			summarizeSchema,
			[{ type: "url_context" }],
		);
		if (!callResult.success) {
			return { success: false, error: callResult.error };
		}
		const res = callResult.data;

		if (!res.output_text) {
			return {
				success: false,
				error: "summarize: Gemini response contained no output_text.",
			};
		}

		let output: ReturnType<typeof summarizeSchema.safeParse>;

		try {
			output = summarizeSchema.safeParse(JSON.parse(res.output_text));
		} catch {
			return {
				success: false,
				error: `summarize: failed to parse output_text as JSON: ${res.output_text}`,
			};
		}

		if (output.success === true) {
			return { success: true, data: output.data.summarize };
		} else {
			return { success: false, error: output.error.toString() };
		}
	}
}

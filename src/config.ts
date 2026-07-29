import { GoogleGenAI } from "@google/genai";

if (!process.env.GEMINI_API_KEY) {
	throw new Error("GEMINI_API_KEY is not set");
}

export const ai = new GoogleGenAI({
	apiKey: process.env.GEMINI_API_KEY,
});

if (!process.env.DISCORD_HOT_WEBHOOK_URL) {
	throw new Error("DISCORD_HOT_WEBHOOK_URL is not set");
}
export const hotNewsWebhookUrl = process.env.DISCORD_HOT_WEBHOOK_URL;

if (!process.env.DISCORD_DIGEST_WEBHOOK_URL) {
	throw new Error("DISCORD_DIGEST_WEBHOOK_URL is not set");
}
export const digestWebhookUrl = process.env.DISCORD_DIGEST_WEBHOOK_URL;

if (!process.env.GEMINI_MODEL) {
	throw new Error("GEMINI_MODEL is not set");
}
export const geminiModel = process.env.GEMINI_MODEL;

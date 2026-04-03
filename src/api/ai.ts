import { createOpenAI } from '@ai-sdk/openai';
import { generateText, streamText } from 'ai';
import { outputChannel } from '../logger';

/**
 * Updated to accept an Array of messages for context awareness.
 * Uses Vercel AI SDK.
 */
export async function openAIRequest(
    messages: any[],
    model: string,
    accessToken: string,
    temperature: number,
    baseUrl?: string
): Promise<{ content: string }> {

    const openai = createOpenAI({
        apiKey: accessToken,
        baseURL: baseUrl || undefined,
    });

    try {
        const { text } = await generateText({
            model: openai(model),
            messages: messages,
            temperature: temperature,
        });

        return { content: text };
    } catch (error) {
        outputChannel.appendLine("Error during OpenAI Request: " + error);
        throw error; // Rethrow so the caller knows it failed
    }
}

export async function openAIStreamRequest(
    messages: any[],
    model: string,
    accessToken: string,
    temperature: number,
    baseUrl?: string
) {
    const openai = createOpenAI({
        apiKey: accessToken,
        baseURL: baseUrl || undefined,
    });

    try {
        const result = await streamText({
            model: openai(model),
            messages: messages,
            temperature: temperature,
        });

        return result;
    } catch (error) {
        outputChannel.appendLine("Error during OpenAI Stream Request: " + error);
        throw error;
    }
}
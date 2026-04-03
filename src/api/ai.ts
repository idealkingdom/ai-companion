import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
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
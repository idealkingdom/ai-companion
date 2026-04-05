import { createOpenAI } from '@ai-sdk/openai';
import { generateText, streamText, stepCountIs } from 'ai';
import { outputChannel } from '../logger';

/**
 * Standard non-streaming request (no tools).
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
        baseURL: baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined,
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
        throw error;
    }
}

/**
 * Standard streaming request (no tools).
 */
export async function openAIStreamRequest(
    messages: any[],
    model: string,
    accessToken: string,
    temperature: number,
    baseUrl?: string
) {
    const openai = createOpenAI({
        apiKey: accessToken,
        baseURL: baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined,
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

/**
 * Agentic streaming request — injects tools and allows multi-step autonomous execution.
 * Uses AI SDK v6's stopWhen + stepCountIs for loop control.
 */
export async function openAIAgenticRequest(
    messages: any[],
    model: string,
    accessToken: string,
    temperature: number,
    tools: Record<string, any>,
    options: {
        maxSteps?: number;
        baseUrl?: string;
        onStepFinish?: (event: any) => void;
    } = {}
) {
    const openai = createOpenAI({
        apiKey: accessToken,
        baseURL: options.baseUrl && options.baseUrl.trim() !== '' ? options.baseUrl : undefined,
        compatibility: 'strict',
    } as any);

    outputChannel.appendLine(`[Agentic] Starting request: model=${model}, tools=${Object.keys(tools).join(',')}, maxSteps=${options.maxSteps || 15}`);
    outputChannel.appendLine(`[Agentic] API key present: ${!!accessToken && accessToken.length > 0}, key length: ${accessToken?.length || 0}`);
    outputChannel.appendLine(`[Agentic] Message count: ${messages.length}, baseUrl: ${options.baseUrl || '(default)'}`);

    try {
        const result = streamText({
            model: openai(model),
            messages: messages,
            tools: tools,
            stopWhen: stepCountIs(options.maxSteps || 15),
            temperature: temperature,
            onStepFinish: (event: any) => {
                outputChannel.appendLine(`[Agentic] Step finished. finishReason=${event.finishReason}, text length=${event.text?.length || 0}`);
                if (options.onStepFinish) {
                    options.onStepFinish(event);
                }
            },
            onError: (event: any) => {
                outputChannel.appendLine(`[Agentic] Stream error: ${event?.error?.message || event?.error || JSON.stringify(event)}`);
            },
            onFinish: (event: any) => {
                outputChannel.appendLine(`[Agentic] Finished. finishReason=${event.finishReason}, totalUsage=${JSON.stringify(event.totalUsage)}`);
            }
        });

        return result;
    } catch (error) {
        outputChannel.appendLine("Error during Agentic Request: " + error);
        throw error;
    }
}
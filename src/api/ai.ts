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
    baseUrl?: string,
    abortSignal?: AbortSignal
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
            abortSignal: abortSignal,
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
        abortSignal?: AbortSignal;
        enableThinking?: boolean;
        onReasoningChunk?: (text: string) => void;
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
        const streamOptions: any = {
            model: openai(model),
            messages: messages,
            tools: tools,
            stopWhen: stepCountIs(options.maxSteps || 15),
            temperature: temperature,
            abortSignal: options.abortSignal,
            onStepFinish: (event: any) => {
                outputChannel.appendLine(`[Agentic] Step finished. finishReason=${event.finishReason}, text length=${event.text?.length || 0}`);
                if (options.onStepFinish) {
                    options.onStepFinish(event);
                }
            },
            // #44: Capture reasoning chunks in real-time (for models that stream them)
            onChunk: ({ chunk }: any) => {
                if (chunk.type === 'reasoning-delta' || chunk.type === 'reasoning') {
                    const text = chunk.delta || chunk.text || '';
                    if (text && options.onReasoningChunk) {
                        options.onReasoningChunk(text);
                    }
                }
            },
            onError: (event: any) => {
                outputChannel.appendLine(`[Agentic] Stream error: ${event?.error?.message || event?.error || JSON.stringify(event)}`);
            },
            onFinish: (event: any) => {
                const reasoningLen = event.reasoningText?.length || 0;
                const stepsWithReasoning = event.steps?.filter((s: any) => s.reasoningText).length || 0;
                outputChannel.appendLine(`[Agentic] Finished. finishReason=${event.finishReason}, totalUsage=${JSON.stringify(event.totalUsage)}, reasoningTextLen=${reasoningLen}, stepsWithReasoning=${stepsWithReasoning}`);
            }
        };

        // #44: Enable reasoning/thinking tokens when supported
        if (options.enableThinking) {
            streamOptions.providerOptions = {
                openai: { reasoningEffort: 'medium', reasoningSummary: 'detailed' }
            };
            outputChannel.appendLine(`[Agentic] Thinking/reasoning enabled for model=${model}, providerOptions set`);
        } else {
            outputChannel.appendLine(`[Agentic] Thinking/reasoning DISABLED for model=${model}`);
        }

        const result = streamText(streamOptions);

        return result;
    } catch (error) {
        outputChannel.appendLine("Error during Agentic Request: " + error);
        throw error;
    }
}
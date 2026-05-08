import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, streamText, stepCountIs } from 'ai';
import { outputChannel } from '../logger';
import * as vscode from 'vscode';

// ─── HELPER: Resolve the correct AI SDK model instance ──────────────────────
// OpenAI, DeepSeek, Mistral, and any other OpenAI-compatible provider all use
// `createOpenAI` with a different `baseURL`.  Only Google Gemini uses a
// completely different SDK (`@ai-sdk/google`).

function resolveModel(provider: string, model: string, apiKey: string, baseUrl?: string, apiKeyHeader?: string) {
    if (provider === 'Gemini') {
        const google = createGoogleGenerativeAI({ 
            apiKey,
            baseURL: baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined
        });
        return google(model);
    }

    // All OpenAI-compatible providers (OpenAI, DeepSeek, Mistral, Custom, etc.)
    const opts: any = {
        baseURL: baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined,
    };

    // Custom header support: some providers use non-standard auth headers (e.g., x-api-key)
    if (apiKeyHeader && apiKeyHeader.trim()) {
        opts.apiKey = 'sk-placeholder'; // SDK requires a non-empty key
        opts.headers = { [apiKeyHeader.trim()]: apiKey };
    } else {
        opts.apiKey = apiKey;
    }

    const openai = createOpenAI(opts);
    return openai(model);
}

function resolveAgenticModel(provider: string, model: string, apiKey: string, baseUrl?: string, apiKeyHeader?: string) {
    if (provider === 'Gemini') {
        const google = createGoogleGenerativeAI({ 
            apiKey,
            baseURL: baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined
        });
        return google(model);
    }

    // OpenAI-compat with strict compatibility for tool calling
    const opts: any = {
        baseURL: baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined,
        compatibility: 'strict',
    };

    if (apiKeyHeader && apiKeyHeader.trim()) {
        opts.apiKey = 'sk-placeholder';
        opts.headers = { [apiKeyHeader.trim()]: apiKey };
    } else {
        opts.apiKey = apiKey;
    }

    const openai = createOpenAI(opts);
    return openai(model);
}

// ─── PUBLIC API ─────────────────────────────────────────────────────────────

/**
 * Standard non-streaming request (no tools).
 */
export async function aiRequest(
    messages: any[],
    model: string,
    accessToken: string,
    temperature: number,
    provider: string,
    baseUrl?: string,
    apiKeyHeader?: string
): Promise<{ content: string }> {

    const resolvedModel = resolveModel(provider, model, accessToken, baseUrl, apiKeyHeader);

    try {
        const { text } = await generateText({
            model: resolvedModel,
            messages: messages,
            temperature: temperature,
        });

        return { content: text };
    } catch (error) {
        outputChannel.appendLine("Error during AI Request: " + error);
        throw error;
    }
}

/**
 * Standard streaming request (no tools).
 */
export async function aiStreamRequest(
    messages: any[],
    model: string,
    accessToken: string,
    temperature: number,
    provider: string,
    baseUrl?: string,
    abortSignal?: AbortSignal,
    apiKeyHeader?: string,
    onFinish?: (event: any) => void
) {
    const resolvedModel = resolveModel(provider, model, accessToken, baseUrl, apiKeyHeader);

    try {
        const result = await streamText({
            model: resolvedModel,
            messages: messages,
            temperature: temperature,
            abortSignal: abortSignal,
            onFinish: onFinish,
        });

        return result;
    } catch (error) {
        outputChannel.appendLine("Error during AI Stream Request: " + error);
        throw error;
    }
}

/**
 * Agentic streaming request — injects tools and allows multi-step autonomous execution.
 * Uses AI SDK v6's stopWhen + stepCountIs for loop control.
 * 
 * Works with ALL providers: OpenAI, DeepSeek, Mistral, Gemini, Custom.
 */
export async function aiAgenticRequest(
    messages: any[],
    model: string,
    accessToken: string,
    temperature: number,
    provider: string,
    tools: Record<string, any>,
    options: {
        maxSteps?: number;
        baseUrl?: string;
        onStepFinish?: (event: any) => void;
        abortSignal?: AbortSignal;
        enableThinking?: boolean;
        onReasoningChunk?: (text: string) => void;
        apiKeyHeader?: string;
        onFinish?: (event: any) => void;
    } = {}
) {
    const resolvedModel = resolveAgenticModel(provider, model, accessToken, options.baseUrl, options.apiKeyHeader);

    outputChannel.appendLine(`[Agentic] Starting request: provider=${provider}, model=${model}, tools=${Object.keys(tools).join(',')}, maxSteps=${options.maxSteps || 15}`);
    outputChannel.appendLine(`[Agentic] API key present: ${!!accessToken && accessToken.length > 0}, key length: ${accessToken?.length || 0}`);
    outputChannel.appendLine(`[Agentic] Message count: ${messages.length}, baseUrl: ${options.baseUrl || '(default)'}`);

    try {
        const streamOptions: any = {
            model: resolvedModel,
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
                const errObj = event?.error;
                const errMsgs = [
                    errObj?.message,
                    errObj?.cause?.message,
                    typeof errObj === 'string' ? errObj : JSON.stringify(errObj)
                ].filter(Boolean).join(' | ');

                outputChannel.appendLine(`[Agentic] Stream error: ${errMsgs}`);

                // Notification for quota or billing issues
                const lowerMsg = errMsgs.toLowerCase();
                if (lowerMsg.includes('quota') || lowerMsg.includes('429') || lowerMsg.includes('insufficient_quota') || lowerMsg.includes('billing')) {
                    vscode.window.showErrorMessage('AI API Error: You may have exceeded your quota or rate limit. Please check your API billing details.');
                }
            },
            onFinish: (event: any) => {
                if (options.onFinish) { options.onFinish(event); }
                const reasoningLen = event.reasoningText?.length || 0;
                const stepsWithReasoning = event.steps?.filter((s: any) => s.reasoningText).length || 0;
                outputChannel.appendLine(`[Agentic] Finished. finishReason=${event.finishReason}, totalUsage=${JSON.stringify(event.usage || event.totalUsage)}, reasoningTextLen=${reasoningLen}, stepsWithReasoning=${stepsWithReasoning}`);
            }
        };

        // #44: Enable reasoning/thinking tokens when supported
        if (options.enableThinking) {
            if (provider === 'Gemini') {
                // Google Gemini: thinkingBudget -1 = dynamic/auto (model decides)
                // 0 would DISABLE thinking entirely. -1 lets the model use its own judgment.
                streamOptions.providerOptions = {
                    google: { thinkingConfig: { thinkingBudget: -1 } }
                };
            } else {
                // OpenAI-compatible providers
                streamOptions.providerOptions = {
                    openai: { reasoningEffort: 'medium', reasoningSummary: 'detailed' }
                };
            }
            outputChannel.appendLine(`[Agentic] Thinking/reasoning enabled for provider=${provider}, model=${model}`);
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

// ─── BACKWARD-COMPAT ALIASES ────────────────────────────────────────────────
// These ensure existing callers don't break during migration.

export const openAIRequest = (
    messages: any[], model: string, accessToken: string, temperature: number, baseUrl?: string
) => aiRequest(messages, model, accessToken, temperature, 'OpenAI', baseUrl);

export const openAIStreamRequest = (
    messages: any[], model: string, accessToken: string, temperature: number, baseUrl?: string, abortSignal?: AbortSignal, onFinish?: (event: any) => void
) => aiStreamRequest(messages, model, accessToken, temperature, 'OpenAI', baseUrl, abortSignal, undefined, onFinish);

export const openAIAgenticRequest = (
    messages: any[], model: string, accessToken: string, temperature: number,
    tools: Record<string, any>, options: any = {}
) => aiAgenticRequest(messages, model, accessToken, temperature, 'OpenAI', tools, options);
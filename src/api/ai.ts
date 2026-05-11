import { createOpenAI } from '@ai-sdk/openai';
import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText, streamText, stepCountIs } from 'ai';
import { outputChannel } from '../logger';
import * as vscode from 'vscode';

// ─── HELPER: Resolve the correct AI SDK model instance ──────────────────────
// OpenAI, DeepSeek, Mistral, and any other OpenAI-compatible provider all use
// `createOpenAI` with a different `baseURL`.  Only Google Gemini uses a
// completely different SDK (`@ai-sdk/google`).  Azure OpenAI uses `@ai-sdk/azure`
// which natively handles api-key headers and Chat Completions format.

function resolveModel(provider: string, model: string, apiKey: string, baseUrl?: string, apiKeyHeader?: string, azureStyle?: boolean) {
    if (provider === 'Gemini') {
        const google = createGoogleGenerativeAI({ 
            apiKey,
            baseURL: baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined
        });
        return google(model);
    }

    // Azure OpenAI — use the official @ai-sdk/azure provider
    if (provider === 'Azure OpenAI' || azureStyle === true) {
        return resolveAzureModel(model, apiKey, baseUrl);
    }

    // All OpenAI-compatible providers (OpenAI, DeepSeek, Mistral, Custom, etc.)
    const opts: any = {
        baseURL: baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined,
    };

    // Custom header support: some providers use non-standard auth headers
    if (apiKeyHeader && apiKeyHeader.trim()) {
        opts.apiKey = 'sk-placeholder'; // SDK requires a non-empty key
        opts.headers = { [apiKeyHeader.trim()]: apiKey };
    } else {
        opts.apiKey = apiKey;
    }

    const openai = createOpenAI(opts);
    return openai(model);
}

/**
 * Azure OpenAI model resolution using @ai-sdk/azure.
 * Uses Chat Completions API natively — sends `messages` format, `api-key` header,
 * and does NOT include `model` in the request body.
 *
 * The fetch interceptor redirects the SDK's constructed URL
 * ({baseURL}/v1/chat/completions) back to the user's exact endpoint,
 * since corporate gateways route by URL path, not API path conventions.
 */
function resolveAzureModel(model: string, apiKey: string, baseUrl?: string) {
    const azure = createAzure({
        apiKey,
        baseURL: baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined,
        apiVersion: '',  // Not used by corporate gateways
        fetch: createAzureGatewayFetch(baseUrl),
    });
    return azure.chat(model);
}

/**
 * Creates a fetch interceptor for Azure-style corporate API gateways.
 * The SDK constructs URLs like {baseURL}/v1/chat/completions?api-version=...
 * but corporate gateways expect the request at the base URL directly.
 */
function createAzureGatewayFetch(baseUrl?: string) {
    return async (url: string | Request | URL, requestInit?: any) => {
        // Redirect to the user's exact endpoint URL
        const targetUrl = baseUrl || url.toString();
        return fetch(targetUrl, requestInit);
    };
}

function resolveAgenticModel(provider: string, model: string, apiKey: string, baseUrl?: string, apiKeyHeader?: string, azureStyle?: boolean) {
    if (provider === 'Gemini') {
        const google = createGoogleGenerativeAI({ 
            apiKey,
            baseURL: baseUrl && baseUrl.trim() !== '' ? baseUrl : undefined
        });
        return google(model);
    }

    // Azure OpenAI — use the official @ai-sdk/azure provider
    if (provider === 'Azure OpenAI' || azureStyle === true) {
        return resolveAzureModel(model, apiKey, baseUrl);
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
    apiKeyHeader?: string,
    azureStyle?: boolean
): Promise<{ content: string }> {

    const resolvedModel = resolveModel(provider, model, accessToken, baseUrl, apiKeyHeader, azureStyle);

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
    onFinish?: (event: any) => void,
    azureStyle?: boolean
) {
    const resolvedModel = resolveModel(provider, model, accessToken, baseUrl, apiKeyHeader, azureStyle);

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
        azureStyle?: boolean;
    } = {}
) {
    const resolvedModel = resolveAgenticModel(provider, model, accessToken, options.baseUrl, options.apiKeyHeader, options.azureStyle);

    outputChannel.appendLine(`[Agentic] Starting request: provider=${provider}, model=${model}, tools=${Object.keys(tools).join(',')}, maxSteps=${options.maxSteps || 15}`);
    outputChannel.appendLine(`[Agentic] API key present: ${!!accessToken && accessToken.length > 0}, key length: ${accessToken?.length || 0}`);
    outputChannel.appendLine(`[Agentic] Message count: ${messages.length}, baseUrl: ${options.baseUrl || '(default)'}`);

    const MAX_RETRIES = 3;
    const RETRY_DELAYS_MS = [1000, 2000, 4000]; // exponential backoff

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const streamOptions: any = {
                model: resolvedModel,
                messages: messages,
                tools: tools,
                stopWhen: stepCountIs(options.maxSteps || 15),
                temperature: temperature,
                abortSignal: options.abortSignal,
                maxRetries: 0, // disable SDK instant retries — we handle retries ourselves
                onStepFinish: (event: any) => {
                    outputChannel.appendLine(`[Agentic] Step finished. finishReason=${event.finishReason}, text length=${event.text?.length || 0}`);
                    if (options.onStepFinish) {
                        options.onStepFinish(event);
                    }
                },
                // #44: Capture reasoning chunks in real-time (for models that stream them)
                onChunk: ({ chunk }: any) => {
                    // Diagnostic: log chunk types for debugging
                    if (chunk.type !== 'text-delta' && chunk.type !== 'raw') {
                        outputChannel.appendLine(`[AI:onChunk] chunk.type=${chunk.type}`);
                    }
                    if (chunk.type === 'reasoning-delta' || chunk.type === 'reasoning') {
                        const text = chunk.delta || chunk.text || '';
                        outputChannel.appendLine(`[AI:onChunk] Reasoning text: "${(text || '').substring(0, 40)}"`);
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
                    // Detect Gemini model generation for correct thinking config
                    const isGemini3x = model.includes('gemini-3');
                    outputChannel.appendLine(`[Agentic] Gemini model detection: model="${model}", isGemini3x=${isGemini3x}`);
                    
                    if (isGemini3x) {
                        // Gemini 3.x: just enable thought visibility, let the model decide depth
                        streamOptions.providerOptions = {
                            google: { 
                                thinkingConfig: { 
                                    includeThoughts: true
                                } 
                            }
                        };
                    } else {
                        // Gemini 2.5 and earlier: thinkingBudget -1 = dynamic/auto
                        streamOptions.providerOptions = {
                            google: { thinkingConfig: { thinkingBudget: -1 } }
                        };
                    }
                } else {
                    // OpenAI-compatible providers
                    streamOptions.providerOptions = {
                        openai: { reasoningEffort: 'medium', reasoningSummary: 'detailed' }
                    };
                }
                outputChannel.appendLine(`[Agentic] Thinking ENABLED: provider=${provider}, model=${model}, providerOptions=${JSON.stringify(streamOptions.providerOptions)}`);
            } else {
                outputChannel.appendLine(`[Agentic] Thinking DISABLED for model=${model}`);
            }

            const result = streamText(streamOptions);
            return result;

        } catch (error: any) {
            // Don't retry if aborted by user
            if (options.abortSignal?.aborted) {
                throw error;
            }

            const isLastAttempt = attempt >= MAX_RETRIES;
            const errorMsg = error?.message || String(error);
            outputChannel.appendLine(`[Agentic] Attempt ${attempt}/${MAX_RETRIES} failed: ${errorMsg}`);

            if (isLastAttempt) {
                outputChannel.appendLine(`[Agentic] All ${MAX_RETRIES} attempts exhausted.`);
                throw error;
            }

            // Only retry on transient server errors (5xx) or rate limits (429)
            const isTransient = error?.statusCode >= 500 || error?.statusCode === 429
                || errorMsg.includes('500') || errorMsg.includes('503') || errorMsg.includes('429')
                || errorMsg.includes('Internal error') || errorMsg.includes('overloaded');

            if (!isTransient) {
                outputChannel.appendLine(`[Agentic] Non-retryable error (${error?.statusCode || 'unknown status'}), giving up.`);
                throw error;
            }

            const delayMs = RETRY_DELAYS_MS[attempt - 1];
            outputChannel.appendLine(`[Agentic] Retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
            await new Promise(r => setTimeout(r, delayMs));
        }
    }

    // Should never reach here
    throw new Error('Unexpected: retry loop exited without result or error');
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
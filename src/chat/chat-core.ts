import * as vscode from 'vscode';
import * as os from 'os';
import { openAIRequest, openAIStreamRequest, openAIAgenticRequest } from '../api/ai';
import { outputChannel } from '../logger';
import { ROLE } from '../chat/chat-constants';
import { ChatHistoryService } from './chat-history';
import * as crypto from 'crypto';
import { ImageStorageService } from './image-storage';
import { ImageDescriptionService } from './image-description-service';
import { SettingsManager } from '../services/settings-manager';
import { WorkspaceIndexService } from '../services/workspace-index';
import { createToolRegistry } from '../tools/tool-registry';
import { handleInlineReview } from './chat-message-listener';
import { ReviewManager } from './review-manager';
import { ApprovalService } from './approval-service';

/**
 * #52 — Collects system information so the agent knows which commands to run.
 * Kept compact to minimize token usage.
 */
function getSystemInfo(): string {
    const platform = os.platform(); // 'linux', 'darwin', 'win32'
    const osName = platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux';
    const arch = os.arch();
    const shell = process.env.SHELL || process.env.COMSPEC || (platform === 'win32' ? 'cmd.exe' : '/bin/bash');
    const nodeVersion = process.version;
    const vsCodeVersion = vscode.version;
    const homeDir = os.homedir();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'unknown';
    const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || 'unknown';

    return `--- SYSTEM INFO ---
OS: ${osName} (${arch})
Shell: ${shell}
Node.js: ${nodeVersion}
VS Code: ${vsCodeVersion}
Home: ${homeDir}
Workspace: ${workspaceName} → ${workspaceRoot}`;
}

export interface AgentStepEvent {
    type: 'tool_call' | 'tool_result' | 'thinking' | 'text_chunk';
    toolName?: string;
    args?: any;
    result?: any;
    text?: string;
    toolCallId?: string;
    approvalRequired?: boolean;
    diffReviewRequired?: boolean;
}

export class ChatCoreService {

    private workspaceIndex: WorkspaceIndexService;
    private static activeAbortControllers: Map<string, AbortController> = new Map();

    constructor(
        private readonly historyService: ChatHistoryService,
        private readonly imageService: ImageStorageService,
        private readonly settingsManager: SettingsManager,
        private readonly descriptionService: ImageDescriptionService = new ImageDescriptionService(settingsManager)
    ) {
        this.workspaceIndex = new WorkspaceIndexService();
    }

    /**
     * Helper to generate a new Chat ID uuid v4
     */
    public generateChatID(): string {
        return crypto.randomUUID();
    }
    /**
     * Cancel ongoing AI generation
     */
    public cancelChatRequest(chatId: string): boolean {
        const controller = ChatCoreService.activeAbortControllers.get(chatId);
        if (controller) {
            controller.abort();
            ChatCoreService.activeAbortControllers.delete(chatId);
            ApprovalService.getInstance().clearAllApprovals();
            outputChannel.appendLine(`[ChatCore] Cancelled request for chatId=${chatId} and flushed pending approvals.`);
            return true;
        }
        return false;
    }
    /**
     * Processes the user's message:
     * 1. Saves Images to Disk (Hybrid Storage)
     * 2. Saves User Message to History (with file paths)
     * 3. Calls AI API (with Base64 images)
     * 4. Saves AI Message to History
     */
    public async processChatRequest(data: {
        message: string,
        chat_id: string,
        timestamp: string,
        files?: any[],
        images?: any[],
        agentId?: string
    }, onChunk?: (text: string) => void,
       onAgentStep?: (step: AgentStepEvent) => void): Promise<{ text: string, usage?: any }> {

        const hasImages = data.images && Array.isArray(data.images) && data.images.length > 0;

        // 1. GET SETTINGS
        const appSettings = this.settingsManager.getSettings();

        // #49: Use smart defaults instead of user-configurable temperature/context
        const maxContext = (appSettings.general as any)?.maxContextMessages ?? 20;
        const currentProvider = appSettings.models.provider;
        const pSettings = appSettings.models.providerSettings?.[currentProvider] || {};
        const accessToken = pSettings.apiKey || '';
        const temperature = 0.7; // Smart default

        let aiResponseText = "";
        let totalUsage: any = null;

        const abortController = new AbortController();
        ChatCoreService.activeAbortControllers.set(data.chat_id, abortController);

        try {
            // --- STEP A: HANDLE IMAGES ---
            const storedImageFilenames: string[] = [];
            const storedImageDescriptions: string[] = [];
            const aiImagePayload: any[] = [];

            if (hasImages) {
                const descriptionPromises = data.images!.map(async (img) => {
                    const fileName = await this.imageService.saveImage(img.dataUrl);
                    storedImageFilenames.push(fileName);
                    const desc = await this.descriptionService.describeImage(img.dataUrl);
                    storedImageDescriptions.push(desc);
                    aiImagePayload.push({
                        type: "image",
                        image: new URL(img.dataUrl)
                    });
                });
                await Promise.all(descriptionPromises);
            }

            // --- STEP B: SAVE USER MESSAGE TO HISTORY ---
            await this.historyService.addMessage(
                data.chat_id, ROLE.USER, data.message,
                storedImageFilenames, storedImageDescriptions,
                data.agentId
            );

            // --- STEP C: PREPARE API PAYLOAD ---
            const contextMessages = this.historyService.getContextWindow(data.chat_id, maxContext);

            let currentMessageContent: any;
            if (hasImages) {
                currentMessageContent = [
                    { type: "text", text: data.message },
                    ...aiImagePayload
                ];
            } else {
                currentMessageContent = data.message;
            }

            // Remove last user message from context (we append it with multimodal support)
            if (contextMessages.length > 0 && contextMessages[contextMessages.length - 1].role === 'user') {
                contextMessages.pop();
            }

            const configModel = appSettings.models.provider;
            const isVisionCapable = (configModel === 'OpenAI' || !configModel) && hasImages;

            let targetModel: string = 'gpt-4o-mini';
            let finalContextMessages = [...contextMessages];
            let finalCurrentMessage: any = currentMessageContent;

            if (hasImages) {
                if (isVisionCapable) {
                    targetModel = appSettings.models.imageModel || 'gpt-4o-mini';
                } else {
                    const descriptionContext = storedImageDescriptions.map((d, i) => `[Image ${i + 1} Description: ${d}]`).join("\n");
                    finalCurrentMessage = `${data.message}\n\n${descriptionContext}`;
                }
            } else {
                targetModel = appSettings.models.textModel || 'gpt-4o';
            }

            // Resolve API key and base URL from provider-specific settings
            const activeProvider = appSettings.models.provider || 'OpenAI';
            const providerConfig = appSettings.models.providerSettings?.[activeProvider];
            const apiBaseUrl = providerConfig?.baseUrl || '';
            const apiKey = providerConfig?.apiKey || '';

            outputChannel.appendLine(`[ChatCore] Provider=${activeProvider}, model=${targetModel}, hasApiKey=${!!apiKey}, baseUrl=${apiBaseUrl || '(default)'}`);


            // ─── DETERMINE MODE: AGENTIC vs STANDARD ────────────────────────
            const isAgenticMode = this.isAgenticAgent(data.agentId, appSettings);

            if (isAgenticMode) {
                const response = await this.processAgenticRequest(
                    data, finalContextMessages, finalCurrentMessage,
                    targetModel, apiKey || accessToken, temperature, apiBaseUrl,
                    appSettings, onChunk, onAgentStep, abortController.signal
                );
                aiResponseText = response.text;
                totalUsage = response.usage;
            } else {
                const response = await this.processStandardRequest(
                    data, finalContextMessages, finalCurrentMessage,
                    targetModel, apiKey || accessToken, temperature, apiBaseUrl,
                    appSettings, onChunk, abortController.signal
                );
                aiResponseText = response.text;
                totalUsage = response.usage;
            }

            // --- STEP E: SAVE AI RESPONSE ---
            await this.historyService.addMessage(data.chat_id, ROLE.BOT, aiResponseText);
            outputChannel.appendLine("Chat interaction saved and processed.");

        } catch (error: any) {
            if (abortController.signal.aborted) {
                outputChannel.appendLine(`[ChatCore] Request explicitly aborted by user for chatId=${data.chat_id}`);
                aiResponseText = '*Agent stopped.*';
                if (onAgentStep) {
                    onAgentStep({ type: 'thinking', text: '🛑 Agent stopped by user' } as any);
                }
                if (onChunk) { onChunk('\n\n*Agent stopped.*'); }
            } else {
                console.error('Error fetching chat response:', error);
                outputChannel.appendLine('[ChatCore] Error: ' + (error?.message || error));
                aiResponseText = 'Sorry, I could not process your request at this time. Error: ' + (error?.message || 'Unknown error');
                if (onChunk) { onChunk(aiResponseText); }
            }
            await this.historyService.addMessage(data.chat_id, ROLE.BOT, aiResponseText);
        } finally {
            ChatCoreService.activeAbortControllers.delete(data.chat_id);
        }

        return { text: aiResponseText, usage: totalUsage };
    }

    /**
     * Determine if the selected agent profile is agentic mode.
     * Agents with names containing "architect" or "planner" or the explicit agentId !== 'default'
     * are treated as agentic when tools are available.
     */
    private isAgenticAgent(agentId: string | undefined, settings: any): boolean {
        if (!agentId || agentId === 'default') { return false; }

        const agent = settings.prompts.find((p: any) => p.id === agentId);
        if (!agent) { return false; }

        // All non-default agents run in agentic mode
        return true;
    }

    /**
     * Standard sequential prompt pipeline (existing behavior).
     */
    private async processStandardRequest(
        data: any, contextMessages: any[], currentMessage: any,
        model: string, apiKey: string, temperature: number, baseUrl: string,
        settings: any, onChunk?: (text: string) => void, abortSignal?: AbortSignal
    ): Promise<{ text: string, usage?: any }> {

        // Default Chat uses the global system prompt + system info (#52)
        const systemPrompt = settings.general?.systemPrompt || "You are an expert AI assistant.";
        const systemInfo = getSystemInfo();
        const fullSystemPrompt = `${systemPrompt}\n\n${systemInfo}`;
        const steps = [{ content: fullSystemPrompt }];

        let pipelineContext = currentMessage;
        let aiResponseText = "";
        let totalUsage: any = null;
        const isO1 = model.startsWith('o1');
        const requestTemperature = isO1 ? 1 : temperature;

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const isLastStep = i === steps.length - 1;

            const apiPayload = [
                { role: 'system', content: (step as any).content || step },
                ...contextMessages,
                { role: 'user', content: pipelineContext }
            ];

            if (isLastStep && onChunk) {
                const result = await openAIStreamRequest(
                    apiPayload, model, apiKey, requestTemperature, baseUrl, abortSignal
                );
                let fullText = '';
                for await (const chunk of result.textStream) {
                    if (abortSignal && abortSignal.aborted) {
                        throw new Error('AbortError');
                    }
                    fullText += chunk;
                    onChunk(chunk);
                }
                const usage = await result.usage;
                pipelineContext = fullText;
                aiResponseText = fullText;
                totalUsage = usage;
            } else {
                const response = await openAIRequest(
                    apiPayload, model, apiKey, requestTemperature, baseUrl
                );
                pipelineContext = response.content;
                aiResponseText = response.content;
            }
        }

        return { text: aiResponseText, usage: totalUsage };
    }

    /**
     * 🔥 AGENTIC pipeline — the AI autonomously calls tools in a loop.
     */
    private async processAgenticRequest(
        data: any, contextMessages: any[], currentMessage: any,
        model: string, apiKey: string, temperature: number, baseUrl: string,
        settings: any, onChunk?: (text: string) => void,
        onAgentStep?: (step: AgentStepEvent) => void,
        abortSignal?: AbortSignal
    ): Promise<{ text: string, usage?: any }> {
        ReviewManager.getInstance().startTurn();

        // Resolve the agent's system prompt
        const agent = (settings.prompts || []).find((p: any) => p.id === data.agentId);
        const systemPrompt = agent?.content || settings.general?.systemPrompt || "You are an expert AI assistant.";

        outputChannel.appendLine(`[Agentic] Agent=${data.agentId}, model=${model}, agentName=${agent?.name}`);

        // Build the workspace-aware system prompt with system info (#52)
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'unknown';
        const systemInfo = getSystemInfo();
        
        // #50: Task tracking prompt (when enabled)
        const todoInstruction = settings.general?.enableTodoList
            ? `\n\nTASK TRACKING:
When handling complex multi-step requests, create a task checklist at the start.
Format each item as: ⬜ [task description]
As you complete each task, update it to: ✅ [task description]
Show the updated checklist after each step so the user can track progress.`
            : '';

        // #51: Include workspace file tree in context
        await this.workspaceIndex.refresh();
        const fileTree = this.workspaceIndex.getFileTreeString();
        // Cap the tree to avoid blowing up the context window
        const maxTreeChars = 3000;
        const truncatedTree = fileTree.length > maxTreeChars
            ? fileTree.substring(0, maxTreeChars) + '\n... (truncated, use list_workspace for full tree)'
            : fileTree;

        const agenticSystemPrompt = `${systemPrompt}

${systemInfo}

--- WORKSPACE FILE TREE ---
${truncatedTree}

--- AGENT CONTEXT ---
You have access to tools to read, search, and modify files in the user's workspace.
Workspace root: ${workspaceRoot}

WORKFLOW:
1. Use list_workspace or find_symbol to understand the project structure
2. Use read_file_skeleton to get an overview of relevant files (don't read full files unnecessarily)
3. Use read_line_range to examine specific sections you need
4. Use chunk_replace to make surgical edits (provide exact target text)
5. Use search_workspace to find patterns across the codebase
6. Use run_command for builds, tests, git operations

RULES:
- NEVER read an entire large file. Use skeleton first, then line ranges.
- When editing, provide the EXACT target text to replace (including whitespace).
- Always verify your changes compile after editing.
- Edits are applied DIRECTLY to the file. The user can review changes inline and revert if needed.${todoInstruction}`;

        // Build payload
        const messages = [
            { role: 'system' as const, content: agenticSystemPrompt },
            ...this.compactMessages(contextMessages),
            { role: 'user' as const, content: currentMessage }
        ];

        // Create tool registry
        const tools = createToolRegistry(this.workspaceIndex, {
            abortSignal: abortSignal,
            readFilesConfirmation: settings.permissions?.readFilesConfirmation ?? false,
            writeFilesConfirmation: settings.permissions?.writeFilesConfirmation ?? true,
            runCommandsConfirmation: settings.permissions?.runCommandsConfirmation ?? true,
            onApprovalRequest: async (toolCallId, toolName, args, opts) => {
                if (abortSignal?.aborted) return;
                if (onAgentStep) {
                    onAgentStep({
                        type: 'tool_call' as any,
                        toolName,
                        args,
                        approvalRequired: true,
                        diffReviewRequired: opts.diffReviewRequired,
                        toolCallId
                    } as any);

                    // --- LIVE EDIT: Trigger inline review immediately ---
                    if (opts.diffReviewRequired) {
                        try {
                            await handleInlineReview(toolCallId, toolName, args);
                        } catch (e) {
                            outputChannel.appendLine(`[Agentic] Failed to trigger Live Edit: ${e}`);
                        }
                    }
                }
            }
        });

        outputChannel.appendLine(`[Agentic] Tool names: ${Object.keys(tools).join(', ')}`);
        outputChannel.appendLine(`[Agentic] Messages count: ${messages.length}`);

        // Lower temperature for agent mode precision
        const agentTemp = Math.min(temperature, 0.3);

        let stepCount = 0;

        try {
            const result = await openAIAgenticRequest(
                messages, model, apiKey, agentTemp, tools,
                {
                    maxSteps: 15,
                    baseUrl: baseUrl,
                    abortSignal: abortSignal,
                    enableThinking: settings.general?.enableThinking !== false,
                    onStepFinish: (event: any) => {
                        if (abortSignal?.aborted) return;
                        stepCount++;
                        outputChannel.appendLine(`[Agentic] Step ${stepCount} finished`);

                        // Stream tool activity to frontend
                        // AI SDK v6: event has 'toolCalls' array and 'toolResults' array
                        if (onAgentStep && event.toolCalls && event.toolCalls.length > 0) {
                            for (const tc of event.toolCalls) {
                                onAgentStep({
                                    type: 'tool_call',
                                    toolName: tc.toolName,
                                    args: tc.args,
                                    toolCallId: tc.toolCallId // CRITICAL FIX
                                });
                            }
                        }

                        if (onAgentStep && event.toolResults && event.toolResults.length > 0) {
                            for (const tr of event.toolResults) {
                                onAgentStep({
                                    type: 'tool_result',
                                    toolName: tr.toolName,
                                    result: this.summarizeToolResult(tr.result),
                                    toolCallId: tr.toolCallId // CRITICAL FIX
                                });
                            }
                        }
                    }
                }
            );

            // Consume the full stream to get ALL events (text + tools + errors)
            let fullText = '';
            for await (const part of result.fullStream) {
                if (abortSignal && abortSignal.aborted) {
                    throw new Error('AbortError');
                }
                if (part.type === 'text-delta') {
                    fullText += part.text;
                    if (onChunk) { onChunk(part.text); }
                } else if (part.type === 'reasoning-delta' || (part as any).type === 'reasoning') {
                    // #44: AI SDK fullStream reasoning-delta has 'delta' property (not 'text')
                    const reasoningText = (part as any).delta || (part as any).text || (part as any).reasoning || '';
                    if (reasoningText && onAgentStep) {
                        onAgentStep({
                            type: 'thinking',
                            text: reasoningText
                        });
                    }
                } else if (part.type === 'reasoning-end') {
                    outputChannel.appendLine(`[Agentic] Reasoning block ended`);
                } else if (part.type === 'error') {
                    outputChannel.appendLine(`[Agentic] Stream error part: ${part.error}`);
                } else if (part.type === 'tool-call') {
                    outputChannel.appendLine(`[Agentic] Tool call: ${(part as any).toolName}`);
                } else if (part.type === 'tool-result') {
                    outputChannel.appendLine(`[Agentic] Tool result received for: ${(part as any).toolName}`);
                } else if (part.type === 'finish') {
                    outputChannel.appendLine(`[Agentic] Stream finish: reason=${part.finishReason}`);
                } else if (part.type === 'start-step') {
                    outputChannel.appendLine(`[Agentic] Step started`);
                } else if (part.type === 'finish-step') {
                    outputChannel.appendLine(`[Agentic] Step finished: reason=${part.finishReason}, usage=${JSON.stringify(part.usage)}`);
                } else {
                    // Debug: log unknown part types so we can catch new ones
                    outputChannel.appendLine(`[Agentic] Unknown stream part type: ${(part as any).type}`);
                }
            }

            outputChannel.appendLine(`[Agentic] Completed in ${stepCount} steps, response length: ${fullText.length}`);

            // Send completion step event
            if (onAgentStep) {
                onAgentStep({
                    type: 'thinking',
                    text: `Agent completed in ${stepCount} steps.`
                });
            }

            // If model returned empty text, provide a fallback
            if (!fullText || fullText.trim() === '') {
                fullText = '(Agent completed but produced no text response. The model may not support tool calling with this configuration.)';
                if (onChunk) { onChunk(fullText); }
            }

            const usage = await result.usage;
            return { text: fullText, usage };
        } catch (error: any) {
            if (abortSignal?.aborted) {
                throw error; // Let the top-level catch handle the cancellation gracefully
            }
            outputChannel.appendLine(`[Agentic] ERROR: ${error?.message || error}`);
            const errorMsg = `Agent error: ${error?.message || 'Unknown error'}`;
            if (onAgentStep) {
                onAgentStep({ type: 'thinking', text: `❌ ${errorMsg}` });
            }
            throw error;
        }
    }

    /**
     * Ephemeral Memory Compaction: Truncate large tool results from older messages.
     * Also deduplicates system prompts (#47) to save context tokens.
     */
    private compactMessages(messages: any[]): any[] {
        const seenSystemContents = new Set<string>();
        return messages
            .filter((msg) => {
                // #47: Deduplicate system messages — keep only the first occurrence
                if (msg.role === 'system') {
                    const key = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                    if (seenSystemContents.has(key)) {
                        return false; // Remove duplicate system prompt
                    }
                    seenSystemContents.add(key);
                }
                return true;
            })
            .map((msg, idx, arr) => {
                // Only compact messages that aren't the last 2 (keep recent context fresh)
                if (idx < arr.length - 2 && msg.role === 'tool' && msg.content) {
                    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                    if (content.length > 500) {
                        return {
                            ...msg,
                            content: '[Tool output condensed for memory efficiency — ' + content.length + ' chars]'
                        };
                    }
                }
                return msg;
            });
    }

    /**
     * Summarize a tool result for the frontend telemetry
     */
    private summarizeToolResult(result: any): any {
        if (!result) { return result; }

        const str = typeof result === 'string' ? result : JSON.stringify(result);
        if (str.length > 300) {
            return str.substring(0, 300) + '...';
        }
        return result;
    }
}
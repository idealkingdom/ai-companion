import * as vscode from 'vscode';
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

export interface AgentStepEvent {
    type: 'tool_call' | 'tool_result' | 'thinking' | 'text_chunk';
    toolName?: string;
    args?: any;
    result?: any;
    text?: string;
}

export class ChatCoreService {

    private workspaceIndex: WorkspaceIndexService;

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
       onAgentStep?: (step: AgentStepEvent) => void): Promise<string> {

        const hasImages = data.images && Array.isArray(data.images) && data.images.length > 0;

        // 1. GET SETTINGS
        const appSettings = this.settingsManager.getSettings();

        const maxContext = appSettings.general.maxContextMessages;
        const accessToken = appSettings.models.apiKey;
        const temperature = appSettings.general.temperature;

        let aiResponseText = "";

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
                storedImageFilenames, storedImageDescriptions
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
            const apiBaseUrl = appSettings.models.baseUrl || providerConfig?.baseUrl || '';
            const apiKey = appSettings.models.apiKey || providerConfig?.apiKey || '';

            outputChannel.appendLine(`[ChatCore] Provider=${activeProvider}, model=${targetModel}, hasApiKey=${!!apiKey}, baseUrl=${apiBaseUrl || '(default)'}`);


            // ─── DETERMINE MODE: AGENTIC vs STANDARD ────────────────────────
            const isAgenticMode = this.isAgenticAgent(data.agentId, appSettings);

            if (isAgenticMode) {
                aiResponseText = await this.processAgenticRequest(
                    data, finalContextMessages, finalCurrentMessage,
                    targetModel, apiKey || accessToken, temperature, apiBaseUrl,
                    appSettings, onChunk, onAgentStep
                );
            } else {
                aiResponseText = await this.processStandardRequest(
                    data, finalContextMessages, finalCurrentMessage,
                    targetModel, apiKey || accessToken, temperature, apiBaseUrl,
                    appSettings, onChunk
                );
            }

            // --- STEP E: SAVE AI RESPONSE ---
            await this.historyService.addMessage(data.chat_id, ROLE.BOT, aiResponseText);
            outputChannel.appendLine("Chat interaction saved and processed.");

        } catch (error: any) {
            console.error('Error fetching chat response:', error);
            outputChannel.appendLine('[ChatCore] Error: ' + (error?.message || error));
            aiResponseText = 'Sorry, I could not process your request at this time. Error: ' + (error?.message || 'Unknown error');
            // Send error as a chunk so the UI updates
            if (onChunk) { onChunk(aiResponseText); }
            await this.historyService.addMessage(data.chat_id, ROLE.BOT, aiResponseText);
        }

        return aiResponseText;
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
        settings: any, onChunk?: (text: string) => void
    ): Promise<string> {

        let steps: any[] = [];

        // Active prompt sequence or system prompt
        const activePrompts = settings.prompts
            .filter((p: any) => p.isActive)
            .sort((a: any, b: any) => a.order - b.order);
        steps = activePrompts.length > 0
            ? activePrompts
            : [{ content: settings.general.systemPrompt || "You are an expert AI assistant." }];

        let pipelineContext = currentMessage;
        let aiResponseText = "";
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
                    apiPayload, model, apiKey, requestTemperature, baseUrl
                );
                let fullText = '';
                for await (const chunk of result.textStream) {
                    fullText += chunk;
                    onChunk(chunk);
                }
                pipelineContext = fullText;
                aiResponseText = fullText;
            } else {
                const response = await openAIRequest(
                    apiPayload, model, apiKey, requestTemperature, baseUrl
                );
                pipelineContext = response.content;
                aiResponseText = response.content;
            }
        }

        return aiResponseText;
    }

    /**
     * 🔥 AGENTIC pipeline — the AI autonomously calls tools in a loop.
     */
    private async processAgenticRequest(
        data: any, contextMessages: any[], currentMessage: any,
        model: string, apiKey: string, temperature: number, baseUrl: string,
        settings: any, onChunk?: (text: string) => void,
        onAgentStep?: (step: AgentStepEvent) => void
    ): Promise<string> {

        // Resolve the agent's system prompt
        const agent = settings.prompts.find((p: any) => p.id === data.agentId);
        const systemPrompt = agent?.content || settings.general.systemPrompt || "You are an expert AI assistant.";

        outputChannel.appendLine(`[Agentic] Agent=${data.agentId}, model=${model}, agentName=${agent?.name}`);

        // Build the workspace-aware system prompt
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'unknown';
        const agenticSystemPrompt = `${systemPrompt}

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
- Always verify your changes compile after editing.`;

        // Build payload
        const messages = [
            { role: 'system' as const, content: agenticSystemPrompt },
            ...this.compactMessages(contextMessages),
            { role: 'user' as const, content: currentMessage }
        ];

        // Create tool registry
        const tools = createToolRegistry(this.workspaceIndex);
        await this.workspaceIndex.refresh();

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
                    onStepFinish: (event: any) => {
                        stepCount++;
                        outputChannel.appendLine(`[Agentic] Step ${stepCount} finished`);

                        // Stream tool activity to frontend
                        // AI SDK v6: event has 'toolCalls' array and 'toolResults' array
                        if (onAgentStep && event.toolCalls && event.toolCalls.length > 0) {
                            for (const tc of event.toolCalls) {
                                onAgentStep({
                                    type: 'tool_call',
                                    toolName: tc.toolName,
                                    args: tc.args
                                });
                            }
                        }

                        if (onAgentStep && event.toolResults && event.toolResults.length > 0) {
                            for (const tr of event.toolResults) {
                                onAgentStep({
                                    type: 'tool_result',
                                    toolName: tr.toolName,
                                    result: this.summarizeToolResult(tr.result)
                                });
                            }
                        }
                    }
                }
            );

            // Consume the full stream to get ALL events (text + tools + errors)
            let fullText = '';
            for await (const part of result.fullStream) {
                if (part.type === 'text-delta') {
                    fullText += part.text;
                    if (onChunk) { onChunk(part.text); }
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

            return fullText;
        } catch (error: any) {
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
     */
    private compactMessages(messages: any[]): any[] {
        return messages.map((msg, idx) => {
            // Only compact messages that aren't the last 2 (keep recent context fresh)
            if (idx < messages.length - 2 && msg.role === 'tool' && msg.content) {
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
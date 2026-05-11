import * as vscode from 'vscode';
import * as os from 'os';
import { aiRequest, aiStreamRequest, aiAgenticRequest } from '../api/ai';
import { outputChannel } from '../logger';
import { ROLE } from '../chat/chat-constants';
import { ChatHistoryService } from './chat-history';
import * as crypto from 'crypto';
import { ImageStorageService } from './image-storage';
import { ImageDescriptionService } from './image-description-service';
import { SettingsManager } from '../services/settings-manager';
import { WorkspaceIndexService } from '../services/workspace-index';
import { createToolRegistry } from '../tools/tool-registry';
import { getModelTier } from '../constants';
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
        onAgentStep?: (step: AgentStepEvent) => void): Promise<{ text: string, usage?: any, hitStepLimit?: boolean, continuationMaxSteps?: number }> {

        const hasImages = data.images && Array.isArray(data.images) && data.images.length > 0;

        // 1. GET SETTINGS
        const appSettings = this.settingsManager.getSettings();

        // #49: Use smart defaults instead of user-configurable temperature/context
        const maxContext = (appSettings.general as any)?.maxContextMessages ?? 20;
        const currentProvider = appSettings.models.provider;
        const pSettings = appSettings.models.providerSettings?.[currentProvider] || {};
        const accessToken = pSettings.apiKey || '';
        const temperature = 0.5; // Balanced: focused but not robotic

        let aiResponseText = "";
        let totalUsage: any = null;
        let hitStepLimit = false;
        let continuationMaxSteps = 0;
        const collectedAgentSteps: any[] = [];

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
            // #46: Preserve content for URL-scraped files since they can't be re-opened by path
            const lightweightFiles = data.files ? data.files.map((f: any) => {
                const isUrl = f.path && (f.path.startsWith('http://') || f.path.startsWith('https://'));
                return {
                    name: f.name,
                    path: f.path,
                    language: f.language,
                    ...(isUrl && f.content ? { content: f.content } : {})
                };
            }) : [];
            await this.historyService.addMessage(
                data.chat_id, ROLE.USER, data.message,
                storedImageFilenames, storedImageDescriptions,
                data.agentId, undefined, lightweightFiles
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

            // #66: Determine vision capability dynamically from provider config
            const configProvider = appSettings.models.provider;
            const { getModelProviderOptions } = require('../constants');
            const providerOptions = getModelProviderOptions();
            const providerData = providerOptions[configProvider];
            const providerImageModels: string[] = providerData?.models?.image || [];

            // Use the provider's configured model — never hardcode a specific provider's model ID
            const fallbackTextModel = appSettings.models.textModel;
            // #66: If no image model is configured, default to the text model
            const fallbackImageModel = appSettings.models.imageModel || fallbackTextModel;

            let targetModel: string = fallbackTextModel;
            let finalContextMessages = [...contextMessages];
            let finalCurrentMessage: any = currentMessageContent;

            if (hasImages) {
                // Check if the provider supports image models at all
                const providerSupportsVision = providerImageModels.length > 0;

                if (providerSupportsVision) {
                    targetModel = fallbackImageModel;
                    // Warn if the selected image model isn't in the provider's image-capable list
                    if (providerImageModels.length > 0 && !providerImageModels.includes(targetModel)) {
                        outputChannel.appendLine(`[ChatCore] ⚠ Warning: Model "${targetModel}" may not support images. Image-capable models for ${configProvider}: ${providerImageModels.join(', ')}`);
                    }
                } else {
                    // Provider doesn't list image models — fall back to text description
                    const descriptionContext = storedImageDescriptions.map((d, i) => `[Image ${i + 1} Description: ${d}]`).join("\n");
                    finalCurrentMessage = `${data.message}\n\n${descriptionContext}`;
                    outputChannel.appendLine(`[ChatCore] Provider "${configProvider}" has no image models listed — using text descriptions instead.`);
                }
            } else {
                targetModel = fallbackTextModel;
            }

            // #71: Resolve custom model config (apiKey, baseUrl, apiKeyHeader)
            // Custom models store their own apiKey/baseUrl on the model object itself,
            // NOT in providerSettings. We must check customModels[] first.
            const customModel = (appSettings.customModels || []).find((cm: any) => cm.name === targetModel);

            // Resolve API key and base URL — custom model's own config takes priority
            const globalProvider = appSettings.models.provider || 'OpenAI';
            // IMPORTANT: Use the custom model's own provider for routing (Gemini vs OpenAI-compat)
            // The global provider setting may differ from the custom model's provider
            const activeProvider = customModel?.provider || globalProvider;
            const providerConfig = appSettings.models.providerSettings?.[activeProvider] || appSettings.models.providerSettings?.[globalProvider];

            const apiKey = customModel?.apiKey || providerConfig?.apiKey || appSettings.models.apiKey || '';
            const apiBaseUrl = customModel?.baseUrl || providerConfig?.baseUrl || '';
            const apiKeyHeader = customModel?.apiKeyHeader || '';
            const azureStyle = customModel?.azureStyle === true;

            outputChannel.appendLine(`[ChatCore] Provider=${activeProvider}, model=${targetModel}, hasApiKey=${!!apiKey}, keyLen=${apiKey.length}, baseUrl=${apiBaseUrl || '(default)'}${apiKeyHeader ? `, apiKeyHeader=${apiKeyHeader}` : ''}${azureStyle ? ', azureStyle=true' : ''}${customModel ? `, source=customModel(${customModel.provider})` : ''}`);


            // ─── DETERMINE MODE: AGENTIC vs STANDARD ────────────────────────
            const isAgenticMode = this.isAgenticAgent(data.agentId, appSettings);

            const trackingOnAgentStep = (step: any) => {
                collectedAgentSteps.push(step);
                if (onAgentStep) {
                    onAgentStep(step);
                }
            };

            if (isAgenticMode) {
                const response = await this.processAgenticRequest(
                    data, finalContextMessages, finalCurrentMessage,
                    targetModel, apiKey || accessToken, temperature, apiBaseUrl,
                    appSettings, onChunk, trackingOnAgentStep, abortController.signal,
                    apiKeyHeader,
                    (usage) => { totalUsage = usage; },
                    azureStyle
                );
                aiResponseText = response.text;
                if (!totalUsage) totalUsage = response.usage;
                if (response.hitStepLimit) {
                    hitStepLimit = true;
                    continuationMaxSteps = response.maxSteps || 0;
                }
            } else {
                const response = await this.processStandardRequest(
                    data, finalContextMessages, finalCurrentMessage,
                    targetModel, apiKey || accessToken, temperature, apiBaseUrl,
                    appSettings, onChunk, abortController.signal,
                    apiKeyHeader,
                    (usage) => { totalUsage = usage; },
                    azureStyle
                );
                aiResponseText = response.text;
                if (!totalUsage) totalUsage = response.usage;
            }

            // --- STEP E: SAVE AI RESPONSE ---
            await this.historyService.addMessage(data.chat_id, ROLE.BOT, aiResponseText, [], [], data.agentId, collectedAgentSteps);
            outputChannel.appendLine("Chat interaction saved and processed.");

        } catch (error: any) {
            if (abortController.signal.aborted) {
                outputChannel.appendLine(`[ChatCore] Request explicitly aborted by user for chatId=${data.chat_id}`);
                aiResponseText = '*Agent stopped.*';
                if (onAgentStep) {
                    onAgentStep({ type: 'thinking', text: '-- Agent stopped by user' } as any);
                }
                if (onChunk) { onChunk('\n\n*Agent stopped.*'); }
                // Usage is still returned via the result — tokens were consumed
                outputChannel.appendLine(`[ChatCore] Usage on abort: ${totalUsage ? JSON.stringify(totalUsage) : 'none captured'}`);
            } else {
                console.error('Error fetching chat response:', error);

                let extractedErrorMsg = 'Unknown error';
                if (error instanceof Error) {
                    extractedErrorMsg = error.message;
                } else if (error && typeof error === 'object') {
                    extractedErrorMsg = error.message || error.error?.message || error.details || JSON.stringify(error);
                } else if (typeof error === 'string') {
                    extractedErrorMsg = error;
                }

                outputChannel.appendLine('[ChatCore] Error: ' + extractedErrorMsg);

                // Render error as a regular chat message (not inside thinking block)
                aiResponseText = `⚠️ **Error:** ${extractedErrorMsg}`;
                if (onChunk) {
                    onChunk(aiResponseText);
                }
            }
            await this.historyService.addMessage(data.chat_id, ROLE.BOT, aiResponseText, [], [], data.agentId, collectedAgentSteps);
        } finally {
            ChatCoreService.activeAbortControllers.delete(data.chat_id);
        }

        return { text: aiResponseText, usage: totalUsage, hitStepLimit, continuationMaxSteps };
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
        settings: any, onChunk?: (text: string) => void, abortSignal?: AbortSignal,
        apiKeyHeader?: string, onUsageUpdate?: (usage: any) => void, azureStyle?: boolean
    ): Promise<{ text: string, usage?: any }> {

        // #64: Default Chat uses ONLY the global system prompt — no extra system info
        // System info is only needed for agentic mode (tool execution context)
        const systemPrompt = settings.general?.systemPrompt || "You are an expert AI assistant.";
        const steps = [{ content: systemPrompt }];

        let pipelineContext = currentMessage;
        let aiResponseText = "";
        let totalUsage: any = null;
        const isO1 = model.startsWith('o1');
        const requestTemperature = isO1 ? 1 : temperature;

        // Resolve the active provider for routing
        const activeProvider = settings.models?.provider || 'OpenAI';

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const isLastStep = i === steps.length - 1;

            const apiPayload = [
                { role: 'system', content: (step as any).content || step },
                ...this.compactMessages(contextMessages),
                { role: 'user', content: pipelineContext }
            ];

            if (isLastStep && onChunk) {
                const result = await aiStreamRequest(
                    apiPayload, model, apiKey, requestTemperature, activeProvider, baseUrl, abortSignal, apiKeyHeader,
                    (event: any) => {
                        const usage = event.usage || event.totalUsage;
                        totalUsage = usage;
                        if (onUsageUpdate) onUsageUpdate(usage);
                    },
                    azureStyle
                );
                let fullText = '';
                for await (const chunk of result.fullStream) {
                    if (abortSignal && abortSignal.aborted) {
                        throw new Error('AbortError');
                    }
                    if (chunk.type === 'text-delta') {
                        fullText += chunk.text;
                        onChunk(chunk.text);
                    } else if (chunk.type === 'error') {
                        throw chunk.error;
                    }
                }
                const usage = await result.usage;
                pipelineContext = fullText;
                aiResponseText = fullText;
                totalUsage = usage;
            } else {
                const response = await aiRequest(
                    apiPayload, model, apiKey, requestTemperature, activeProvider, baseUrl, apiKeyHeader, azureStyle
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
        abortSignal?: AbortSignal,
        apiKeyHeader?: string,
        onUsageUpdate?: (usage: any) => void,
        azureStyle?: boolean
    ): Promise<{ text: string, usage?: any, hitStepLimit?: boolean, maxSteps?: number }> {
        // Note: We do NOT call ReviewManager.startTurn() here.
        // Pending edits are global and persist until the user accepts/reverts them.

        // Resolve the agent's system prompt
        const agent = (settings.prompts || []).find((p: any) => p.id === data.agentId);
        const systemPrompt = agent?.content || settings.general?.systemPrompt || "You are an expert AI assistant.";

        outputChannel.appendLine(`[Agentic] Agent=${data.agentId}, model=${model}, agentName=${agent?.name}`);

        // Build the workspace-aware system prompt with system info (#52)
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'unknown';
        const systemInfo = getSystemInfo();

        // #50: Task tracking — handled via update_task_progress tool
        const todoInstruction = `\n\nTASK TRACKING:
When handling complex multi-step requests, call update_task_progress after each major step to report your progress.
This shows a live checklist in the chat so the user can track what's done and what's remaining.`;

        // #51: Include workspace file tree in context (compact mode to save tokens)
        await this.workspaceIndex.refresh();
        const fileTree = this.workspaceIndex.getCompactTreeString();
        // Cap the tree to avoid blowing up the context window
        const maxTreeChars = 4000;
        const truncatedTree = fileTree.length > maxTreeChars
            ? fileTree.substring(0, maxTreeChars) + '\n... (truncated, use list_workspace for full tree)'
            : fileTree;

        // #55: Auto-inject active editor context so the agent doesn't waste tool calls
        const activeEditorCtx = this.workspaceIndex.getActiveEditorContext();
        const editorSection = activeEditorCtx
            ? `\n--- ACTIVE EDITOR FILES ---\nThese files are currently open in the user's editor. You already have their skeletons and cursor positions. Do NOT re-read them with read_file_skeleton unless you need fresh data after an edit.\n${activeEditorCtx}\n`
            : '';

        const agenticSystemPrompt = `${systemPrompt}

${systemInfo}

--- WORKSPACE FILE TREE ---
${truncatedTree}
${editorSection}
--- AGENT CONTEXT ---
You have access to tools to read, search, and modify files in the user's workspace.
Workspace root: ${workspaceRoot}

WORKFLOW:
1. Call plan_task FIRST to break down the user's request into steps
2. Use list_workspace or find_symbol to understand the project structure
3. Use read_file_skeleton to get an overview of relevant files (don't read full files unnecessarily)
4. Use read_line_range to examine specific sections you need
5. Use chunk_replace to make surgical edits (provide exact target text)
6. Use search_workspace to find patterns across the codebase
7. Use get_workspace_problems to verify if your changes introduced any lint or syntax errors
8. Use run_command for builds, tests, git operations
9. Use web_search to look up documentation, APIs, or current information online
10. Call verify_completion at the END to confirm all items were addressed

CRITICAL RULES:
- You are an AUTONOMOUS AGENT. You MUST use tools to accomplish tasks. NEVER just describe what to do.
- NEVER output code blocks in chat as a response. Use create_file or chunk_replace to write code DIRECTLY to files.
- NEVER give step-by-step instructions for the user to follow. YOU execute the steps yourself using tools.
- If the user asks you to create a file, use the create_file tool. Do NOT paste the file contents in chat.
- If the user asks you to edit a file, use chunk_replace. Do NOT show a diff in chat and ask the user to apply it.
- NEVER read an entire large file. Use skeleton first, then line ranges.
- When editing, provide the EXACT target text to replace (including whitespace).
- Always verify your changes compile and don't introduce workspace problems after editing.
- Edits are applied DIRECTLY to the file. The user can review changes inline and revert if needed.
- Use web_search proactively when the user's question involves external libraries, APIs, or topics you're uncertain about. Don't guess — search first.
- Skip tool calls for files you already have context for (active editor files above).${todoInstruction}`;

        // Resolve and inject rules (global + agent-linked)
        const allRules: { name: string; content: string }[] = [];
        const seenRuleIds = new Set<string>();

        // 1. Global rules (scope === 'global')
        for (const rule of (settings.rules || [])) {
            if (rule.scope === 'global' && rule.content && !seenRuleIds.has(rule.id)) {
                allRules.push(rule);
                seenRuleIds.add(rule.id);
            }
        }

        // 2. Agent-linked rules
        if (agent?.linkedRules) {
            for (const ruleId of agent.linkedRules) {
                if (!seenRuleIds.has(ruleId)) {
                    const rule = (settings.rules || []).find((r: any) => r.id === ruleId);
                    if (rule?.content) {
                        allRules.push(rule);
                        seenRuleIds.add(ruleId);
                    }
                }
            }
        }

        const rulesSection = allRules.length > 0
            ? `\n\n--- APPLIED RULES ---\n${allRules.map(r => `[${r.name}]: ${r.content}`).join('\n')}\n`
            : '';

        const finalSystemPrompt = agenticSystemPrompt + rulesSection;

        // Build payload
        const messages = [
            { role: 'system' as const, content: finalSystemPrompt },
            ...this.compactMessages(contextMessages),
            { role: 'user' as const, content: currentMessage }
        ];

        // Resolve the active provider for routing
        const globalProvider = settings.models?.provider || 'OpenAI';
        const activeModelEntry = (settings.customModels || []).find((m: any) => m.name === model);
        const activeProvider = activeModelEntry?.provider || globalProvider;
        outputChannel.appendLine(`[Agentic] Provider: ${activeProvider} (global=${globalProvider}, custom=${activeModelEntry?.provider || 'n/a'})`);

        // Resolve model tier for adaptive behavior
        let modelTier = getModelTier(activeProvider, model);

        // Override tier from custom model settings if set
        if (settings.customModels) {
            const customModel = settings.customModels.find((m: any) => m.name === model);
            if (customModel?.tier) {
                modelTier = customModel.tier;
            }
        }
        outputChannel.appendLine(`[Agentic] Model tier: ${modelTier} (${activeProvider}/${model})`);

        // Apply alwaysProceed override — if enabled, skip all confirmation dialogs
        const alwaysProceed = settings.permissions?.alwaysProceed === true;
        const tools = createToolRegistry(this.workspaceIndex, {
            abortSignal: abortSignal,
            tier: modelTier,
            readFilesConfirmation: alwaysProceed ? false : (settings.permissions?.readFilesConfirmation ?? false),
            writeFilesConfirmation: alwaysProceed ? false : (settings.permissions?.writeFilesConfirmation ?? true),
            runCommandsConfirmation: alwaysProceed ? false : (settings.permissions?.runCommandsConfirmation ?? true),
            onApprovalRequest: async (toolCallId, toolName, args, opts) => {
                if (abortSignal?.aborted) {
                    return;
                }
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

        // Optimize temperature by agent role:
        // - Code/task agents: 0.2 for precision (0.1 causes repetition loops in some models)
        // - Research/planning agents: 0.5 for creative analysis while staying grounded
        const agentName = (agent?.name || '').toLowerCase();
        const isResearchAgent = agentName.includes('research') || agentName.includes('planner') || agentName.includes('analyst') || agentName.includes('advisor');
        const agentTemp = isResearchAgent ? 0.5 : 0.2;
        outputChannel.appendLine(`[Agentic] Temperature: ${agentTemp} (${isResearchAgent ? 'research/planning' : 'code/task'})`);


        let stepCount = 0;
        let streamedReasoning = false;
        let lastStepHadToolCalls = false;

        // Check if model supports reasoning
        let supportsReasoning = false;
        try {
            const providers = require('../../models.json');
            if (providers[activeProvider]?.supportsReasoning?.includes(model)) {
                supportsReasoning = true;
            }
        } catch (e) {
            outputChannel.appendLine(`[Agentic] Error reading models.json: ${e}`);
        }

        // Check custom models
        if (!supportsReasoning && settings.customModels) {
            const customModel = settings.customModels.find((m: any) => m.name === model);
            if (customModel && customModel.supportsReasoning) {
                supportsReasoning = true;
            }
        }

        // Auto-detect reasoning for known model families (fallback for older custom model entries)
        if (!supportsReasoning) {
            const lowerModel = model.toLowerCase();
            if (lowerModel.includes('gemini') || lowerModel.includes('gpt-5') || lowerModel.includes('o1') || lowerModel.includes('o3') || lowerModel.includes('claude') || lowerModel.includes('sonnet') || lowerModel.includes('opus')) {
                supportsReasoning = true;
                outputChannel.appendLine(`[Agentic] Auto-detected reasoning support for model: ${model}`);
            }
        }
        // Aggressive mode doubles maxSteps for persistent task completion
        const isAggressive = settings.general?.aggressiveAgentic === true;
        const baseSteps = modelTier === 'small' ? 10 : modelTier === 'mid' ? 20 : 25;
        const maxSteps = isAggressive ? baseSteps * 2 : baseSteps;
        outputChannel.appendLine(`[Agentic] maxSteps=${maxSteps}${isAggressive ? ' (aggressive)' : ''}`);

        try {
            const result = await aiAgenticRequest(
                messages, model, apiKey, agentTemp, activeProvider, tools,
                {
                    maxSteps: maxSteps,
                    baseUrl: baseUrl,
                    abortSignal: abortSignal,
                    enableThinking: supportsReasoning,
                    apiKeyHeader: apiKeyHeader,
                    azureStyle: azureStyle,
                    onFinish: (event: any) => {
                        const usage = event.usage || event.totalUsage;
                        if (onUsageUpdate && usage) onUsageUpdate(usage);
                    },
                    // #44: Real-time reasoning streaming (for models like Gemini/DeepSeek)
                    onReasoningChunk: (text: string) => {
                        streamedReasoning = true;
                        if (onAgentStep && text) {
                            onAgentStep({ type: 'thinking', text });
                        }
                    },
                    onStepFinish: (event: any) => {
                        if (abortSignal?.aborted) {
                            return;
                        }
                        stepCount++;
                        lastStepHadToolCalls = !!(event.toolCalls && event.toolCalls.length > 0);
                        outputChannel.appendLine(`[Agentic] Step ${stepCount} finished (toolCalls: ${lastStepHadToolCalls})`);

                        // Accumulate usage per step so tokens are counted even on abort
                        if (event.usage) {
                            if (onUsageUpdate) onUsageUpdate(event.usage);
                        }

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
            let isThinking = false;
            let _lastTextDelta = ''; // Dedup guard for corporate gateway double-sends

            for await (const part of result.fullStream) {
                if (abortSignal && abortSignal.aborted) {
                    throw new Error('AbortError');
                }

                const partType = (part as any).type;
                // Diagnostic: log every part type to help debug reasoning visibility
                if (partType !== 'text-delta' && partType !== 'raw') {
                    outputChannel.appendLine(`[Agentic] Stream part: type=${partType}`);
                }

                switch (partType) {
                    // ─── Text streaming ──────────────────────────────
                    case 'text-delta':
                        const deltaText = (part as any).text;
                        // Dedup guard: corporate gateways can send duplicate SSE events
                        if (deltaText && deltaText === _lastTextDelta && deltaText.length > 2) {
                            outputChannel.appendLine(`[Agentic] Skipping duplicate text-delta: "${deltaText.substring(0, 30)}..."`);
                            break;
                        }
                        _lastTextDelta = deltaText;
                        fullText += deltaText;
                        if (onChunk) { onChunk(deltaText); }
                        break;
                    case 'text-start':
                    case 'text-end':
                        break; // bookkeeping, no action needed

                    // ─── Reasoning / Thinking (#44) ──────────────────
                    case 'reasoning-start':
                        // Model started thinking — show indicator in UI
                        isThinking = true;
                        outputChannel.appendLine(`[Agentic] >>> REASONING-START received`);
                        if (onAgentStep) {
                            onAgentStep({ type: 'thinking', text: '' }); // empty text = "start block"
                        }
                        break;

                    case 'reasoning-delta':
                        // Reasoning text is already streamed via onChunk → onReasoningChunk
                        // Just log here for diagnostics, don't send to UI again (prevents duplication)
                        const reasoningText = (part as any).delta || (part as any).text || '';
                        outputChannel.appendLine(`[Agentic] >>> REASONING-DELTA: "${reasoningText.substring(0, 50)}..."`);
                        break;

                    case 'reasoning-end':
                        isThinking = false;
                        outputChannel.appendLine(`[Agentic] >>> REASONING-END received`);
                        break;

                    // ─── Tool streaming ──────────────────────────────
                    case 'tool-call':
                        outputChannel.appendLine(`[Agentic] Tool call: ${(part as any).toolName}`);
                        break;
                    case 'tool-result':
                        outputChannel.appendLine(`[Agentic] Tool result received for: ${(part as any).toolName}`);
                        break;
                    case 'tool-input-start':
                    case 'tool-input-delta':
                    case 'tool-input-end':
                        break; // tool arg streaming, no UI action needed

                    // ─── Step lifecycle ──────────────────────────────
                    case 'start-step':
                    case 'start':
                        outputChannel.appendLine(`[Agentic] Step started`);
                        break;

                    case 'finish-step': {
                        const usage = (part as any).usage;
                        const reasoningTokens = usage?.outputTokenDetails?.reasoningTokens
                            || usage?.reasoningTokens || 0;
                        outputChannel.appendLine(`[Agentic] Step finished: reason=${(part as any).finishReason}, reasoning=${reasoningTokens} tokens`);
                        // Note: reasoning text + token counts sent post-stream via result.steps
                        break;
                    }

                    case 'finish':
                        outputChannel.appendLine(`[Agentic] Stream finish: reason=${(part as any).finishReason}`);
                        break;

                    // ─── Other ───────────────────────────────────────
                    case 'error':
                        outputChannel.appendLine(`[Agentic] Stream error part: ${(part as any).error}`);
                        throw (part as any).error; // #FIX: Throw the actual API error instead of swallowing it
                    case 'source':
                    case 'raw':
                        break; // metadata, no action
                    default:
                        outputChannel.appendLine(`[Agentic] Unhandled stream part: ${(part as any).type}`);
                        break;
                }
            }

            outputChannel.appendLine(`[Agentic] Completed in ${stepCount} steps, response length: ${fullText.length}`);

            // #44: After stream is consumed, extract reasoning from result.steps
            // This is the canonical AI SDK approach — works for ALL models.
            // result.steps is a promise that resolves after fullStream is consumed.
            if (onAgentStep) {
                try {
                    const steps = await result.steps;
                    let totalReasoningTokens = 0;
                    let allReasoningText = '';

                    for (const step of steps) {
                        // Diagnostic: log step reasoning data
                        outputChannel.appendLine(`[Agentic] Step reasoning: reasoningText=${(step.reasoningText || '').length} chars, reasoning=${Array.isArray(step.reasoning) ? step.reasoning.length : 0} parts, usage=${JSON.stringify(step.usage)}`);

                        // Count reasoning tokens
                        const stepTokens = (step.usage as any)?.outputTokenDetails?.reasoningTokens
                            || (step.usage as any)?.reasoningTokens || 0;
                        totalReasoningTokens += stepTokens;

                        // Consolidate reasoning text (like the AI SDK elements example)
                        // step.reasoning is Array<ReasoningPart> where each part has { type: 'reasoning', text: string }
                        if (step.reasoningText && step.reasoningText.trim()) {
                            if (allReasoningText) { allReasoningText += '\n\n'; }
                            allReasoningText += step.reasoningText;
                        } else if (step.reasoning && Array.isArray(step.reasoning) && step.reasoning.length > 0) {
                            const consolidated = step.reasoning
                                .filter((r: any) => r.text)
                                .map((r: any) => r.text)
                                .join('\n\n');
                            if (consolidated.trim()) {
                                if (allReasoningText) { allReasoningText += '\n\n'; }
                                allReasoningText += consolidated;
                            }
                        }
                    }

                    outputChannel.appendLine(`[Agentic] Reasoning summary: ${totalReasoningTokens} tokens, text=${allReasoningText.length} chars, streamedReasoning=${streamedReasoning}`);

                    // Send consolidated reasoning to UI ONLY IF it wasn't streamed live
                    if (!streamedReasoning && allReasoningText.trim()) {
                        onAgentStep({ type: 'thinking', text: allReasoningText });
                    }
                    // Always send token count if reasoning was used
                    if (totalReasoningTokens > 0) {
                        onAgentStep({ type: 'thinking', text: `__TOKENS__${totalReasoningTokens}` });
                    }
                } catch (e) {
                    outputChannel.appendLine(`[Agentic] Failed to extract reasoning: ${e}`);
                }
            }

            // Send completion step event
            if (onAgentStep) {
                onAgentStep({
                    type: 'thinking',
                    text: `Agent completed in ${stepCount} steps.`
                });
            }

            // Detect if the model hit the step limit while still wanting to work
            const hitStepLimit = stepCount >= maxSteps && lastStepHadToolCalls;
            if (hitStepLimit) {
                outputChannel.appendLine(`[Agentic] Hit step limit (${stepCount}/${maxSteps}) — model still had pending tool calls`);
            }

            // If model returned empty text, provide a context-aware fallback
            if (!fullText || fullText.trim() === '') {
                if (hitStepLimit) {
                    fullText = 'Reached step limit. There may be more work to do.';
                } else if (stepCount <= 1) {
                    // Model stopped almost immediately — likely couldn't handle the request
                    fullText = 'The model was unable to complete this request. Try rephrasing or using a different model.';
                } else if (!lastStepHadToolCalls && stepCount < maxSteps) {
                    // Model stopped on its own without tool calls — it may have gotten stuck
                    fullText = 'Task completed.';
                } else {
                    fullText = 'Task completed.';
                }
                if (onChunk) { onChunk(fullText); }
            }

            const usage = await result.usage;
            return { text: fullText, usage, hitStepLimit, maxSteps };
        } catch (error: any) {
            if (abortSignal?.aborted) {
                throw error; // Let the top-level catch handle the cancellation gracefully
            }
            outputChannel.appendLine(`[Agentic] ERROR: ${error?.message || error}`);
            throw error;
        }
    }

    /**
     * Tiered Sliding Window: Manages context size to prevent unbounded growth.
     * Also deduplicates system prompts (#47) to save context tokens.
     * 
     * Tiers (counted from the END of the messages array):
     *   HOT   (last 6 non-system msgs)  → Full content, untouched
     *   WARM  (msgs 7–20)               → Truncated: assistant=600ch, user=400ch, tool=200ch
     *   COLD  (msgs 21+)                → Dropped entirely
     * 
     * System messages are always kept (but deduplicated).
     */
    private compactMessages(messages: any[]): any[] {
        const HOT_COUNT = 6;
        const WARM_LIMIT = 20;

        // --- Pass 1: Deduplicate system messages ---
        const seenSystemContents = new Set<string>();
        const deduped = messages.filter((msg) => {
            if (msg.role === 'system') {
                const key = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                if (seenSystemContents.has(key)) {
                    return false;
                }
                seenSystemContents.add(key);
            }
            return true;
        });

        // --- Pass 2: Assign tiers based on reverse non-system index ---
        // Count non-system messages from the end to determine tier placement
        const nonSystemIndices: number[] = [];
        for (let i = 0; i < deduped.length; i++) {
            if (deduped[i].role !== 'system') {
                nonSystemIndices.push(i);
            }
        }

        // Map each non-system message index to its reverse position (1 = newest)
        const reverseRank = new Map<number, number>();
        for (let r = 0; r < nonSystemIndices.length; r++) {
            reverseRank.set(nonSystemIndices[r], nonSystemIndices.length - r);
        }

        // --- Pass 3: Filter and compact based on tier ---
        const result = deduped
            .filter((msg, idx) => {
                // System messages always survive
                if (msg.role === 'system') { return true; }

                const rank = reverseRank.get(idx) || 999;

                // COLD tier: drop entirely
                if (rank > WARM_LIMIT) { return false; }

                return true;
            })
            .map((msg, _idx, _arr) => {
                // System messages pass through untouched
                if (msg.role === 'system') { return msg; }

                // Find this message's original index in deduped to get its rank
                const dedupedIdx = deduped.indexOf(msg);
                const rank = reverseRank.get(dedupedIdx) || 999;

                // HOT tier: full content
                if (rank <= HOT_COUNT) { return msg; }

                // WARM tier: truncate based on role
                if (msg.role === 'tool' && msg.content) {
                    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                    if (content.length > 200) {
                        return { ...msg, content: content.substring(0, 200) + '... [truncated]' };
                    }
                }

                if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.length > 600) {
                    return { ...msg, content: msg.content.substring(0, 600) + '\n... [truncated for context efficiency]' };
                }

                if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.length > 400) {
                    return { ...msg, content: msg.content.substring(0, 400) + '\n... [truncated for context efficiency]' };
                }

                return msg;
            });

        const dropped = nonSystemIndices.length - result.filter(m => m.role !== 'system').length;
        if (dropped > 0 || deduped.length !== messages.length) {
            outputChannel.appendLine(`[Context] Sliding window: ${messages.length} msgs → ${result.length} sent (${dropped} cold-dropped, ${messages.length - deduped.length} system-deduped)`);
        }

        return result;
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
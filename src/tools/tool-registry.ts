import { WorkspaceIndexService } from '../services/workspace-index';
import { createFileTools } from './file-tools';
import { createSysTools, clearTestRetryTracker } from './sys-tools';
import { createWebTools } from './web-tools';
import { createCognitiveTools, ModelTier } from './cognitive-tools';
import { createArtifactTools } from './artifact-tools';
import { createBrowserTools } from './browser-tools';
import { ApprovalService } from '../chat/approval-service';
import { ReviewManager } from '../chat/review-manager';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ToolRegistryOptions {
    chatId?: string;
    readFilesConfirmation: boolean;
    writeFilesConfirmation: boolean;
    runCommandsConfirmation: boolean;
    tier?: ModelTier;
    onApprovalRequest?: (toolCallId: string, toolName: string, args: any, options: { diffReviewRequired?: boolean }) => Promise<void>;
    abortSignal?: AbortSignal;
    /** Shared mutable counter — chat-core increments this, tool-registry reads it */
    stepBudget?: { current: number; max: number };
}

/**
 * Central tool registry. Creates all tools and returns them as a flat object
 * ready to be injected into the Vercel AI SDK's `tools` parameter.
 */
export function createToolRegistry(workspaceIndex: WorkspaceIndexService, options?: ToolRegistryOptions) {
    // Reset test/build retry tracker for each new agentic request
    clearTestRetryTracker();

    const fileTools = createFileTools(workspaceIndex);
    const sysTools = createSysTools();
    const webTools = createWebTools();
    const cognitiveTools = createCognitiveTools(options?.tier || 'mid', options?.chatId);
    const artifactTools = createArtifactTools(options?.chatId || 'unknown_chat');

    const browserTools = createBrowserTools();

    const allTools = {
        ...fileTools,
        ...sysTools,
        ...webTools,
        ...cognitiveTools,
        ...artifactTools,
        ...browserTools
    };

    const readTools = ['list_workspace', 'read_file_skeleton', 'read_line_range', 'find_symbol', 'search_workspace', 'scrape_url', 'web_search', 'get_workspace_problems', 'read_artifact'];
    const writeTools = ['chunk_replace', 'create_file', 'manage_artifact'];
    const commandTools = ['run_command', 'browser_action', 'browser_evaluate'];

    // Wrap all execute functions
    Object.keys(allTools).forEach((key) => {
        const toolDef = (allTools as any)[key];
        const originalExecute = toolDef.execute;

        if (originalExecute) {
            toolDef.execute = async (params: any, { toolCallId }: { toolCallId: string }) => {
                if (options?.abortSignal?.aborted) {
                    throw new Error('Request cancelled by user.');
                }
                let requireConfirmation = false;
                let diffReviewRequired = false;

                if (readTools.includes(key)) {
                    requireConfirmation = options?.readFilesConfirmation ?? false;
                } else if (writeTools.includes(key)) {
                    requireConfirmation = options?.writeFilesConfirmation ?? true;
                    diffReviewRequired = true;
                } else if (commandTools.includes(key)) {
                    requireConfirmation = options?.runCommandsConfirmation ?? true;
                }

                if (requireConfirmation) {
                    if (diffReviewRequired) {
                        // 1. Execute originally (This stages the changes in ReviewManager)
                        const result = await originalExecute(params, { toolCallId });
                        
                        // 2. Notify frontend about the staged changes
                        if (options?.onApprovalRequest) {
                            await options.onApprovalRequest(toolCallId, key, params, { diffReviewRequired });
                        }
                        
                        return result;
                    } else {
                        // For non-diff tools (like run_command), we still block and wait for approval
                        if (options?.onApprovalRequest) {
                            await options.onApprovalRequest(toolCallId, key, params, { diffReviewRequired });
                        }
                        const approved = await ApprovalService.getInstance().waitForApproval(toolCallId);
                        if (!approved) {
                            return { error: `Execution denied by user. Tool '${key}' was not executed.` };
                        }
                        return originalExecute(params, { toolCallId });
                    }
                }

                return originalExecute(params, { toolCallId }).then((result: any) => {
                    return appendStepBudget(result, options?.stepBudget);
                });
            };
        }
    });

    return allTools;
}

/**
 * Append step budget info to tool results so the model knows its remaining steps.
 * Only triggers after 10+ steps and every 10 steps, or when < 5 remain.
 */
function appendStepBudget(result: any, budget?: { current: number; max: number }): any {
    if (!budget || budget.current < 10) { return result; }
    
    const remaining = budget.max - budget.current;
    
    // Inject at periodic checkpoints (every 10 steps) or when < 5 remain
    if (budget.current % 10 === 0 || remaining <= 5) {
        if (typeof result === 'object' && result !== null) {
            if (remaining <= 5) {
                result._stepBudget = `⚠️ URGENT: ${remaining} steps remaining out of ${budget.max}. Call update_task_progress NOW to save your progress before the limit is reached.`;
            } else {
                result._stepBudget = `Step ${budget.current}/${budget.max} (${remaining} remaining). Consider calling update_task_progress to checkpoint.`;
            }
        }
    }
    return result;
}

export type ToolRegistry = ReturnType<typeof createToolRegistry>;

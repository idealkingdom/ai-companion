import { WorkspaceIndexService } from '../services/workspace-index';
import { createFileTools } from './file-tools';
import { createSysTools } from './sys-tools';
import { ApprovalService } from '../chat/approval-service';
import { ReviewManager } from '../chat/review-manager';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ToolRegistryOptions {
    readFilesConfirmation: boolean;
    writeFilesConfirmation: boolean;
    runCommandsConfirmation: boolean;
    onApprovalRequest?: (toolCallId: string, toolName: string, args: any, options: { diffReviewRequired?: boolean }) => Promise<void>;
}

/**
 * Central tool registry. Creates all tools and returns them as a flat object
 * ready to be injected into the Vercel AI SDK's `tools` parameter.
 */
export function createToolRegistry(workspaceIndex: WorkspaceIndexService, options?: ToolRegistryOptions) {
    const fileTools = createFileTools(workspaceIndex);
    const sysTools = createSysTools();

    const allTools = {
        ...fileTools,
        ...sysTools
    };

    const readTools = ['list_workspace', 'read_file_skeleton', 'read_line_range', 'find_symbol', 'search_workspace'];
    const writeTools = ['chunk_replace', 'create_file'];
    const commandTools = ['run_command'];

    // Wrap all execute functions
    Object.keys(allTools).forEach((key) => {
        const toolDef = (allTools as any)[key];
        const originalExecute = toolDef.execute;

        if (originalExecute) {
            toolDef.execute = async (params: any, { toolCallId }: { toolCallId: string }) => {
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
                    // --- TURN-BASED OPTIMIZATION: Semi-Automatic Mode for Write Tools ---
                    // Instead of blocking with a popup for every hunk, we apply to buffer and continue.
                    if (diffReviewRequired) {
                        const fileUri = vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', params.filePath));
                        await ReviewManager.getInstance().captureOriginalContent(fileUri);
                        
                        if (options?.onApprovalRequest) {
                            await options.onApprovalRequest(toolCallId, key, params, { diffReviewRequired });
                        }
                        
                        // AUTO-APPROVE for the tool cycle (user reviews at the end of the turn)
                        ApprovalService.getInstance().resolveApproval(toolCallId, true);
                    } else {
                        // 1. Notify frontend about approval request (for non-diff tools like run_command)
                        if (options?.onApprovalRequest) {
                            await options.onApprovalRequest(toolCallId, key, params, { diffReviewRequired });
                        }
                    }

                    // 2. Wait for approval result (For write tools, this resolves immediately above)
                    const approved = await ApprovalService.getInstance().waitForApproval(toolCallId);

                    if (!approved) {
                        return { 
                            error: `Execution denied by user. Tool '${key}' was not executed for security reasons.` 
                        };
                    }
                }

                // 3. Execute originally
                return originalExecute(params, { toolCallId });
            };
        }
    });

    return allTools;
}

export type ToolRegistry = ReturnType<typeof createToolRegistry>;

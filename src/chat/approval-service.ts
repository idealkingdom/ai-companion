import * as vscode from 'vscode';

export class ApprovalService {
    private static instance: ApprovalService;
    private resolvers = new Map<string, (approved: boolean) => void>();
    private _onDidResolveApproval = new vscode.EventEmitter<{ toolCallId: string, approved: boolean }>();
    readonly onDidResolveApproval = this._onDidResolveApproval.event;

    private constructor() {}

    public static getInstance(): ApprovalService {
        if (!ApprovalService.instance) {
            ApprovalService.instance = new ApprovalService();
        }
        return ApprovalService.instance;
    }

    /**
     * Puts the current tool execution on hold until the user responds via the webview.
     */
    public async waitForApproval(toolCallId: string): Promise<boolean> {
        return new Promise((resolve) => {
            this.resolvers.set(toolCallId, resolve);
            
            // Safety timeout: auto-deny after 5 minutes if no response
            setTimeout(() => {
                if (this.resolvers.has(toolCallId)) {
                    this.resolveApproval(toolCallId, false);
                }
            }, 5 * 60 * 1000);
        });
    }

    /**
     * Resolves a pending approval request. Called from the message listener.
     */
    public resolveApproval(toolCallId: string, approved: boolean) {
        const resolve = this.resolvers.get(toolCallId);
        if (resolve) {
            resolve(approved);
            this.resolvers.delete(toolCallId);
            this._onDidResolveApproval.fire({ toolCallId, approved });
        }
    }
}

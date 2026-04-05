import * as vscode from 'vscode';
import { ApprovalService } from './approval-service';

export interface PendingHunk {
    id: string; // toolCallId:hunkIndex
    toolCallId: string;
    uri: vscode.Uri;
    range: vscode.Range;       // Range of the NEW code in the buffer
    originalLines: string[];   // What was there before THIS specific hunk
    proposedLines: string[];   // What is there now
}

export class ReviewManager implements vscode.CodeLensProvider {
    private static instance: ReviewManager;
    private hunks = new Map<string, PendingHunk>();
    
    // Track the content of files BEFORE the entire turn started
    // Key: uri.toString(), Value: original text
    private turnOriginalContents = new Map<string, string>();
    
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    private changeDecorationType = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(0, 255, 0, 0.05)', 
        isWholeLine: true,
    });

    private constructor() {
        vscode.window.onDidChangeActiveTextEditor(() => this.refreshDecorations());
        vscode.workspace.onDidChangeTextDocument(() => this.refreshDecorations());
    }

    public static getInstance(): ReviewManager {
        if (!ReviewManager.instance) {
            ReviewManager.instance = new ReviewManager();
        }
        return ReviewManager.instance;
    }

    /**
     * Call this at the start of an AI turn to capture the current state of files.
     */
    public startTurn() {
        this.turnOriginalContents.clear();
        this.hunks.clear();
        this._onDidChangeCodeLenses.fire();
        vscode.commands.executeCommand('setContext', 'ai-companion.reviewPending', false);
    }

    /**
     * Captures the original content of a file if it hasn't been captured yet this turn.
     */
    public async captureOriginalContent(uri: vscode.Uri) {
        const key = uri.toString();
        if (!this.turnOriginalContents.has(key)) {
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                this.turnOriginalContents.set(key, doc.getText());
            } catch (e) {
                // If it's a new file, original is empty
                this.turnOriginalContents.set(key, '');
            }
        }
    }

    public hasReviewsForTool(toolCallId: string): boolean {
        return Array.from(this.hunks.values()).some(h => h.toolCallId === toolCallId);
    }

    public registerHunk(hunk: PendingHunk) {
        this.hunks.set(hunk.id, hunk);
        vscode.commands.executeCommand('setContext', 'ai-companion.reviewPending', true);
        this._onDidChangeCodeLenses.fire();
        this.refreshDecorations();
    }

    public async acceptHunk(hunkId: string) {
        this.completeHunk(hunkId);
    }

    public async rejectHunk(hunkId: string) {
        const hunk = this.hunks.get(hunkId);
        if (!hunk) { return; }

        const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === hunk.uri.toString());
        if (editor) {
            await editor.edit(editBuilder => {
                editBuilder.replace(hunk.range, hunk.originalLines.join('\n') + (hunk.originalLines.length > 0 ? '\n' : ''));
            });
        }
        this.completeHunk(hunkId);
    }

    private completeHunk(hunkId: string) {
        this.hunks.delete(hunkId);

        if (this.hunks.size === 0) {
            vscode.commands.executeCommand('setContext', 'ai-companion.reviewPending', false);
        }

        this._onDidChangeCodeLenses.fire();
        this.refreshDecorations();
    }

    /**
     * Finalize all changes: Clear turn cache and stop tracking.
     */
    public async acceptAll() {
        // Resolve any blocking approvals
        const tools = new Set(Array.from(this.hunks.values()).map(h => h.toolCallId));
        for (const toolId of tools) {
            ApprovalService.getInstance().resolveApproval(toolId, true);
        }
        
        this.hunks.clear();
        this.turnOriginalContents.clear();
        vscode.commands.executeCommand('setContext', 'ai-companion.reviewPending', false);
        this._onDidChangeCodeLenses.fire();
        this.refreshDecorations();
    }

    /**
     * Revert all changes in the turn: Use turnOriginalContents to restore files.
     */
    public async rejectAll() {
        for (const [uriStr, originalContent] of this.turnOriginalContents.entries()) {
            const uri = vscode.Uri.parse(uriStr);
            const edit = new vscode.WorkspaceEdit();
            
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                edit.replace(uri, fullRange, originalContent);
                await vscode.workspace.applyEdit(edit);
            } catch (e) {
                // File might have been new and deleted
            }
        }

        // Resolve any blocking approvals as DENIED
        const tools = new Set(Array.from(this.hunks.values()).map(h => h.toolCallId));
        for (const toolId of tools) {
            ApprovalService.getInstance().resolveApproval(toolId, false);
        }

        this.hunks.clear();
        this.turnOriginalContents.clear();
        vscode.commands.executeCommand('setContext', 'ai-companion.reviewPending', false);
        this._onDidChangeCodeLenses.fire();
        this.refreshDecorations();
    }

    public getOriginalTurnContent(uri: vscode.Uri): string | undefined {
        return this.turnOriginalContents.get(uri.toString());
    }

    public refreshDecorations() {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) { return; }

        const docUri = activeEditor.document.uri.toString();
        const editorHunks = Array.from(this.hunks.values()).filter(h => h.uri.toString() === docUri);
        activeEditor.setDecorations(this.changeDecorationType, editorHunks.map(h => h.range));
    }

    public getCleanContent(document: vscode.TextDocument): string {
        return document.getText();
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const docUri = document.uri.toString();

        for (const hunk of this.hunks.values()) {
            if (hunk.uri.toString() === docUri) {
                lenses.push(new vscode.CodeLens(hunk.range, {
                    title: '$(check) Keep',
                    command: 'ai-companion.acceptReview',
                    arguments: [hunk.id]
                }));
                lenses.push(new vscode.CodeLens(hunk.range, {
                    title: '$(x) Undo',
                    command: 'ai-companion.rejectReview',
                    arguments: [hunk.id]
                }));
            }
        }
        return lenses;
    }
}

import * as vscode from 'vscode';
import { DiffContentProvider } from './diff-content-provider';

/**
 * ReviewManager - The Staging Buffer
 * This class manages the "Shadow" state of the workspace during an AI turn.
 * All AI edits are applied to the shadow state first.
 * The user can review the total diff and commit when ready.
 */
export class ReviewManager {
    private static instance: ReviewManager;
    
    private _onDidUpdateStaging = new vscode.EventEmitter<number>();
    readonly onDidUpdateStaging = this._onDidUpdateStaging.event;

    // Original content of files at the start of the turn
    private originalContents = new Map<string, string>();
    
    // Current "Shadow" content with all AI edits applied so far
    private shadowContents = new Map<string, string>();

    private currentReviewIndex = 0;

    private constructor() {}

    public static getInstance(): ReviewManager {
        if (!ReviewManager.instance) {
            ReviewManager.instance = new ReviewManager();
        }
        return ReviewManager.instance;
    }

    public startTurn() {
        this.originalContents.clear();
        this.shadowContents.clear();
        this.currentReviewIndex = 0;
        vscode.commands.executeCommand('setContext', 'ai-companion.reviewPending', false);
        this._onDidUpdateStaging.fire(0);
    }

    /**
     * Ensures we have the initial state for a file.
     */
    public async ensureInitialized(uri: vscode.Uri) {
        const key = uri.toString();
        if (!this.originalContents.has(key)) {
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                const content = doc.getText();
                this.originalContents.set(key, content);
                this.shadowContents.set(key, content);
            } catch (e) {
                this.originalContents.set(key, '');
                this.shadowContents.set(key, '');
            }
        }
    }

    /**
     * Gets the latest shadow content for a file (or real content if not modified yet).
     */
    public getShadowContent(uri: vscode.Uri): string {
        return this.shadowContents.get(uri.toString()) || '';
    }

    /**
     * Updates the shadow content for a file and notifies the diff view.
     */
    public updateShadow(uri: vscode.Uri, content: string) {
        const key = uri.toString();
        this.shadowContents.set(key, content);
        
        // Update virtual document for diffing
        const shadowUri = this.getShadowUri(uri);
        DiffContentProvider.getInstance().updateContent(shadowUri, content);
        
        vscode.commands.executeCommand('setContext', 'ai-companion.reviewPending', true);
        this._onDidUpdateStaging.fire(this.shadowContents.size);
    }

    /**
     * Commits all staged changes in the shadow buffer to the actual workspace.
     */
    public async commitAll() {
        const edit = new vscode.WorkspaceEdit();
        const committedUris: vscode.Uri[] = [];
        for (const [uriStr, content] of this.shadowContents.entries()) {
            const uri = vscode.Uri.parse(uriStr);
            const original = this.originalContents.get(uriStr);
            
            if (original !== content) {
                committedUris.push(uri);
                try {
                    // We need a range to replace. If file exists, replace full range.
                    // If it doesn't exist, WorkspaceEdit.createFile can be used, 
                    // but replace on a new URI also works if we open it.
                    const doc = await vscode.workspace.openTextDocument(uri);
                    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                    edit.replace(uri, fullRange, content);
                } catch (e) {
                    // New file case
                    edit.createFile(uri, { overwrite: true });
                    edit.insert(uri, new vscode.Position(0, 0), content);
                }
            }
        }
        
        const success = await vscode.workspace.applyEdit(edit);
        if (success) {
            for (const uri of committedUris) {
                try {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    await doc.save();
                } catch (e) {
                    console.error(`Failed to auto-save committed file ${uri.toString()}:`, e);
                }
            }
            this.startTurn(); // Reset after successful commit
        }
        this._onDidUpdateStaging.fire(this.shadowContents.size);
        return success;
    }

    /**
     * Discards all staged changes.
     */
    public discardAll() {
        this.startTurn();
    }

    public async commitCurrent() {
        let targetUri: vscode.Uri | undefined;
        
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const activeUri = activeEditor.document.uri;
            if (activeUri.scheme === DiffContentProvider.scheme) {
                if (activeUri.query) {
                    targetUri = vscode.Uri.parse(activeUri.query);
                }
            } else {
                targetUri = activeUri;
            }
        }
        
        const uris = this.getStagedUris();
        if (uris.length === 0) return;
        
        if (!targetUri || !this.shadowContents.has(targetUri.toString())) {
            targetUri = uris[this.currentReviewIndex];
        }
        
        const uriStr = targetUri.toString();
        const content = this.shadowContents.get(uriStr);
        const original = this.originalContents.get(uriStr);
        
        if (content !== undefined && original !== content) {
            const edit = new vscode.WorkspaceEdit();
            try {
                const doc = await vscode.workspace.openTextDocument(targetUri);
                const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                edit.replace(targetUri, fullRange, content);
            } catch (e) {
                edit.createFile(targetUri, { overwrite: true });
                edit.insert(targetUri, new vscode.Position(0, 0), content);
            }
            
            const success = await vscode.workspace.applyEdit(edit);
            if (success) {
                try {
                    const doc = await vscode.workspace.openTextDocument(targetUri);
                    await doc.save();
                } catch (e) {
                    console.error(`Failed to auto-save committed file ${uriStr}:`, e);
                }
            }
        }
        
        // Remove from staged
        this.shadowContents.delete(uriStr);
        this.originalContents.delete(uriStr);
        
        const remainingUris = this.getStagedUris();
        if (remainingUris.length === 0) {
            this.startTurn();
        } else {
            this.currentReviewIndex = this.currentReviewIndex % remainingUris.length;
            this.openDiffForIndex(this.currentReviewIndex);
            this._onDidUpdateStaging.fire(remainingUris.length);
        }
    }

    public discardCurrent() {
        let targetUri: vscode.Uri | undefined;
        
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const activeUri = activeEditor.document.uri;
            if (activeUri.scheme === DiffContentProvider.scheme) {
                if (activeUri.query) {
                    targetUri = vscode.Uri.parse(activeUri.query);
                }
            } else {
                targetUri = activeUri;
            }
        }
        
        const uris = this.getStagedUris();
        if (uris.length === 0) return;
        
        if (!targetUri || !this.shadowContents.has(targetUri.toString())) {
            targetUri = uris[this.currentReviewIndex];
        }
        
        const uriStr = targetUri.toString();
        
        this.shadowContents.delete(uriStr);
        this.originalContents.delete(uriStr);
        
        const remainingUris = this.getStagedUris();
        if (remainingUris.length === 0) {
            this.startTurn();
        } else {
            this.currentReviewIndex = this.currentReviewIndex % remainingUris.length;
            this.openDiffForIndex(this.currentReviewIndex);
            this._onDidUpdateStaging.fire(remainingUris.length);
        }
    }

    public getShadowUri(uri: vscode.Uri): vscode.Uri {
        const fileName = uri.path.split('/').pop() || 'file';
        return vscode.Uri.parse(`${DiffContentProvider.scheme}:proposed-${fileName}?${uri.toString()}`);
    }

    public getStagedUris(): vscode.Uri[] {
        return Array.from(this.shadowContents.keys()).map(uriStr => vscode.Uri.parse(uriStr));
    }

    public openNextDiff() {
        const uris = this.getStagedUris();
        if (uris.length === 0) return;
        this.currentReviewIndex = (this.currentReviewIndex + 1) % uris.length;
        this.openDiffForIndex(this.currentReviewIndex);
    }

    public openPrevDiff() {
        const uris = this.getStagedUris();
        if (uris.length === 0) return;
        this.currentReviewIndex = (this.currentReviewIndex - 1 + uris.length) % uris.length;
        this.openDiffForIndex(this.currentReviewIndex);
    }

    public openDiffForIndex(index: number) {
        const uris = this.getStagedUris();
        if (index >= 0 && index < uris.length) {
            this.currentReviewIndex = index;
            const fileUri = uris[index];
            const shadowUri = this.getShadowUri(fileUri);
            const fileName = fileUri.path.split('/').pop() || 'file';
            vscode.commands.executeCommand('vscode.diff', 
                fileUri, 
                shadowUri, 
                `${fileName} (Review Changes ${index + 1}/${uris.length})`
            );
        }
    }
}

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

    // Tracking accepted hunk indices for each file
    private hunkStates = new Map<string, Set<number>>();

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
        this.hunkStates.clear();
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

        const originalUri = this.getOriginalUri(uri);
        const originalContent = this.originalContents.get(key) || '';
        DiffContentProvider.getInstance().updateContent(originalUri, originalContent);
        
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
    public async discardAll() {
        this.startTurn();
        await this.closeDiffEditors();
    }

    private async closeDiffEditors() {
        for (const tabGroup of vscode.window.tabGroups.all) {
            for (const tab of tabGroup.tabs) {
                if (tab.input instanceof vscode.TabInputTextDiff) {
                    if (tab.input.original.scheme === DiffContentProvider.scheme || 
                        tab.input.modified.scheme === DiffContentProvider.scheme) {
                        await vscode.window.tabGroups.close(tab);
                    }
                }
            }
        }
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
        if (uris.length === 0) {
            return;
        }
        
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
        if (uris.length === 0) {
            return;
        }
        
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

    public getOriginalUri(uri: vscode.Uri): vscode.Uri {
        const fileName = uri.path.split('/').pop() || 'file';
        return vscode.Uri.parse(`${DiffContentProvider.scheme}:original-${fileName}?${uri.toString()}`);
    }

    public getStagedUris(): vscode.Uri[] {
        return Array.from(this.shadowContents.keys()).map(uriStr => vscode.Uri.parse(uriStr));
    }

    public openNextDiff() {
        const uris = this.getStagedUris();
        if (uris.length === 0) {
            return;
        }
        this.currentReviewIndex = (this.currentReviewIndex + 1) % uris.length;
        this.openDiffForIndex(this.currentReviewIndex);
    }

    public openPrevDiff() {
        const uris = this.getStagedUris();
        if (uris.length === 0) {
            return;
        }
        this.currentReviewIndex = (this.currentReviewIndex - 1 + uris.length) % uris.length;
        this.openDiffForIndex(this.currentReviewIndex);
    }

    public openDiffForIndex(index: number) {
        const uris = this.getStagedUris();
        if (index >= 0 && index < uris.length) {
            this.currentReviewIndex = index;
            const fileUri = uris[index];
            const shadowUri = this.getShadowUri(fileUri);
            const originalUri = this.getOriginalUri(fileUri);
            const fileName = fileUri.path.split('/').pop() || 'file';
            vscode.commands.executeCommand('vscode.diff', 
                originalUri, 
                shadowUri, 
                `${fileName} (Review Changes ${index + 1}/${uris.length})`
            );
        }
    }

    /**
     * Computes structured hunks for ALL staged files.
     * Returns an array of file entries, each with its hunks.
     */
    public getHunksForAllFiles(): Array<{
        uri: string;
        fileName: string;
        isNewFile: boolean;
        hunks: Array<{
            index: number;
            oldStart: number;
            oldLines: number;
            newStart: number;
            newLines: number;
            lines: string[];
            accepted: boolean;
        }>;
    }> {
        const Diff = require('diff');
        const results: Array<any> = [];

        for (const [uriStr, shadowContent] of this.shadowContents.entries()) {
            const originalContent = this.originalContents.get(uriStr) || '';
            
            // Skip if no changes
            if (originalContent === shadowContent) { continue; }

            const uri = vscode.Uri.parse(uriStr);
            const fileName = uri.path.split('/').pop() || 'file';
            const isNewFile = originalContent === '';

            const patch = Diff.structuredPatch(
                fileName, fileName,
                originalContent, shadowContent,
                '', '', { context: 3 }
            );

            if (!patch.hunks || patch.hunks.length === 0) { continue; }

            // Initialize or get state
            if (!this.hunkStates.has(uriStr)) {
                this.hunkStates.set(uriStr, new Set(patch.hunks.map((_: any, idx: number) => idx)));
            }
            const acceptedSet = this.hunkStates.get(uriStr)!;

            const fileEntry = {
                uri: uriStr,
                fileName,
                isNewFile,
                hunks: patch.hunks.map((hunk: any, idx: number) => ({
                    index: idx,
                    oldStart: hunk.oldStart,
                    oldLines: hunk.oldLines,
                    newStart: hunk.newStart,
                    newLines: hunk.newLines,
                    lines: hunk.lines,
                    accepted: acceptedSet.has(idx)
                }))
            };

            results.push(fileEntry);
        }

        return results;
    }

    /**
     * Commits only the accepted hunks for each file.
     * Reconstructs file content by applying accepted hunks to the original.
     */
    public async commitSelectedHunks(
        selections: Array<{ uri: string; acceptedIndices: number[] }>
    ): Promise<boolean> {
        const Diff = require('diff');
        const edit = new vscode.WorkspaceEdit();
        const committedUris: vscode.Uri[] = [];

        for (const selection of selections) {
            const uriStr = selection.uri;
            const originalContent = this.originalContents.get(uriStr) || '';
            const shadowContent = this.shadowContents.get(uriStr) || '';

            if (originalContent === shadowContent) { continue; }

            const uri = vscode.Uri.parse(uriStr);
            const fileName = uri.path.split('/').pop() || 'file';

            // If all hunks are accepted, just use the full shadow content
            const patch = Diff.structuredPatch(
                fileName, fileName,
                originalContent, shadowContent,
                '', '', { context: 3 }
            );

            const totalHunks = patch.hunks?.length || 0;
            const acceptedSet = new Set(selection.acceptedIndices);

            // If no hunks are accepted, skip this file entirely (keep original)
            if (acceptedSet.size === 0) { continue; }

            let finalContent: string;

            // If all hunks are accepted, use full shadow (avoids any patch edge cases)
            if (acceptedSet.size === totalHunks) {
                finalContent = shadowContent;
            } else {
                // Build a partial patch with only accepted hunks
                const partialPatch = {
                    ...patch,
                    hunks: patch.hunks.filter((_: any, idx: number) => acceptedSet.has(idx))
                };
                
                // Apply the partial patch to the original content
                const patchText = Diff.formatPatch(partialPatch);
                const applied = Diff.applyPatch(originalContent, patchText);
                
                if (applied === false) {
                    // If patch application fails, fall back to full shadow
                    // (better to commit all than lose changes)
                    vscode.window.showWarningMessage(
                        `Partial patch failed for ${fileName}. Committing full changes instead.`
                    );
                    finalContent = shadowContent;
                } else {
                    finalContent = applied;
                }
            }

            committedUris.push(uri);
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                const fullRange = new vscode.Range(
                    doc.positionAt(0),
                    doc.positionAt(doc.getText().length)
                );
                edit.replace(uri, fullRange, finalContent);
            } catch (e) {
                // New file case
                edit.createFile(uri, { overwrite: true });
                edit.insert(uri, new vscode.Position(0, 0), finalContent);
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
        await this.closeDiffEditors();
        return success;
    }

    public toggleHunk(uriStr: string, hunkIndex: number, accepted: boolean) {
        if (!this.hunkStates.has(uriStr)) {
            // Need to compute hunks to initialize state if not already done
            this.getHunksForAllFiles();
        }
        
        const acceptedSet = this.hunkStates.get(uriStr);
        if (acceptedSet) {
            if (accepted) {
                acceptedSet.add(hunkIndex);
            } else {
                acceptedSet.delete(hunkIndex);
            }
        }
    }

    public getAcceptedIndices(uriStr: string): number[] {
        const acceptedSet = this.hunkStates.get(uriStr);
        return acceptedSet ? Array.from(acceptedSet) : [];
    }
}

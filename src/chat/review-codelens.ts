import * as vscode from 'vscode';
import { ReviewManager } from './review-manager';

/**
 * ReviewCodeLensProvider — Displays "✓ Accept" / "✕ Revert" buttons directly in the editor
 * above lines that were modified by the AI agent.
 * 
 * #43: Works with direct-write model — changes are already in the file,
 * CodeLens lets the user accept (keep) or revert them.
 */
export class ReviewCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor() {
        ReviewManager.getInstance().onDidUpdateStaging(() => {
            this._onDidChangeCodeLenses.fire();
        });
    }

    public provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
        const reviewManager = ReviewManager.getInstance();
        const uriStr = document.uri.toString();
        
        const pendingEdits = reviewManager.getPendingEdits(uriStr);
        if (!pendingEdits || pendingEdits.length === 0) {
            return [];
        }

        const lenses: vscode.CodeLens[] = [];

        pendingEdits.forEach((edit, idx) => {
            const line = Math.max(0, edit.startLine);
            const range = new vscode.Range(line, 0, line, 0);

            lenses.push(new vscode.CodeLens(range, {
                title: `$(check) Accept Change`,
                command: 'ai-companion.acceptEdit',
                arguments: [uriStr, idx]
            }));

            lenses.push(new vscode.CodeLens(range, {
                title: `$(discard) Revert Change`,
                command: 'ai-companion.revertEdit',
                arguments: [uriStr, idx]
            }));
        });

        // Add global actions at top of file if there are pending edits
        if (pendingEdits.length > 0) {
            const topRange = new vscode.Range(0, 0, 0, 0);
            lenses.push(new vscode.CodeLens(topRange, {
                title: `$(check-all) Accept All (${pendingEdits.length} changes)`,
                command: 'ai-companion.acceptAll',
                arguments: [uriStr]
            }));
            lenses.push(new vscode.CodeLens(topRange, {
                title: `$(discard) Revert All`,
                command: 'ai-companion.rejectAll',
                arguments: [uriStr]
            }));
        }

        return lenses;
    }
}

/**
 * Decoration Service — Highlights lines that were changed by the AI agent.
 * Green = added/modified lines (changes are already written to the file).
 */
export class ReviewDecorationProvider {
    private static addedDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(76, 175, 80, 0.12)',
        isWholeLine: true,
        overviewRulerColor: 'rgba(76, 175, 80, 0.8)',
        overviewRulerLane: vscode.OverviewRulerLane.Full,
        gutterIconPath: undefined,
        borderWidth: '0 0 0 3px',
        borderStyle: 'solid',
        borderColor: 'rgba(76, 175, 80, 0.6)',
    });

    private static pendingDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(255, 193, 7, 0.08)',
        isWholeLine: true,
        overviewRulerColor: 'rgba(255, 193, 7, 0.6)',
        overviewRulerLane: vscode.OverviewRulerLane.Center,
    });

    public static updateDecorations(editor: vscode.TextEditor) {
        const reviewManager = ReviewManager.getInstance();
        const uriStr = editor.document.uri.toString();
        
        const pendingEdits = reviewManager.getPendingEdits(uriStr);

        if (!pendingEdits || pendingEdits.length === 0) {
            editor.setDecorations(this.addedDecoration, []);
            editor.setDecorations(this.pendingDecoration, []);
            return;
        }

        const addedRanges: vscode.DecorationOptions[] = [];

        pendingEdits.forEach(edit => {
            const startLine = Math.max(0, edit.startLine);
            const endLine = Math.min(editor.document.lineCount - 1, edit.endLine);
            
            for (let i = startLine; i <= endLine; i++) {
                addedRanges.push({
                    range: new vscode.Range(i, 0, i, editor.document.lineAt(i).text.length),
                    hoverMessage: new vscode.MarkdownString(`**AI Change** — Modified by \`${edit.toolName || 'agent'}\``)
                });
            }
        });

        editor.setDecorations(this.addedDecoration, addedRanges);
    }
}

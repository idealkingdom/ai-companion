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

        return lenses;
    }
}

/**
 * Decoration Service — Highlights lines that were changed by the AI agent.
 * Green = added/modified lines (changes are already written to the file).
 * Red gutter = deletion marker on the line where removed content was.
 *
 * Deleted lines are shown via rich hover tooltip on the green added lines,
 * with a diff-formatted code block showing exactly what was removed.
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

    /** Red gutter marker for deletion indicators */
    private static deletionMarker = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        overviewRulerColor: 'rgba(244, 67, 54, 0.8)',
        overviewRulerLane: vscode.OverviewRulerLane.Left,
        before: {
            contentText: '−',
            color: 'rgba(244, 67, 54, 0.85)',
            fontWeight: 'bold',
            textDecoration: 'none; position: relative; margin-right: 4px;',
        },
    });

    public static updateDecorations(editor: vscode.TextEditor) {
        const reviewManager = ReviewManager.getInstance();
        const uriStr = editor.document.uri.toString();

        const pendingEdits = reviewManager.getPendingEdits(uriStr);

        if (!pendingEdits || pendingEdits.length === 0) {
            editor.setDecorations(this.addedDecoration, []);
            editor.setDecorations(this.pendingDecoration, []);
            editor.setDecorations(this.deletionMarker, []);
            return;
        }

        const addedRanges: vscode.DecorationOptions[] = [];
        const deletionRanges: vscode.DecorationOptions[] = [];

        pendingEdits.forEach(edit => {
            const startLine = Math.max(0, edit.startLine);
            const endLine = Math.min(editor.document.lineCount - 1, edit.endLine);

            // Build hover content showing the deleted code (if any)
            let hoverContent: vscode.MarkdownString;

            if (edit.originalContent) {
                const deletedLineCount = edit.originalContent.split('\n').length;
                const escapedOriginal = edit.originalContent;

                hoverContent = new vscode.MarkdownString();
                hoverContent.isTrusted = true;
                hoverContent.appendMarkdown(`**AI Change** — Modified by \`${edit.toolName || 'agent'}\`\n\n`);
                hoverContent.appendMarkdown(`🔴 **${deletedLineCount} line${deletedLineCount !== 1 ? 's' : ''} removed:**\n\n`);
                hoverContent.appendCodeblock(escapedOriginal, 'diff');

                // Add deletion marker on the first line of the edit
                deletionRanges.push({
                    range: new vscode.Range(startLine, 0, startLine, 0),
                    hoverMessage: new vscode.MarkdownString(`🔴 **${deletedLineCount} line${deletedLineCount !== 1 ? 's' : ''} removed** — hover green lines to see deleted code`)
                });
            } else {
                hoverContent = new vscode.MarkdownString(`**AI Change** — New content by \`${edit.toolName || 'agent'}\``);
            }

            // ── Green: added/modified lines with hover showing deleted code ──
            for (let i = startLine; i <= endLine; i++) {
                addedRanges.push({
                    range: new vscode.Range(i, 0, i, editor.document.lineAt(i).text.length),
                    hoverMessage: hoverContent
                });
            }
        });

        editor.setDecorations(this.addedDecoration, addedRanges);
        editor.setDecorations(this.deletionMarker, deletionRanges);
    }
}

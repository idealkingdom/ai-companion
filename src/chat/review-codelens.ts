import * as vscode from 'vscode';
import { ReviewManager } from './review-manager';

/**
 * ReviewCodeLensProvider - Displays "Accept" / "Reject" buttons directly in the editor
 * above pending AI hunks.
 */
export class ReviewCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor() {
        ReviewManager.getInstance().onDidUpdateStaging(() => {
            this._onDidChangeCodeLenses.fire();
        });
    }

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
        const reviewManager = ReviewManager.getInstance();
        const uriStr = document.uri.toString();
        
        // Compute hunks for this file
        const allHunks = reviewManager.getHunksForAllFiles();
        const fileEntry = allHunks.find(f => f.uri === uriStr);

        if (!fileEntry || fileEntry.hunks.length === 0) {
            return [];
        }

        const lenses: vscode.CodeLens[] = [];

        fileEntry.hunks.forEach((hunk, idx) => {
            // Hunk positions are 1-based in structuredPatch
            // We'll place the lens at the start of the hunk
            const line = Math.max(0, hunk.oldStart - 1);
            const range = new vscode.Range(line, 0, line, 0);

            const isAccepted = hunk.accepted;

            lenses.push(new vscode.CodeLens(range, {
                title: isAccepted ? "$(check) Accepted" : "$(circle-outline) Accept Hunk",
                command: 'ai-companion.toggleHunk',
                arguments: [uriStr, hunk.index, true]
            }));

            lenses.push(new vscode.CodeLens(range, {
                title: !isAccepted ? "$(x) Rejected" : "$(circle-slash) Reject Hunk",
                command: 'ai-companion.toggleHunk',
                arguments: [uriStr, hunk.index, false]
            }));
        });

        return lenses;
    }
}

/**
 * Decoration Service for highlighting added/removed lines in the actual file.
 */
export class ReviewDecorationProvider {
    private static addedDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(76, 175, 80, 0.15)',
        isWholeLine: true,
        overviewRulerColor: 'rgba(76, 175, 80, 0.8)',
        overviewRulerLane: vscode.OverviewRulerLane.Full,
    });

    private static removedDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(244, 67, 54, 0.15)',
        isWholeLine: true,
        overviewRulerColor: 'rgba(244, 67, 54, 0.8)',
        overviewRulerLane: vscode.OverviewRulerLane.Full,
        after: {
            contentText: ' (Lines will be removed)',
            fontStyle: 'italic',
            margin: '0 0 0 1em'
        }
    });

    public static updateDecorations(editor: vscode.TextEditor) {
        const reviewManager = ReviewManager.getInstance();
        const uriStr = editor.document.uri.toString();
        
        const allHunks = reviewManager.getHunksForAllFiles();
        const fileEntry = allHunks.find(f => f.uri === uriStr);

        if (!fileEntry) {
            editor.setDecorations(this.addedDecoration, []);
            editor.setDecorations(this.removedDecoration, []);
            return;
        }

        const addedRanges: vscode.Range[] = [];
        const removedRanges: vscode.Range[] = [];

        fileEntry.hunks.forEach(hunk => {
            // We highlight the whole hunk area if it's active
            // Note: Diff hunks give us line numbers. 
            // This is a simplified visualization.
            let currentLine = hunk.oldStart - 1;
            
            hunk.lines.forEach(line => {
                if (line.startsWith('+')) {
                    // Added line in shadow. In original file, we can't show it perfectly 
                    // without modifying the doc, but we can highlight the insertion point.
                    addedRanges.push(new vscode.Range(currentLine, 0, currentLine, 0));
                } else if (line.startsWith('-')) {
                    removedRanges.push(new vscode.Range(currentLine, 0, currentLine, 0));
                    currentLine++;
                } else {
                    currentLine++;
                }
            });
        });

        editor.setDecorations(this.addedDecoration, addedRanges);
        editor.setDecorations(this.removedDecoration, removedRanges);
    }
}

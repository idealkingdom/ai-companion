import * as vscode from 'vscode';

export class DiffContentProvider implements vscode.TextDocumentContentProvider {
    static readonly scheme = 'ai-companion-preview';
    private static instance: DiffContentProvider;
    
    private contentMap = new Map<string, string>();
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    private constructor() {}

    public static getInstance(): DiffContentProvider {
        if (!DiffContentProvider.instance) {
            DiffContentProvider.instance = new DiffContentProvider();
        }
        return DiffContentProvider.instance;
    }

    /**
     * Updates the content for a specific URI and notifies VS Code of the change.
     */
    public updateContent(uri: vscode.Uri, content: string) {
        this.contentMap.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }

    /**
     * Clears content for a URI.
     */
    public clearContent(uri: vscode.Uri) {
        this.contentMap.delete(uri.toString());
        this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contentMap.get(uri.toString()) || '';
    }
}

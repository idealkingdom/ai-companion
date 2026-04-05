import * as vscode from 'vscode';

export interface FileEntry {
    path: string;
    relativePath: string;
    size: number;
    language: string;
}

export interface SymbolEntry {
    name: string;
    kind: string;
    containerName: string;
    range: { startLine: number; endLine: number };
    filePath: string;
}

export interface WorkspaceIndex {
    fileTree: FileEntry[];
    lastUpdated: number;
}

/**
 * Lightweight workspace indexer that exploits VS Code's existing infrastructure.
 * No vector DB, no embeddings — just fast in-memory caching.
 */
export class WorkspaceIndexService {
    private index: WorkspaceIndex = { fileTree: [], lastUpdated: 0 };
    private disposables: vscode.Disposable[] = [];

    constructor() {
        // Auto-refresh on file changes
        this.disposables.push(
            vscode.workspace.onDidCreateFiles(() => this.refresh()),
            vscode.workspace.onDidDeleteFiles(() => this.refresh()),
            vscode.workspace.onDidRenameFiles(() => this.refresh())
        );
    }

    /**
     * Build or rebuild the file tree index
     */
    public async refresh(): Promise<void> {
        const files = await vscode.workspace.findFiles(
            '**/*',
            '{**/node_modules/**,**/dist/**,**/build/**,**/.git/**,**/out/**,**/.vscode/**}'
        );

        this.index.fileTree = files.map(uri => {
            const rel = vscode.workspace.asRelativePath(uri);
            const ext = uri.fsPath.split('.').pop()?.toLowerCase() || '';
            return {
                path: uri.fsPath,
                relativePath: rel,
                size: 0,  // We skip stat for speed; size is optional
                language: ext
            };
        }).sort((a, b) => a.relativePath.localeCompare(b.relativePath));

        this.index.lastUpdated = Date.now();
    }

    /**
     * Returns a compact file tree string for the AI (token-efficient)
     */
    public getFileTreeString(): string {
        if (this.index.fileTree.length === 0) {
            return 'Workspace index is empty. Call refresh first.';
        }

        let tree = '';
        let prevParts: string[] = [];

        for (const file of this.index.fileTree) {
            const parts = file.relativePath.split(/[\\/]/);
            const fileName = parts.pop()!;

            // Print new directories
            let commonLen = 0;
            while (commonLen < parts.length && commonLen < prevParts.length && parts[commonLen] === prevParts[commonLen]) {
                commonLen++;
            }

            for (let i = commonLen; i < parts.length; i++) {
                tree += '  '.repeat(i) + parts[i] + '/\n';
            }

            tree += '  '.repeat(parts.length) + fileName + '\n';
            prevParts = parts;
        }

        return tree;
    }

    /**
     * Get the raw file list (for tool results)
     */
    public getFileList(): string[] {
        return this.index.fileTree.map(f => f.relativePath);
    }

    /**
     * Use VS Code's built-in document symbol provider (Language Server)
     * Returns function/class signatures for a given file.
     */
    public async getFileSymbols(filePath: string): Promise<SymbolEntry[]> {
        const uri = vscode.Uri.file(filePath);
        const symbols: vscode.DocumentSymbol[] | undefined = await vscode.commands.executeCommand(
            'vscode.executeDocumentSymbolProvider', uri
        );

        if (!symbols) { return []; }

        const results: SymbolEntry[] = [];
        this.flattenSymbols(symbols, filePath, results);
        return results;
    }

    private flattenSymbols(symbols: vscode.DocumentSymbol[], filePath: string, out: SymbolEntry[], container = ''): void {
        for (const sym of symbols) {
            out.push({
                name: sym.name,
                kind: vscode.SymbolKind[sym.kind],
                containerName: container,
                range: { startLine: sym.range.start.line + 1, endLine: sym.range.end.line + 1 },
                filePath: filePath
            });

            if (sym.children && sym.children.length > 0) {
                this.flattenSymbols(sym.children, filePath, out, sym.name);
            }
        }
    }

    /**
     * Search workspace using VS Code's built-in workspace symbol provider
     */
    public async findSymbol(query: string): Promise<SymbolEntry[]> {
        const symbols: vscode.SymbolInformation[] | undefined = await vscode.commands.executeCommand(
            'vscode.executeWorkspaceSymbolProvider', query
        );

        if (!symbols) { return []; }

        return symbols.slice(0, 30).map(sym => ({
            name: sym.name,
            kind: vscode.SymbolKind[sym.kind],
            containerName: sym.containerName,
            range: {
                startLine: sym.location.range.start.line + 1,
                endLine: sym.location.range.end.line + 1
            },
            filePath: sym.location.uri.fsPath
        }));
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}

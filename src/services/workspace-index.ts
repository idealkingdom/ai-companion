import * as vscode from 'vscode';
import * as fs from 'fs';

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
 * 
 * Token-saving features:
 * - Compact tree: summarises directories with many files instead of listing every one
 * - Skeleton cache: avoids re-reading file structures the agent has already seen
 * - Active editor context: auto-injects skeletons of currently open files
 */
export class WorkspaceIndexService {
    private index: WorkspaceIndex = { fileTree: [], lastUpdated: 0 };
    private disposables: vscode.Disposable[] = [];

    /** Cache of file skeletons so repeated read_file_skeleton calls are free */
    private skeletonCache = new Map<string, { skeleton: string; totalLines: number; mtime: number }>();

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
     * Returns a compact file tree string for the AI (token-efficient).
     * Full tree mode: every file listed (legacy behaviour, used by list_workspace tool).
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
     * Returns a COMPACT tree string that summarises large directories.
     * Directories with > maxFilesPerDir files get collapsed to "{dir}/ (N files)".
     * Top-level files and key directories (src, lib, app) are always expanded.
     * This dramatically reduces token count for large projects.
     */
    public getCompactTreeString(maxFilesPerDir: number = 8): string {
        if (this.index.fileTree.length === 0) {
            return '(empty workspace)';
        }

        // Group files by their top-level directory
        const rootFiles: string[] = [];
        const dirMap = new Map<string, string[]>(); // dir -> list of relative paths under it

        for (const file of this.index.fileTree) {
            const parts = file.relativePath.split(/[\\/]/);
            if (parts.length === 1) {
                rootFiles.push(parts[0]);
            } else {
                const topDir = parts[0];
                if (!dirMap.has(topDir)) {
                    dirMap.set(topDir, []);
                }
                dirMap.get(topDir)!.push(file.relativePath);
            }
        }

        let tree = '';

        // Root files first
        for (const f of rootFiles) {
            tree += f + '\n';
        }

        // Key directories that should always be expanded
        const keyDirs = new Set(['src', 'lib', 'app', 'pages', 'components', 'webview', 'test', 'tests', '__tests__']);

        // Directories
        for (const [dir, files] of dirMap.entries()) {
            const shouldExpand = keyDirs.has(dir) || files.length <= maxFilesPerDir;

            if (shouldExpand) {
                // Build a mini-tree for this directory
                let prevParts: string[] = [];
                for (const relPath of files) {
                    const parts = relPath.split(/[\\/]/);
                    const fileName = parts.pop()!;

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
            } else {
                // Collapse: just show directory name and count
                // But list unique subdirectories as hints
                const subDirs = new Set<string>();
                const exts = new Map<string, number>();
                for (const relPath of files) {
                    const parts = relPath.split(/[\\/]/);
                    if (parts.length > 2) {
                        subDirs.add(parts[1]);
                    }
                    const ext = relPath.split('.').pop()?.toLowerCase() || '';
                    exts.set(ext, (exts.get(ext) || 0) + 1);
                }
                
                const extSummary = Array.from(exts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 4)
                    .map(([ext, count]) => `${count} .${ext}`)
                    .join(', ');

                tree += `${dir}/ (${files.length} files: ${extSummary})`;
                if (subDirs.size > 0) {
                    tree += ` [subdirs: ${Array.from(subDirs).slice(0, 6).join(', ')}]`;
                }
                tree += '\n';
            }
        }

        return tree;
    }

    /**
     * Get the raw file list (for tool results)
     */
    public getFileList(): string[] {
        return this.index.fileTree.map(f => f.relativePath);
    }

    // ─── SKELETON CACHE ────────────────────────────────────────────────

    /**
     * Get a cached skeleton for a file path. Returns null if not cached or stale.
     */
    public getCachedSkeleton(absPath: string): { skeleton: string; totalLines: number } | null {
        const cached = this.skeletonCache.get(absPath);
        if (!cached) { return null; }

        // Check freshness — invalidate if file was modified
        try {
            const stat = fs.statSync(absPath);
            if (stat.mtimeMs > cached.mtime) {
                this.skeletonCache.delete(absPath);
                return null;
            }
        } catch {
            this.skeletonCache.delete(absPath);
            return null;
        }

        return { skeleton: cached.skeleton, totalLines: cached.totalLines };
    }

    /**
     * Store a skeleton in the cache
     */
    public cacheSkeleton(absPath: string, skeleton: string, totalLines: number): void {
        let mtime = Date.now();
        try {
            const stat = fs.statSync(absPath);
            mtime = stat.mtimeMs;
        } catch { /* use current time as fallback */ }

        this.skeletonCache.set(absPath, { skeleton, totalLines, mtime });

        // Evict old entries if cache is too large
        if (this.skeletonCache.size > 100) {
            const oldest = this.skeletonCache.keys().next().value;
            if (oldest) { this.skeletonCache.delete(oldest); }
        }
    }

    // ─── ACTIVE EDITOR CONTEXT ─────────────────────────────────────────

    /**
     * Returns a compact context string of currently open editor files.
     * Includes skeleton (imports + function signatures) so the agent
     * doesn't need to waste a tool call reading them.
     */
    public getActiveEditorContext(): string {
        const editors = vscode.window.visibleTextEditors;
        if (editors.length === 0) { return ''; }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const seen = new Set<string>();
        const sections: string[] = [];

        for (const editor of editors) {
            const uri = editor.document.uri;
            if (uri.scheme !== 'file') { continue; }
            if (seen.has(uri.fsPath)) { continue; }
            seen.add(uri.fsPath);

            const relPath = vscode.workspace.asRelativePath(uri);
            const content = editor.document.getText();
            const lines = content.split('\n');
            const skeleton = this.extractSkeleton(lines);

            if (skeleton.length === 0) { continue; }

            // Also include the lines around the cursor for extra context
            const cursorLine = editor.selection.active.line;
            const cursorStart = Math.max(0, cursorLine - 3);
            const cursorEnd = Math.min(lines.length - 1, cursorLine + 3);
            const cursorContext = lines.slice(cursorStart, cursorEnd + 1)
                .map((l, i) => `L${cursorStart + i + 1}: ${l}`)
                .join('\n');

            sections.push(`[${relPath}] (${lines.length} lines, cursor at L${cursorLine + 1})\n${skeleton.join('\n')}\n--- cursor context ---\n${cursorContext}`);
        }

        if (sections.length === 0) { return ''; }
        return sections.join('\n\n');
    }

    /**
     * Extract skeleton lines from file content (imports, exports, signatures)
     */
    private extractSkeleton(lines: string[]): string[] {
        const skeleton: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith('import ') || trimmed.startsWith('from ') || (trimmed.startsWith('const ') && trimmed.includes('require('))) {
                skeleton.push(`L${i + 1}: ${line}`);
            } else if (trimmed.startsWith('export ')) {
                skeleton.push(`L${i + 1}: ${line}`);
            } else if (/^\s*(export\s+)?(abstract\s+)?(class|interface|type|enum)\s/.test(line)) {
                skeleton.push(`L${i + 1}: ${line}`);
            } else if (/^\s*(export\s+)?(async\s+)?(function|const\s+\w+\s*=\s*(async\s*)?\(|public|private|protected|static)\s/.test(line)) {
                skeleton.push(`L${i + 1}: ${line}`);
            } else if (/^\s*(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/.test(line)) {
                skeleton.push(`L${i + 1}: ${line}`);
            } else if (/^\s*def\s+\w+/.test(line) || /^\s*class\s+\w+/.test(line)) {
                // Python support
                skeleton.push(`L${i + 1}: ${line}`);
            }
        }
        return skeleton;
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

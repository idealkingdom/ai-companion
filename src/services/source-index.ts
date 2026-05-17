/**
 * Source Index Service
 * 
 * Manages persistent storage and retrieval of indexed content sources.
 * Sources can be URLs (web pages) or documents (PDF, Excel, Word).
 * Data is stored in VS Code's globalState for persistence.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { outputChannel } from '../logger';

// ─── DATA MODELS ─────────────────────────────────────────────────────────

export type SourceType = 'url' | 'pdf' | 'excel' | 'word' | 'text';
export type SourceStatus = 'pending' | 'indexing' | 'indexed' | 'error' | 'updating';

export interface IndexedSource {
    id: string;
    type: SourceType;
    /** URL for web sources, file name for documents */
    origin: string;
    title: string;
    content: string;
    /** Extracted text content chunks for search */
    chunks: string[];
    metadata: {
        dateIndexed: string;
        lastUpdated: string;
        contentType: string;
        sizeBytes: number;
        wordCount: number;
        errorMessage?: string;
    };
    status: SourceStatus;
}

export interface SourceIndexData {
    sources: IndexedSource[];
    lastGlobalUpdate: string;
}

// ─── SERVICE ─────────────────────────────────────────────────────────────

export class SourceIndexService {
    private static readonly STORAGE_KEY = 'kdaina.sourceIndex';
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    // ─── READ ────────────────────────────────────────────────────────────

    public getData(): SourceIndexData {
        const stored = this.context.globalState.get<SourceIndexData>(SourceIndexService.STORAGE_KEY);
        return stored || { sources: [], lastGlobalUpdate: new Date().toISOString() };
    }

    public getSources(): IndexedSource[] {
        return this.getData().sources;
    }

    public getSource(id: string): IndexedSource | undefined {
        return this.getSources().find(s => s.id === id);
    }

    // ─── WRITE ───────────────────────────────────────────────────────────

    public async addSource(source: Omit<IndexedSource, 'id'>): Promise<IndexedSource> {
        const data = this.getData();
        const newSource: IndexedSource = {
            ...source,
            id: crypto.randomUUID()
        };
        data.sources.push(newSource);
        data.lastGlobalUpdate = new Date().toISOString();
        await this.save(data);
        outputChannel.appendLine(`[SourceIndex] Added source: ${newSource.title} (${newSource.id})`);
        return newSource;
    }

    public async updateSource(id: string, updates: Partial<IndexedSource>): Promise<IndexedSource | null> {
        const data = this.getData();
        const idx = data.sources.findIndex(s => s.id === id);
        if (idx === -1) { return null; }

        data.sources[idx] = { ...data.sources[idx], ...updates };
        data.lastGlobalUpdate = new Date().toISOString();
        await this.save(data);
        outputChannel.appendLine(`[SourceIndex] Updated source: ${id}`);
        return data.sources[idx];
    }

    public async deleteSource(id: string): Promise<boolean> {
        const data = this.getData();
        const before = data.sources.length;
        data.sources = data.sources.filter(s => s.id !== id);
        if (data.sources.length === before) { return false; }

        data.lastGlobalUpdate = new Date().toISOString();
        await this.save(data);
        outputChannel.appendLine(`[SourceIndex] Deleted source: ${id}`);
        return true;
    }

    public async clearAll(): Promise<void> {
        await this.save({ sources: [], lastGlobalUpdate: new Date().toISOString() });
        outputChannel.appendLine(`[SourceIndex] Cleared all sources`);
    }

    // ─── SEARCH ──────────────────────────────────────────────────────────

    /**
     * Full-text search across all indexed content.
     * Returns sources with matching content, ranked by relevance.
     */
    public search(query: string, maxResults: number = 10): { source: IndexedSource; matches: string[] }[] {
        if (!query.trim()) { return []; }

        const sources = this.getSources().filter(s => s.status === 'indexed');
        const queryLower = query.toLowerCase();
        const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

        const results: { source: IndexedSource; matches: string[]; score: number }[] = [];

        for (const source of sources) {
            const matches: string[] = [];
            let score = 0;

            // Title match (high weight)
            if (source.title.toLowerCase().includes(queryLower)) {
                score += 10;
                matches.push(`Title: "${source.title}"`);
            }

            // Content match
            for (const chunk of source.chunks) {
                const chunkLower = chunk.toLowerCase();
                let chunkScore = 0;

                for (const term of queryTerms) {
                    if (chunkLower.includes(term)) {
                        chunkScore++;
                    }
                }

                if (chunkScore > 0) {
                    score += chunkScore;
                    // Extract snippet around match
                    const idx = chunkLower.indexOf(queryTerms[0] || queryLower);
                    if (idx !== -1) {
                        const start = Math.max(0, idx - 50);
                        const end = Math.min(chunk.length, idx + 100);
                        matches.push('...' + chunk.substring(start, end).trim() + '...');
                    }
                }
            }

            if (score > 0) {
                results.push({ source, matches: matches.slice(0, 3), score });
            }
        }

        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults)
            .map(({ source, matches }) => ({ source, matches }));
    }

    /**
     * Get all indexed content as a single context string for AI usage.
     */
    public getIndexedContext(): string {
        const sources = this.getSources().filter(s => s.status === 'indexed');
        if (sources.length === 0) { return ''; }

        let context = '--- INDEXED KNOWLEDGE BASE ---\n\n';
        for (const source of sources) {
            context += `[Source: ${source.title} | Type: ${source.type} | Origin: ${source.origin}]\n`;
            context += source.content.substring(0, 5000); // Limit per source
            context += '\n\n---\n\n';
        }

        return context;
    }

    // ─── INTERNAL ────────────────────────────────────────────────────────

    private async save(data: SourceIndexData): Promise<void> {
        await this.context.globalState.update(SourceIndexService.STORAGE_KEY, data);
    }

    /**
     * Chunk content into searchable segments.
     */
    public static chunkContent(content: string, chunkSize: number = 500): string[] {
        const chunks: string[] = [];
        const paragraphs = content.split(/\n\n+/);
        let currentChunk = '';

        for (const para of paragraphs) {
            if (currentChunk.length + para.length > chunkSize && currentChunk.length > 0) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            currentChunk += para + '\n\n';
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        return chunks;
    }
}

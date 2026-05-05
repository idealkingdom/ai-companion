/**
 * Smart Generate Service
 * AI-powered prompt generation from indexed content.
 */
import { outputChannel } from '../logger';
import { SourceIndexService, IndexedSource } from './source-index';
import { SettingsManager } from './settings-manager';
import * as vscode from 'vscode';

export interface GeneratedPrompt {
    id: string;
    prompt: string;
    category: string;
    source: string;
    timestamp: string;
}

export interface PromptHistoryEntry {
    id: string;
    prompt: string;
    generatedAt: string;
    usedAt?: string;
    sourceIds: string[];
}

export class SmartGenerateService {
    private static readonly HISTORY_KEY = 'aiCompanion.promptHistory';
    private context: vscode.ExtensionContext;
    private sourceIndex: SourceIndexService;
    private settingsManager: SettingsManager;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.sourceIndex = new SourceIndexService(context);
        this.settingsManager = new SettingsManager(context);
    }

    /**
     * Generate contextual prompts based on indexed sources.
     */
    public async generatePrompts(userHint?: string): Promise<GeneratedPrompt[]> {
        const sources = this.sourceIndex.getSources().filter(s => s.status === 'indexed');
        if (sources.length === 0) {
            return [{
                id: 'empty-hint',
                prompt: 'Add some sources first to generate contextual prompts.',
                category: 'info',
                source: 'system',
                timestamp: new Date().toISOString()
            }];
        }

        const prompts: GeneratedPrompt[] = [];
        const now = new Date().toISOString();

        // Template-based generation from source content
        for (const source of sources.slice(0, 5)) {
            const summary = source.content.substring(0, 300).trim();
            const keywords = this.extractKeywords(source.content);

            prompts.push({
                id: `summary-${source.id}`,
                prompt: `Summarize the key points from "${source.title}" and highlight the most important information.`,
                category: 'Summary',
                source: source.title,
                timestamp: now
            });

            if (keywords.length > 2) {
                prompts.push({
                    id: `analyze-${source.id}`,
                    prompt: `Analyze the content about ${keywords.slice(0, 3).join(', ')} from "${source.title}" and provide actionable insights.`,
                    category: 'Analysis',
                    source: source.title,
                    timestamp: now
                });
            }

            if (source.type === 'url') {
                prompts.push({
                    id: `compare-${source.id}`,
                    prompt: `Based on the information from "${source.title}", what are the best practices and how do they compare to current standards?`,
                    category: 'Research',
                    source: source.title,
                    timestamp: now
                });
            }
        }

        // Cross-source prompts
        if (sources.length >= 2) {
            const titles = sources.slice(0, 3).map(s => `"${s.title}"`).join(', ');
            prompts.push({
                id: `cross-${Date.now()}`,
                prompt: `Compare and contrast the information from ${titles}. What common themes or contradictions exist?`,
                category: 'Cross-Reference',
                source: 'Multiple',
                timestamp: now
            });
        }

        // User hint based prompt
        if (userHint) {
            prompts.unshift({
                id: `hint-${Date.now()}`,
                prompt: `Using the indexed knowledge base, ${userHint}`,
                category: 'Custom',
                source: 'User Request',
                timestamp: now
            });
        }

        return prompts;
    }

    /**
     * Save a prompt to history.
     */
    public async saveToHistory(prompt: string, sourceIds: string[]): Promise<void> {
        const history = this.getHistory();
        history.unshift({
            id: `ph-${Date.now()}`,
            prompt,
            generatedAt: new Date().toISOString(),
            sourceIds
        });
        // Keep last 50
        if (history.length > 50) { history.splice(50); }
        await this.context.globalState.update(SmartGenerateService.HISTORY_KEY, history);
    }

    /**
     * Get prompt history.
     */
    public getHistory(): PromptHistoryEntry[] {
        return this.context.globalState.get<PromptHistoryEntry[]>(SmartGenerateService.HISTORY_KEY) || [];
    }

    /**
     * Clear prompt history.
     */
    public async clearHistory(): Promise<void> {
        await this.context.globalState.update(SmartGenerateService.HISTORY_KEY, []);
    }

    /**
     * Extract key terms from content for prompt generation.
     */
    private extractKeywords(content: string): string[] {
        const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'and', 'but', 'or', 'not', 'no', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such', 'than', 'too', 'very', 'just', 'about', 'above', 'this', 'that', 'these', 'those', 'it', 'its']);

        const words = content.toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3 && !stopWords.has(w));

        const freq = new Map<string, number>();
        for (const word of words) {
            freq.set(word, (freq.get(word) || 0) + 1);
        }

        return Array.from(freq.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([word]) => word);
    }
}

/**
 * Web Tools — Agent tools for web scraping and URL content fetching.
 * Implements #45 (Improve web scraper) and #46 (Web search integration).
 */
import { tool as _tool } from 'ai';
const tool = _tool as any;
import { z } from 'zod';
import { WebScraperService } from '../services/web-scraper';

// Singleton scraper with cache
const scraper = new WebScraperService();
const scrapeCache = new Map<string, { content: string; title: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function createWebTools() {
    return {
        /**
         * Scrape a URL and return its text content.
         * Results are cached for 5 minutes to avoid redundant fetches.
         */
        scrape_url: tool({
            description: 'Fetch and extract text content from a web URL. Use this to read documentation, web pages, API references, or any URL the user provides. Results are cached.',
            inputSchema: z.object({
                url: z.string().describe('The URL to scrape (must start with http:// or https://)'),
                maxLength: z.number().optional().describe('Maximum characters to return (default: 8000)')
            }),
            execute: async (params: { url: string; maxLength?: number }) => {
                const max = params.maxLength || 8000;

                // Check cache
                const cached = scrapeCache.get(params.url);
                if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
                    const content = cached.content.length > max
                        ? cached.content.substring(0, max) + '\n\n[Content truncated — full page: ' + cached.content.length + ' chars]'
                        : cached.content;
                    return {
                        title: cached.title,
                        content,
                        cached: true,
                        wordCount: content.split(/\s+/).length
                    };
                }

                const result = await scraper.scrape(params.url);

                if (!result.success) {
                    return { error: result.error || 'Failed to scrape URL' };
                }

                // Cache the result
                scrapeCache.set(params.url, {
                    content: result.content,
                    title: result.title,
                    timestamp: Date.now()
                });

                const content = result.content.length > max
                    ? result.content.substring(0, max) + '\n\n[Content truncated — full page: ' + result.content.length + ' chars]'
                    : result.content;

                return {
                    title: result.title,
                    content,
                    wordCount: result.wordCount,
                    cached: false
                };
            }
        } as any)
    };
}

/**
 * Web Tools — Agent tools for web scraping and web search.
 * Implements #45 (Improve web scraper) and #46 (Web search integration).
 */
import { tool as _tool } from 'ai';
const tool = _tool as any;
import { z } from 'zod';
import { WebScraperService } from '../services/web-scraper';
import { outputChannel } from '../logger';
import * as https from 'https';

// Singleton scraper with cache
const scraper = new WebScraperService();
const scrapeCache = new Map<string, { content: string; title: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Perform a web search using DuckDuckGo HTML (no API key required).
 * Parses the results page to extract titles, snippets, and URLs.
 */
async function duckDuckGoSearch(query: string, numResults: number = 5): Promise<{ title: string; snippet: string; url: string }[]> {
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    return new Promise((resolve, reject) => {
        const req = https.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 10000
        }, (res) => {
            // Handle redirects
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                https.get(res.headers.location, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html'
                    }
                }, (res2) => {
                    let data = '';
                    res2.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                    res2.on('end', () => resolve(parseDDGResults(data, numResults)));
                    res2.on('error', reject);
                });
                return;
            }

            let data = '';
            res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
            res.on('end', () => resolve(parseDDGResults(data, numResults)));
            res.on('error', reject);
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Search request timed out')); });
    });
}

/**
 * Parse DuckDuckGo HTML results page.
 */
function parseDDGResults(html: string, maxResults: number): { title: string; snippet: string; url: string }[] {
    const results: { title: string; snippet: string; url: string }[] = [];

    // Match result blocks: <a class="result__a" href="...">title</a> + <a class="result__snippet">snippet</a>
    const resultBlocks = html.match(/<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi) || [];

    // Simpler: extract all result links and snippets directly
    const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    const links: { url: string; title: string }[] = [];
    const snippets: string[] = [];

    let match;
    while ((match = linkRegex.exec(html)) !== null) {
        let href = match[1];
        // DuckDuckGo wraps URLs — extract the real URL from uddg parameter
        if (href.includes('uddg=')) {
            const uddg = href.match(/uddg=([^&]*)/);
            if (uddg) { href = decodeURIComponent(uddg[1]); }
        }
        const title = match[2].replace(/<[^>]+>/g, '').trim();
        links.push({ url: href, title });
    }

    while ((match = snippetRegex.exec(html)) !== null) {
        const snippet = match[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
        snippets.push(snippet);
    }

    for (let i = 0; i < Math.min(links.length, maxResults); i++) {
        results.push({
            title: links[i].title,
            url: links[i].url,
            snippet: snippets[i] || ''
        });
    }

    return results;
}

function decodeHtml(str: string): string {
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

export function createWebTools() {
    return {
        /**
         * Search the web for current information using DuckDuckGo.
         * No API key required. Returns titles, snippets, and URLs.
         */
        web_search: tool({
            description: 'Search the web for current information. ALWAYS use this when: (1) the user asks about something you\'re unsure about, (2) the user mentions a library/API/tool you don\'t have docs for, (3) the user asks "what is" or "how to" questions about unfamiliar topics, (4) you need up-to-date information (versions, changelogs, latest docs). Returns top results with titles, snippets, and URLs. Follow up with scrape_url for deeper content.',
            inputSchema: z.object({
                query: z.string().describe('The search query string'),
                numResults: z.number().optional().describe('Number of results to return (default: 5, max: 10)')
            }),
            execute: async (params: { query: string; numResults?: number }) => {
                const num = Math.min(params.numResults || 5, 10);
                outputChannel.appendLine(`[WebSearch] Searching: "${params.query}" (top ${num})`);

                try {
                    const results = await duckDuckGoSearch(params.query, num);

                    if (results.length === 0) {
                        return { results: [], message: 'No results found. Try refining your search query.' };
                    }

                    outputChannel.appendLine(`[WebSearch] Found ${results.length} results for "${params.query}"`);

                    return {
                        query: params.query,
                        results: results.map((r, i) => ({
                            rank: i + 1,
                            title: r.title,
                            snippet: r.snippet,
                            url: r.url
                        })),
                        tip: 'Use scrape_url on a result URL to get full page content.'
                    };
                } catch (err: any) {
                    outputChannel.appendLine(`[WebSearch] Error: ${err.message}`);
                    return { error: `Search failed: ${err.message}` };
                }
            }
        } as any),

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

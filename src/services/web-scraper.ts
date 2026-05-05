/**
 * Web Scraper Service
 * 
 * Handles fetching and extracting text content from web pages.
 * Includes rate limiting, error handling, and content cleaning.
 */
import { outputChannel } from '../logger';
import * as https from 'https';
import * as http from 'http';
import * as url from 'url';

// ─── TYPES ───────────────────────────────────────────────────────────────

export interface ScrapeResult {
    success: boolean;
    title: string;
    content: string;
    contentType: string;
    sizeBytes: number;
    wordCount: number;
    error?: string;
}

// ─── RATE LIMITER ────────────────────────────────────────────────────────

class RateLimiter {
    private lastRequest = 0;
    private readonly minInterval: number;

    constructor(requestsPerSecond: number = 1) {
        this.minInterval = 1000 / requestsPerSecond;
    }

    async wait(): Promise<void> {
        const now = Date.now();
        const elapsed = now - this.lastRequest;
        if (elapsed < this.minInterval) {
            await new Promise(resolve => setTimeout(resolve, this.minInterval - elapsed));
        }
        this.lastRequest = Date.now();
    }
}

// ─── SERVICE ─────────────────────────────────────────────────────────────

export class WebScraperService {
    private rateLimiter = new RateLimiter(1); // 1 request per second
    private static readonly MAX_CONTENT_SIZE = 5 * 1024 * 1024; // 5MB
    private static readonly REQUEST_TIMEOUT = 15000; // 15 seconds
    private static readonly MAX_RETRIES = 2;

    /**
     * Scrape a URL and return extracted text content.
     */
    public async scrape(targetUrl: string): Promise<ScrapeResult> {
        // Validate URL
        if (!this.isValidUrl(targetUrl)) {
            return {
                success: false,
                title: '',
                content: '',
                contentType: '',
                sizeBytes: 0,
                wordCount: 0,
                error: 'Invalid URL format'
            };
        }

        await this.rateLimiter.wait();
        outputChannel.appendLine(`[WebScraper] Fetching: ${targetUrl}`);

        let lastError = '';
        for (let attempt = 0; attempt <= WebScraperService.MAX_RETRIES; attempt++) {
            try {
                const html = await this.fetchUrl(targetUrl);
                const title = this.extractTitle(html);
                const content = this.extractTextContent(html);
                const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;

                outputChannel.appendLine(`[WebScraper] Success: ${targetUrl} — ${wordCount} words`);

                return {
                    success: true,
                    title: title || new URL(targetUrl).hostname,
                    content,
                    contentType: 'text/html',
                    sizeBytes: Buffer.byteLength(content, 'utf8'),
                    wordCount
                };
            } catch (err: any) {
                lastError = err.message || 'Unknown error';
                outputChannel.appendLine(`[WebScraper] Attempt ${attempt + 1} failed: ${lastError}`);
                if (attempt < WebScraperService.MAX_RETRIES) {
                    await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // Backoff
                }
            }
        }

        return {
            success: false,
            title: '',
            content: '',
            contentType: '',
            sizeBytes: 0,
            wordCount: 0,
            error: `Failed after ${WebScraperService.MAX_RETRIES + 1} attempts: ${lastError}`
        };
    }

    // ─── INTERNAL ────────────────────────────────────────────────────────

    private isValidUrl(str: string): boolean {
        try {
            const parsed = new URL(str);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
            return false;
        }
    }

    private fetchUrl(targetUrl: string, redirectCount: number = 0): Promise<string> {
        if (redirectCount > 5) {
            return Promise.reject(new Error('Too many redirects'));
        }

        return new Promise((resolve, reject) => {
            const parsed = new URL(targetUrl);
            const client = parsed.protocol === 'https:' ? https : http;

            const req = client.get(targetUrl, {
                timeout: WebScraperService.REQUEST_TIMEOUT,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; AI-Companion/1.0; +https://github.com/ai-companion)',
                    'Accept': 'text/html,application/xhtml+xml,text/plain,*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'identity' // No compression for simplicity
                }
            }, (res) => {
                // Handle redirects
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const redirectUrl = new URL(res.headers.location, targetUrl).toString();
                    resolve(this.fetchUrl(redirectUrl, redirectCount + 1));
                    return;
                }

                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    return;
                }

                let data = '';
                let totalSize = 0;

                res.on('data', (chunk: Buffer) => {
                    totalSize += chunk.length;
                    if (totalSize > WebScraperService.MAX_CONTENT_SIZE) {
                        req.destroy();
                        reject(new Error('Content exceeds maximum size limit'));
                        return;
                    }
                    data += chunk.toString('utf8');
                });

                res.on('end', () => resolve(data));
                res.on('error', reject);
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timed out'));
            });
        });
    }

    /**
     * Extract the <title> from HTML.
     */
    private extractTitle(html: string): string {
        const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        return match ? this.decodeHtmlEntities(match[1].trim()) : '';
    }

    /**
     * Extract meaningful text content from HTML.
     * Removes scripts, styles, nav, footer, and other non-content elements.
     */
    private extractTextContent(html: string): string {
        let text = html;

        // Remove scripts, styles, and other non-content tags
        text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
        text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
        text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
        text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
        text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
        text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
        text = text.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
        text = text.replace(/<svg[\s\S]*?<\/svg>/gi, '');

        // Try to extract main content areas first
        const mainContent = text.match(/<(?:main|article|section)[^>]*>([\s\S]*?)<\/(?:main|article|section)>/gi);
        if (mainContent && mainContent.length > 0) {
            text = mainContent.join('\n');
        }

        // Convert block elements to line breaks
        text = text.replace(/<(?:p|div|br|li|h[1-6]|tr|td|th|blockquote|pre)[^>]*>/gi, '\n');
        text = text.replace(/<\/(?:p|div|li|h[1-6]|tr|blockquote|pre)>/gi, '\n');

        // Remove all remaining HTML tags
        text = text.replace(/<[^>]+>/g, '');

        // Decode HTML entities
        text = this.decodeHtmlEntities(text);

        // Clean up whitespace
        text = text.replace(/[ \t]+/g, ' ');          // Multiple spaces → single
        text = text.replace(/\n\s*\n\s*\n/g, '\n\n'); // Multiple blank lines → double
        text = text.trim();

        return text;
    }

    /**
     * Decode common HTML entities.
     */
    private decodeHtmlEntities(str: string): string {
        return str
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
            .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
}

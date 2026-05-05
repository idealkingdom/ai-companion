/**
 * Agent Hub — Unit Tests
 * Tests for SourceIndexService, WebScraperService, DocumentParserService, SmartGenerateService
 */
import * as assert from 'assert';
import { SourceIndexService, IndexedSource, SourceIndexData } from '../services/source-index';
import { WebScraperService } from '../services/web-scraper';
import { DocumentParserService } from '../services/document-parser';

// ─── MOCK globalState ────────────────────────────────────────────────────

class MockGlobalState {
    private store: Map<string, any> = new Map();
    get<T>(key: string): T | undefined { return this.store.get(key); }
    async update(key: string, value: any) { this.store.set(key, value); }
    keys() { return [...this.store.keys()]; }
    setKeysForSync() {}
}

function createMockContext(): any {
    return {
        globalState: new MockGlobalState(),
        extensionUri: { fsPath: '/mock' },
        extensionPath: '/mock',
        globalStorageUri: { fsPath: '/mock/storage' },
        subscriptions: []
    };
}

// ─── SOURCE INDEX TESTS ──────────────────────────────────────────────────

suite('SourceIndexService', () => {
    let service: SourceIndexService;
    let ctx: any;

    setup(() => {
        ctx = createMockContext();
        service = new SourceIndexService(ctx);
    });

    test('getSources returns empty array initially', () => {
        assert.deepStrictEqual(service.getSources(), []);
    });

    test('addSource creates a source with id', async () => {
        const source = await service.addSource({
            type: 'url',
            origin: 'https://example.com',
            title: 'Example',
            content: 'Hello World',
            chunks: ['Hello World'],
            metadata: {
                dateIndexed: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                contentType: 'text/html',
                sizeBytes: 11,
                wordCount: 2
            },
            status: 'indexed'
        });

        assert.ok(source.id);
        assert.strictEqual(source.title, 'Example');
        assert.strictEqual(service.getSources().length, 1);
    });

    test('deleteSource removes source', async () => {
        const source = await service.addSource({
            type: 'url', origin: 'https://test.com', title: 'Test',
            content: 'test', chunks: ['test'],
            metadata: { dateIndexed: '', lastUpdated: '', contentType: '', sizeBytes: 4, wordCount: 1 },
            status: 'indexed'
        });

        const result = await service.deleteSource(source.id);
        assert.strictEqual(result, true);
        assert.strictEqual(service.getSources().length, 0);
    });

    test('deleteSource returns false for unknown id', async () => {
        const result = await service.deleteSource('nonexistent');
        assert.strictEqual(result, false);
    });

    test('updateSource modifies existing source', async () => {
        const source = await service.addSource({
            type: 'url', origin: 'https://test.com', title: 'Old Title',
            content: '', chunks: [],
            metadata: { dateIndexed: '', lastUpdated: '', contentType: '', sizeBytes: 0, wordCount: 0 },
            status: 'pending'
        });

        const updated = await service.updateSource(source.id, { title: 'New Title', status: 'indexed' });
        assert.ok(updated);
        assert.strictEqual(updated!.title, 'New Title');
        assert.strictEqual(updated!.status, 'indexed');
    });

    test('search finds matching content', async () => {
        await service.addSource({
            type: 'url', origin: 'https://test.com', title: 'TypeScript Guide',
            content: 'TypeScript is a typed superset of JavaScript',
            chunks: ['TypeScript is a typed superset of JavaScript'],
            metadata: { dateIndexed: '', lastUpdated: '', contentType: '', sizeBytes: 100, wordCount: 7 },
            status: 'indexed'
        });

        const results = service.search('TypeScript');
        assert.ok(results.length > 0);
        assert.strictEqual(results[0].source.title, 'TypeScript Guide');
    });

    test('search returns empty for no matches', async () => {
        await service.addSource({
            type: 'url', origin: 'https://test.com', title: 'Python Guide',
            content: 'Python is a language', chunks: ['Python is a language'],
            metadata: { dateIndexed: '', lastUpdated: '', contentType: '', sizeBytes: 20, wordCount: 4 },
            status: 'indexed'
        });

        const results = service.search('Rust');
        assert.strictEqual(results.length, 0);
    });

    test('chunkContent splits into segments', () => {
        const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
        const chunks = SourceIndexService.chunkContent(text, 20);
        assert.ok(chunks.length >= 2);
    });

    test('clearAll removes all sources', async () => {
        await service.addSource({
            type: 'url', origin: 'a', title: 'A', content: '', chunks: [],
            metadata: { dateIndexed: '', lastUpdated: '', contentType: '', sizeBytes: 0, wordCount: 0 },
            status: 'indexed'
        });
        await service.addSource({
            type: 'pdf', origin: 'b', title: 'B', content: '', chunks: [],
            metadata: { dateIndexed: '', lastUpdated: '', contentType: '', sizeBytes: 0, wordCount: 0 },
            status: 'indexed'
        });

        assert.strictEqual(service.getSources().length, 2);
        await service.clearAll();
        assert.strictEqual(service.getSources().length, 0);
    });

    test('getIndexedContext combines all sources', async () => {
        await service.addSource({
            type: 'url', origin: 'a', title: 'Source A', content: 'Content A', chunks: [],
            metadata: { dateIndexed: '', lastUpdated: '', contentType: '', sizeBytes: 0, wordCount: 0 },
            status: 'indexed'
        });

        const context = service.getIndexedContext();
        assert.ok(context.includes('Source A'));
        assert.ok(context.includes('Content A'));
    });
});

// ─── WEB SCRAPER TESTS ──────────────────────────────────────────────────

suite('WebScraperService', () => {
    const scraper = new WebScraperService();

    test('rejects invalid URLs', async () => {
        const result = await scraper.scrape('not-a-url');
        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('Invalid'));
    });

    test('rejects non-http protocols', async () => {
        const result = await scraper.scrape('ftp://example.com');
        assert.strictEqual(result.success, false);
    });
});

// ─── DOCUMENT PARSER TESTS ──────────────────────────────────────────────

suite('DocumentParserService', () => {
    test('isSupported returns true for PDF', () => {
        assert.strictEqual(DocumentParserService.isSupported('doc.pdf'), true);
    });

    test('isSupported returns true for CSV', () => {
        assert.strictEqual(DocumentParserService.isSupported('data.csv'), true);
    });

    test('isSupported returns false for unsupported types', () => {
        assert.strictEqual(DocumentParserService.isSupported('file.exe'), false);
    });

    test('getSupportedExtensions returns array', () => {
        const exts = DocumentParserService.getSupportedExtensions();
        assert.ok(Array.isArray(exts));
        assert.ok(exts.includes('.pdf'));
        assert.ok(exts.includes('.csv'));
        assert.ok(exts.includes('.txt'));
    });

    test('parse returns error for nonexistent file', async () => {
        const parser = new DocumentParserService();
        const result = await parser.parse('/nonexistent/file.txt');
        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('not found'));
    });

    test('parse rejects unsupported extension', async () => {
        const parser = new DocumentParserService();
        const result = await parser.parse('/some/file.exe');
        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('Unsupported'));
    });
});

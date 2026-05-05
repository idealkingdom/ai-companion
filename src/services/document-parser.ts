/**
 * Document Parser Service
 * Handles extraction of text from PDF, CSV, plain text files.
 */
import * as fs from 'fs';
import * as path from 'path';
import { outputChannel } from '../logger';

export interface ParseResult {
    success: boolean;
    title: string;
    content: string;
    contentType: string;
    sizeBytes: number;
    wordCount: number;
    error?: string;
}

export class DocumentParserService {
    private static readonly MAX_FILE_SIZE = 50 * 1024 * 1024;
    private static readonly SUPPORTED = ['.pdf', '.csv', '.txt', '.md', '.json', '.xml'];

    public async parse(filePath: string): Promise<ParseResult> {
        const ext = path.extname(filePath).toLowerCase();
        const fileName = path.basename(filePath);
        outputChannel.appendLine(`[DocParser] Parsing: ${fileName}`);

        if (!DocumentParserService.SUPPORTED.includes(ext)) {
            return { success: false, title: fileName, content: '', contentType: ext, sizeBytes: 0, wordCount: 0, error: `Unsupported: ${ext}` };
        }

        try {
            const stat = fs.statSync(filePath);
            if (stat.size > DocumentParserService.MAX_FILE_SIZE) {
                return { success: false, title: fileName, content: '', contentType: ext, sizeBytes: stat.size, wordCount: 0, error: 'File too large' };
            }
        } catch {
            return { success: false, title: fileName, content: '', contentType: ext, sizeBytes: 0, wordCount: 0, error: 'File not found' };
        }

        try {
            let content = '';
            if (ext === '.pdf') {
                // Import the core lib directly to bypass pdf-parse's index.js
                // which has a debug auto-test that tries to read a nonexistent
                // test file, causing "first call fails, second succeeds" bug.
                const pdfParse = require('pdf-parse/lib/pdf-parse.js');
                const buf = fs.readFileSync(filePath);
                const data = await pdfParse(buf);
                content = data.text || '';
            } else if (ext === '.csv') {
                const raw = fs.readFileSync(filePath, 'utf8');
                const lines = raw.split('\n');
                const headers = lines[0]?.split(',').map(h => h.trim().replace(/"/g, '')) || [];
                content = 'Columns: ' + headers.join(' | ') + '\n';
                for (let i = 1; i < Math.min(lines.length, 1000); i++) {
                    content += lines[i] + '\n';
                }
            } else {
                content = fs.readFileSync(filePath, 'utf8');
            }

            const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
            return { success: true, title: fileName, content, contentType: ext, sizeBytes: Buffer.byteLength(content), wordCount };
        } catch (err: any) {
            return { success: false, title: fileName, content: '', contentType: ext, sizeBytes: 0, wordCount: 0, error: err.message };
        }
    }

    public static isSupported(filePath: string): boolean {
        return DocumentParserService.SUPPORTED.includes(path.extname(filePath).toLowerCase());
    }

    public static getSupportedExtensions(): string[] {
        return [...DocumentParserService.SUPPORTED];
    }
}

import { tool as _tool, jsonSchema } from 'ai';
const tool = _tool as any;
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WorkspaceIndexService } from '../services/workspace-index';
import { ReviewManager } from '../chat/review-manager';

/**
 * Creates the file & AST tools for the agentic loop.
 * NOTE: AI SDK v6 uses 'inputSchema' (not 'parameters') for tool schemas.
 */
export function createFileTools(workspaceIndex: WorkspaceIndexService) {

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    function resolvePath(filePath: string): string {
        if (path.isAbsolute(filePath)) { return filePath; }
        return path.join(workspaceRoot, filePath);
    }

    const list_workspace = tool({
        description: 'List all files in the workspace as a directory tree. Use this first to understand the project structure.',
        inputSchema: (jsonSchema as any)({
            type: 'object',
            properties: {
                directory: {
                    type: 'string',
                    description: 'Optional subdirectory to list (defaults to workspace root)'
                }
            },
            additionalProperties: false
        }),
        execute: async (params: { directory?: string }) => {
            await workspaceIndex.refresh();
            const tree = workspaceIndex.getFileTreeString();
            return { tree, fileCount: workspaceIndex.getFileList().length };
        }
    });

    // ─── TOOL: read_file_skeleton ───────────────────────────────────────
    const read_file_skeleton = tool({
        description: 'Read only the structure of a file: imports, class names, function signatures. Returns a compact skeleton (NOT the full file). Use this to understand a file before reading specific lines.',
        inputSchema: z.object({
            filePath: z.string().describe('Path to the file (absolute or relative to workspace root)')
        }),
        execute: async (params: { filePath: string }) => {
            const absPath = resolvePath(params.filePath);
            if (!fs.existsSync(absPath)) {
                return { error: `File not found: ${absPath}` };
            }

            // Check cache first (saves tokens on repeated reads)
            const cached = workspaceIndex.getCachedSkeleton(absPath);
            if (cached) {
                return {
                    file: params.filePath,
                    totalLines: cached.totalLines,
                    skeleton: cached.skeleton || '(No structural elements found)',
                    _cached: true
                };
            }

            const content = fs.readFileSync(absPath, 'utf-8');
            const lines = content.split('\n');
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

            const skeletonStr = skeleton.join('\n') || '(No structural elements found)';

            // Cache it for future calls
            workspaceIndex.cacheSkeleton(absPath, skeletonStr, lines.length);

            return {
                file: params.filePath,
                totalLines: lines.length,
                skeleton: skeletonStr,
            };
        }
    } as any);

    // ─── TOOL: read_line_range ──────────────────────────────────────────
    const read_line_range = tool({
        description: 'Read specific lines from a file. Use after read_file_skeleton to examine specific sections. Maximum 200 lines per call.',
        inputSchema: z.object({
            filePath: z.string().describe('Path to the file'),
            startLine: z.number().describe('Start line number (1-indexed)'),
            endLine: z.number().describe('End line number (1-indexed, inclusive)')
        }),
        execute: async (params: { filePath: string; startLine: number; endLine: number }) => {
            const absPath = resolvePath(params.filePath);
            if (!fs.existsSync(absPath)) {
                return { error: `File not found: ${absPath}` };
            }

            const clampedEnd = Math.min(params.endLine, params.startLine + 199);
            const content = fs.readFileSync(absPath, 'utf-8');
            const lines = content.split('\n');
            const totalLines = lines.length;

            const slice = lines.slice(params.startLine - 1, clampedEnd);
            const numbered = slice.map((l: string, i: number) => `L${params.startLine + i}: ${l}`).join('\n');

            return {
                file: params.filePath,
                range: `${params.startLine}-${clampedEnd}`,
                totalLines,
                content: numbered,
                _note: 'The L-prefix line numbers are for your reference only. Do NOT include them in your targetContent when using chunk_replace.'
            };
        }
    } as any);

    // ─── TOOL: chunk_replace ────────────────────────────────────────────
    const chunk_replace = tool({
        description: 'Replace a specific block of text in a file. Provide the exact target text to find and the replacement text. This is a surgical edit — only the matched text is replaced. Changes are written directly to the file.',
        inputSchema: z.object({
            filePath: z.string().describe('Path to the file'),
            targetContent: z.string().describe('The exact text to find and replace (must match exactly). Strip any L-prefix line numbers like "L12: " which are only for your reference.'),
            replacementContent: z.string().describe('The new text to replace it with')
        }),
        execute: async (params: { filePath: string; targetContent: string; replacementContent: string }) => {
            const absPath = resolvePath(params.filePath);
            const fileUri = vscode.Uri.file(absPath);
            
            // Clean L-prefix line numbers
            const cleanTarget = params.targetContent.replace(/^L\d+:\s/gm, '');
            const cleanReplacement = params.replacementContent.replace(/^L\d+:\s/gm, '');

            // #43: Direct-write — apply to file immediately
            const reviewManager = ReviewManager.getInstance();
            const result = await reviewManager.applyDirectEdit(
                fileUri,
                cleanTarget,
                cleanReplacement,
                'chunk_replace'
            );

            if (!result.success) {
                return { error: result.error || 'Failed to apply edit.' };
            }

            return {
                success: true,
                message: 'Changes applied directly to file. User can review via inline highlights.',
                file: params.filePath,
                linesReplaced: cleanTarget.split('\n').length
            };
        }
    } as any);

    // ─── TOOL: create_file ──────────────────────────────────────────────
    const create_file = tool({
        description: 'Create a new file with the given content. Parent directories will be created automatically. The file is created immediately.',
        inputSchema: z.object({
            filePath: z.string().describe('Path for the new file'),
            content: z.string().describe('Content to write')
        }),
        execute: async (params: { filePath: string; content: string }) => {
            const absPath = resolvePath(params.filePath);
            const fileUri = vscode.Uri.file(absPath);

            const cleanContent = params.content.replace(/^L\d+:\s/gm, '');

            // Ensure parent directory exists
            const dir = require('path').dirname(absPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // #43: Direct-write — create file immediately
            const reviewManager = ReviewManager.getInstance();
            const result = await reviewManager.applyDirectCreate(
                fileUri,
                cleanContent,
                'create_file'
            );

            if (!result.success) {
                return { error: result.error || 'Failed to create file.' };
            }

            return { 
                success: true, 
                message: 'File created successfully.',
                file: params.filePath, 
                lines: cleanContent.split('\n').length 
            };
        }
    } as any);

    // ─── TOOL: find_symbol ──────────────────────────────────────────────
    const find_symbol = tool({
        description: 'Search for a function, class, or variable by name across the workspace. Returns file path and line numbers.',
        inputSchema: z.object({
            query: z.string().describe('Symbol name to search for')
        }),
        execute: async (params: { query: string }) => {
            const results = await workspaceIndex.findSymbol(params.query);
            if (results.length === 0) {
                return { results: [], message: `No symbols matching "${params.query}" found.` };
            }
            return {
                results: results.map(r => ({
                    name: r.name,
                    kind: r.kind,
                    file: vscode.workspace.asRelativePath(r.filePath),
                    line: r.range.startLine
                }))
            };
        }
    } as any);

    return {
        list_workspace,
        read_file_skeleton,
        read_line_range,
        chunk_replace,
        create_file,
        find_symbol
    };
}

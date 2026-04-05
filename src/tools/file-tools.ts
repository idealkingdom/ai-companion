import { tool as _tool, jsonSchema } from 'ai';
const tool = _tool as any;
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WorkspaceIndexService } from '../services/workspace-index';

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
                }
            }

            return {
                file: params.filePath,
                totalLines: lines.length,
                skeleton: skeleton.join('\n') || '(No structural elements found)',
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
                content: numbered
            };
        }
    } as any);

    // ─── TOOL: chunk_replace ────────────────────────────────────────────
    const chunk_replace = tool({
        description: 'Replace a specific block of text in a file. Provide the exact target text to find and the replacement text. This is a surgical edit — only the matched text is replaced.',
        inputSchema: z.object({
            filePath: z.string().describe('Path to the file'),
            targetContent: z.string().describe('The exact text to find and replace (must match exactly)'),
            replacementContent: z.string().describe('The new text to replace it with')
        }),
        execute: async (params: { filePath: string; targetContent: string; replacementContent: string }) => {
            const absPath = resolvePath(params.filePath);
            if (!fs.existsSync(absPath)) {
                return { error: `File not found: ${absPath}` };
            }

            const content = fs.readFileSync(absPath, 'utf-8');

            if (!content.includes(params.targetContent)) {
                return { error: 'Target content not found in file. Verify exact text match including whitespace.' };
            }

            const count = content.split(params.targetContent).length - 1;
            if (count > 1) {
                return { error: `Found ${count} occurrences. Provide more context to make target unique.` };
            }

            const updated = content.replace(params.targetContent, params.replacementContent);
            fs.writeFileSync(absPath, updated, 'utf-8');

            return {
                success: true,
                file: params.filePath,
                linesReplaced: params.targetContent.split('\n').length,
                linesInserted: params.replacementContent.split('\n').length
            };
        }
    } as any);

    // ─── TOOL: create_file ──────────────────────────────────────────────
    const create_file = tool({
        description: 'Create a new file with the given content. Parent directories will be created automatically.',
        inputSchema: z.object({
            filePath: z.string().describe('Path for the new file'),
            content: z.string().describe('Content to write')
        }),
        execute: async (params: { filePath: string; content: string }) => {
            const absPath = resolvePath(params.filePath);
            const dir = path.dirname(absPath);

            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(absPath, params.content, 'utf-8');
            return { success: true, file: params.filePath, lines: params.content.split('\n').length };
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

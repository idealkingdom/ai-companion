import { tool as _tool } from 'ai';
const tool = _tool as any;
import { z } from 'zod';
import * as cp from 'child_process';
import * as vscode from 'vscode';

/**
 * Creates the system/terminal tools for the agentic loop.
 * NOTE: AI SDK v6 uses 'inputSchema' (not 'parameters') for tool schemas.
 */
export function createSysTools() {

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    // ─── TOOL: run_command ──────────────────────────────────────────────
    const run_command = tool({
        description: 'Execute a shell command in the workspace directory. Output is capped at 3000 characters. Use for: running tests, installing packages, checking git status, building projects.',
        inputSchema: z.object({
            command: z.string().describe('The shell command to execute'),
            cwd: z.string().optional().describe('Working directory (defaults to workspace root)')
        }),
        execute: async (params: { command: string; cwd?: string }) => {
            const execCwd = params.cwd || workspaceRoot;

            return new Promise<{ exitCode: number; output: string }>((resolve) => {
                cp.exec(params.command, {
                    cwd: execCwd,
                    timeout: 30000,
                    maxBuffer: 1024 * 1024,
                    env: { ...process.env, PAGER: 'cat' }
                }, (error, stdout, stderr) => {
                    let output = stdout || '';
                    if (stderr) { output += '\nSTDERR:\n' + stderr; }

                    if (output.length > 3000) {
                        output = output.substring(0, 3000) + '\n... [output truncated at 3000 chars]';
                    }

                    if (error && !stdout && !stderr) {
                        resolve({
                            exitCode: error.code || 1,
                            output: error.message.substring(0, 1000)
                        });
                    } else {
                        resolve({
                            exitCode: error ? (error.code || 1) : 0,
                            output: output || '(no output)'
                        });
                    }
                });
            });
        }
    } as any);

    // ─── TOOL: search_workspace ─────────────────────────────────────────
    const search_workspace = tool({
        description: 'Search for text patterns across the workspace. Returns matching file paths and line contents. Max 30 results.',
        inputSchema: z.object({
            query: z.string().describe('Text pattern to search for'),
            fileGlob: z.string().optional().describe('Optional glob filter, e.g. "*.ts"'),
            caseSensitive: z.boolean().optional().describe('Default false')
        }),
        execute: async (params: { query: string; fileGlob?: string; caseSensitive?: boolean }) => {
            const grepArgs = params.caseSensitive ? '' : '-i';
            const globArg = params.fileGlob ? `--include="${params.fileGlob}"` : '';

            return new Promise<{ results: any[] }>((resolve) => {
                cp.exec(
                    `grep -rn ${grepArgs} ${globArg} "${params.query}" "${workspaceRoot}" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git | head -30`,
                    { timeout: 15000, maxBuffer: 1024 * 512 },
                    (error, stdout) => {
                        if (!stdout) {
                            resolve({ results: [] });
                            return;
                        }
                        const results = stdout.trim().split('\n').slice(0, 30).map((line: string) => {
                            const match = line.match(/^(.+?):(\d+):(.*)$/);
                            if (match) {
                                return {
                                    file: vscode.workspace.asRelativePath(match[1]),
                                    line: parseInt(match[2]),
                                    content: match[3].trim().substring(0, 200)
                                };
                            }
                            return { file: '', line: 0, content: line.substring(0, 200) };
                        });
                        resolve({ results });
                    }
                );
            });
        }
    } as any);

    return {
        run_command,
        search_workspace
    };
}

import { tool as _tool } from 'ai';
const tool = _tool as any;
import { z } from 'zod';
import * as cp from 'child_process';
import * as vscode from 'vscode';
import { outputChannel } from '../logger';

// ─── Persistent AI Terminal ─────────────────────────────────────────
// We reuse a single VS Code terminal for all AI commands so users
// can follow along in the Terminal panel without spawning new tabs.
let aiTerminal: vscode.Terminal | undefined;
let aiTerminalWriteEmitter: vscode.EventEmitter<string> | undefined;

function getOrCreateAITerminal(): { terminal: vscode.Terminal; writeEmitter: vscode.EventEmitter<string> } {
    // If the terminal was closed by the user, recreate it
    if (aiTerminal && aiTerminal.exitStatus !== undefined) {
        aiTerminal = undefined;
        aiTerminalWriteEmitter = undefined;
    }

    if (!aiTerminal || !aiTerminalWriteEmitter) {
        aiTerminalWriteEmitter = new vscode.EventEmitter<string>();
        const pty: vscode.Pseudoterminal = {
            onDidWrite: aiTerminalWriteEmitter.event,
            open: () => {
                aiTerminalWriteEmitter!.fire('\x1b[36m╔══════════════════════════════════════════════╗\x1b[0m\r\n');
                aiTerminalWriteEmitter!.fire('\x1b[36m║       🤖 AI Companion — Terminal Output      ║\x1b[0m\r\n');
                aiTerminalWriteEmitter!.fire('\x1b[36m╚══════════════════════════════════════════════╝\x1b[0m\r\n\r\n');
            },
            close: () => {
                aiTerminal = undefined;
                aiTerminalWriteEmitter = undefined;
            },
            handleInput: () => { /* read-only terminal */ }
        };

        aiTerminal = vscode.window.createTerminal({
            name: '🤖 AI Companion',
            pty
        });
    }

    return { terminal: aiTerminal, writeEmitter: aiTerminalWriteEmitter };
}

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

            // Show command in the AI Terminal
            const { terminal, writeEmitter } = getOrCreateAITerminal();
            terminal.show(true); // Show terminal, preserve focus

            writeEmitter.fire(`\x1b[90m────────────────────────────────────────────────\x1b[0m\r\n`);
            writeEmitter.fire(`\x1b[33m$ ${params.command}\x1b[0m\r\n`);
            writeEmitter.fire(`\x1b[90m  cwd: ${execCwd}\x1b[0m\r\n\r\n`);

            // Also log to output channel for persistence
            outputChannel.appendLine(`[run_command] $ ${params.command} (cwd: ${execCwd})`);

            return new Promise<{ exitCode: number; output: string }>((resolve) => {
                cp.exec(params.command, {
                    cwd: execCwd,
                    timeout: 30000,
                    maxBuffer: 1024 * 1024,
                    env: { ...process.env, PAGER: 'cat' }
                }, (error, stdout, stderr) => {
                    let output = stdout || '';
                    if (stderr) { output += '\nSTDERR:\n' + stderr; }

                    // Write output to the AI Terminal (convert \n to \r\n for terminal)
                    const termOutput = output.substring(0, 3000).replace(/\n/g, '\r\n');
                    if (termOutput) {
                        writeEmitter.fire(termOutput + '\r\n');
                    }

                    const exitCode = error ? (error.code || 1) : 0;
                    const exitColor = exitCode === 0 ? '\x1b[32m' : '\x1b[31m';
                    writeEmitter.fire(`${exitColor}── exit code: ${exitCode} ──\x1b[0m\r\n\r\n`);

                    // Also log to output channel
                    outputChannel.appendLine(`[run_command] exit code: ${exitCode}`);

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
                            exitCode,
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
            return new Promise<{ results: any[] }>((resolve) => {
                const args = ['-rn'];
                if (!params.caseSensitive) {
                    args.push('-i');
                }
                if (params.fileGlob) {
                    args.push(`--include=${params.fileGlob}`);
                }
                args.push('--exclude-dir=node_modules');
                args.push('--exclude-dir=dist');
                args.push('--exclude-dir=.git');
                args.push(params.query);
                args.push(workspaceRoot);

                cp.execFile('grep', args, { timeout: 15000, maxBuffer: 1024 * 1024 * 5 }, (error, stdout) => {
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
                });
            });
        }
    } as any);

    // ─── TOOL: get_workspace_problems ───────────────────────────────────
    const get_workspace_problems = tool({
        description: 'Get all current workspace problems (errors, warnings, hints) from the IDE diagnostics. Use this to verify if your code changes introduced any new errors.',
        inputSchema: z.object({}),
        execute: async () => {
            const diagnostics = vscode.languages.getDiagnostics();
            let problemsText = "";
            
            diagnostics.forEach(([uri, fileDiagnostics]) => {
                if (fileDiagnostics.length === 0) return;
                problemsText += `File: ${vscode.workspace.asRelativePath(uri)}\n`;
                fileDiagnostics.forEach(p => {
                    problemsText += `  - [${vscode.DiagnosticSeverity[p.severity]}] Line ${p.range.start.line + 1}: ${p.message}\n`;
                });
                problemsText += "\n";
            });

            if (!problemsText) {
                problemsText = "No problems found in the workspace.";
            }

            return { problems: problemsText };
        }
    } as any);

    return {
        run_command,
        search_workspace,
        get_workspace_problems
    };
}

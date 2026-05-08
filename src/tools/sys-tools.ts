import { tool as _tool } from 'ai';
const tool = _tool as any;
import { z } from 'zod';
import * as cp from 'child_process';
import * as vscode from 'vscode';
import { outputChannel } from '../logger';

// ─── Persistent AI Terminal ─────────────────────────────────────────
// Interactive terminal: users can type, Ctrl+C to stop servers, etc.
// AI commands execute via spawn() and pipe output here.
let aiTerminal: vscode.Terminal | undefined;
let aiTerminalWriteEmitter: vscode.EventEmitter<string> | undefined;
let activeChildProcess: cp.ChildProcess | undefined;

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
                aiTerminalWriteEmitter!.fire('\x1b[36m║       🤖 AI Companion — Terminal             ║\x1b[0m\r\n');
                aiTerminalWriteEmitter!.fire('\x1b[36m╚══════════════════════════════════════════════╝\x1b[0m\r\n');
                aiTerminalWriteEmitter!.fire('\x1b[90mInteractive: type here or Ctrl+C to stop processes\x1b[0m\r\n\r\n');
            },
            close: () => {
                // Kill any active process when terminal is closed
                if (activeChildProcess && !activeChildProcess.killed) {
                    activeChildProcess.kill('SIGTERM');
                    activeChildProcess = undefined;
                }
                aiTerminal = undefined;
                aiTerminalWriteEmitter = undefined;
            },
            handleInput: (data: string) => {
                // Forward user input to the active child process
                if (activeChildProcess && !activeChildProcess.killed && activeChildProcess.stdin) {
                    // Ctrl+C → kill the process
                    if (data === '\x03') {
                        activeChildProcess.kill('SIGINT');
                        aiTerminalWriteEmitter?.fire('\r\n\x1b[33m^C\x1b[0m\r\n');
                        return;
                    }
                    // Forward the input to the child process
                    activeChildProcess.stdin.write(data);
                    // Echo the input to the terminal
                    if (data === '\r') {
                        aiTerminalWriteEmitter?.fire('\r\n');
                    } else if (data === '\x7f') {
                        // Backspace
                        aiTerminalWriteEmitter?.fire('\b \b');
                    } else {
                        aiTerminalWriteEmitter?.fire(data);
                    }
                } else {
                    // No active process — show hint
                    if (data === '\r') {
                        aiTerminalWriteEmitter?.fire('\r\n\x1b[90mNo active process. Commands are run by the AI agent.\x1b[0m\r\n');
                    }
                }
            }
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
                const child = cp.spawn('sh', ['-c', params.command], {
                    cwd: execCwd,
                    env: { ...process.env, PAGER: 'cat' },
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                // Store as active process so user can interact (Ctrl+C, stdin)
                activeChildProcess = child;

                let stdout = '';
                let stderr = '';
                let killed = false;

                // Set a timeout to prevent hanging
                const timeout = setTimeout(() => {
                    if (!child.killed) {
                        killed = true;
                        child.kill('SIGTERM');
                        writeEmitter.fire('\r\n\x1b[33m── timed out after 30s ──\x1b[0m\r\n\r\n');
                    }
                }, 30000);

                child.stdout?.on('data', (data: Buffer) => {
                    const text = data.toString();
                    stdout += text;
                    // Stream to terminal in real-time
                    const termText = text.replace(/\n/g, '\r\n');
                    writeEmitter.fire(termText);
                });

                child.stderr?.on('data', (data: Buffer) => {
                    const text = data.toString();
                    stderr += text;
                    // Stream stderr in red
                    const termText = text.replace(/\n/g, '\r\n');
                    writeEmitter.fire(`\x1b[31m${termText}\x1b[0m`);
                });

                child.on('close', (code) => {
                    clearTimeout(timeout);
                    if (activeChildProcess === child) {
                        activeChildProcess = undefined;
                    }

                    const exitCode = code ?? (killed ? 124 : 1);
                    const exitColor = exitCode === 0 ? '\x1b[32m' : '\x1b[31m';
                    writeEmitter.fire(`${exitColor}── exit code: ${exitCode} ──\x1b[0m\r\n\r\n`);

                    outputChannel.appendLine(`[run_command] exit code: ${exitCode}`);

                    let output = stdout || '';
                    if (stderr) { output += '\nSTDERR:\n' + stderr; }

                    if (output.length > 3000) {
                        output = output.substring(0, 3000) + '\n... [output truncated at 3000 chars]';
                    }

                    resolve({
                        exitCode,
                        output: output || '(no output)'
                    });
                });

                child.on('error', (err) => {
                    clearTimeout(timeout);
                    if (activeChildProcess === child) {
                        activeChildProcess = undefined;
                    }
                    writeEmitter.fire(`\x1b[31m── error: ${err.message} ──\x1b[0m\r\n\r\n`);
                    resolve({
                        exitCode: 1,
                        output: err.message.substring(0, 1000)
                    });
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

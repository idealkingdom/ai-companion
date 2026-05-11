import { tool as _tool } from 'ai';
const tool = _tool as any;
import { z } from 'zod';
import * as cp from 'child_process';
import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { outputChannel } from '../logger';

// ─── Persistent AI Terminal ─────────────────────────────────────────
// Uses a REAL shell terminal (not pseudoterminal) for full interactivity.
// Users can type, Ctrl+C, run their own commands — it's a real shell.
// AI commands execute via sendText() and capture output via temp files.
let aiTerminal: vscode.Terminal | undefined;

function getOrCreateAITerminal(cwd: string): vscode.Terminal {
    // If the terminal was closed by the user, recreate it
    if (aiTerminal && aiTerminal.exitStatus !== undefined) {
        aiTerminal = undefined;
    }

    if (!aiTerminal) {
        aiTerminal = vscode.window.createTerminal({
            name: 'kdAina',
            cwd
        });
    }

    return aiTerminal;
}

/**
 * Wait for a file to appear on disk (polling).
 */
function waitForFile(filePath: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
        const start = Date.now();
        const interval = setInterval(() => {
            if (fs.existsSync(filePath)) {
                clearInterval(interval);
                resolve(true);
            } else if (Date.now() - start > timeoutMs) {
                clearInterval(interval);
                resolve(false);
            }
        }, 250);
    });
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

            // Show terminal
            const terminal = getOrCreateAITerminal(execCwd);
            terminal.show(true); // Show terminal, preserve focus

            outputChannel.appendLine(`[run_command] $ ${params.command} (cwd: ${execCwd})`);

            // Use temp files for output capture
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const outFile = path.join(os.tmpdir(), `ai-out-${id}.txt`);
            const exitFile = path.join(os.tmpdir(), `ai-exit-${id}.txt`);

            // Build the wrapped command:
            // 1. cd to the correct directory
            // 2. Run the actual command, tee output to file
            // 3. Write exit code to a separate file
            // The user sees the command + output in the real terminal
            const cdCmd = `cd ${JSON.stringify(execCwd)}`;
            const runCmd = `${params.command} 2>&1 | tee ${JSON.stringify(outFile)}; echo $? > ${JSON.stringify(exitFile)}`;
            terminal.sendText(`${cdCmd} && ${runCmd}`, true);

            // Wait for exit file to appear (command completed)
            const completed = await waitForFile(exitFile, 30000);

            let output = '(no output)';
            let exitCode = 1;

            if (completed) {
                // Small delay to ensure file is fully written
                await new Promise(r => setTimeout(r, 100));

                try {
                    output = fs.readFileSync(outFile, 'utf-8') || '(no output)';
                    const exitStr = fs.readFileSync(exitFile, 'utf-8').trim();
                    exitCode = parseInt(exitStr, 10) || 0;
                } catch (e) {
                    output = `(failed to read output: ${e})`;
                }
            } else {
                output = '(command timed out after 30s — it may still be running in the terminal. Use Ctrl+C to stop it.)';
                exitCode = 124;
            }

            // Cleanup temp files
            try { fs.unlinkSync(outFile); } catch {}
            try { fs.unlinkSync(exitFile); } catch {}

            outputChannel.appendLine(`[run_command] exit code: ${exitCode}`);

            if (output.length > 3000) {
                output = output.substring(0, 3000) + '\n... [output truncated at 3000 chars]';
            }

            return { exitCode, output };
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

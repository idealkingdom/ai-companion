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

// ─── TEST → FIX CYCLE TRACKER ──────────────────────────────────────────
// Tracks test/build commands that fail, enforcing a structured retry loop.
// Key = normalized command string, Value = { count, command }
const testRetryTracker = new Map<string, { count: number; command: string }>();
const MAX_TEST_RETRIES = 3;

/** Clear the test retry tracker (call at start of each agentic request). */
export function clearTestRetryTracker() {
    testRetryTracker.clear();
}

/**
 * Detect if a command is a test or build command that should enter
 * the structured fix cycle when it fails.
 */
function isTestOrBuildCommand(command: string): boolean {
    const cmd = command.toLowerCase().trim();
    const patterns = [
        // Test runners
        /\b(npm|npx|yarn|pnpm)\s+(run\s+)?test/,
        /\bjest\b/, /\bvitest\b/, /\bmocha\b/, /\bava\b/, /\btap\b/,
        /\bpytest\b/, /\bpython\s+-m\s+(unittest|pytest)/,
        /\bcargo\s+test\b/, /\bgo\s+test\b/, /\bdotnet\s+test\b/,
        /\brspec\b/, /\bphpunit\b/, /\bgradle\s+test\b/, /\bmvn\s+test\b/,
        // Build commands
        /\b(npm|npx|yarn|pnpm)\s+(run\s+)?build/,
        /\btsc\b/, /\bcargo\s+build\b/, /\bgo\s+build\b/,
        /\bmake\b/, /\bcmake\b/, /\bdotnet\s+build\b/,
        /\bgcc\b/, /\bg\+\+\b/, /\brustc\b/,
        // Linting (also benefits from fix cycles)
        /\b(npm|npx|yarn|pnpm)\s+(run\s+)?lint/,
        /\beslint\b/, /\bruff\b/, /\bflake8\b/, /\bmypy\b/,
    ];
    return patterns.some(p => p.test(cmd));
}

/**
 * Normalize a command for tracker lookup (strip volatile parts).
 */
function normalizeCommand(command: string): string {
    return command.trim().replace(/\s+/g, ' ');
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

            // ─── TEST → FIX CYCLE ENFORCEMENT ──────────────────────────
            const isTestCmd = isTestOrBuildCommand(params.command);
            const cmdKey = normalizeCommand(params.command);

            if (isTestCmd && exitCode !== 0 && exitCode !== 124) {
                // Failed test/build command — track retries
                const tracker = testRetryTracker.get(cmdKey) || { count: 0, command: params.command };
                tracker.count++;
                testRetryTracker.set(cmdKey, tracker);

                outputChannel.appendLine(`[run_command] Test/build failure detected: "${cmdKey}" — attempt ${tracker.count}/${MAX_TEST_RETRIES}`);

                if (tracker.count >= MAX_TEST_RETRIES) {
                    // Max retries exhausted — stop the cycle
                    testRetryTracker.delete(cmdKey);
                    return {
                        exitCode,
                        output,
                        _testCycle: {
                            status: 'exhausted',
                            attempts: tracker.count,
                            maxRetries: MAX_TEST_RETRIES
                        },
                        _reflection: `STOP: Test/build command "${params.command}" has failed ${tracker.count} times. You have exhausted your retry budget.
Do NOT re-run this command. Instead:
1. Summarize what you tried and why each attempt failed.
2. Report the remaining errors to the user.
3. Ask the user for guidance on how to proceed.`
                    };
                }

                return {
                    exitCode,
                    output,
                    _testCycle: {
                        status: 'failed',
                        attempt: tracker.count,
                        maxRetries: MAX_TEST_RETRIES,
                        retriesRemaining: MAX_TEST_RETRIES - tracker.count
                    },
                    _reflection: `Test/build FAILED (attempt ${tracker.count}/${MAX_TEST_RETRIES}). Follow this cycle:
1. Analyze the error output above — identify the root cause (file, line, error type).
2. Read the relevant code with read_line_range.
3. Fix the issue with chunk_replace.
4. Re-run the EXACT same command: \`${params.command}\`
You have ${MAX_TEST_RETRIES - tracker.count} retries remaining. Do NOT skip the re-run step.`
                };
            }

            if (isTestCmd && exitCode === 0) {
                // Test passed — clear the tracker and celebrate
                const hadRetries = testRetryTracker.has(cmdKey);
                const previousAttempts = testRetryTracker.get(cmdKey)?.count || 0;
                testRetryTracker.delete(cmdKey);

                if (hadRetries) {
                    outputChannel.appendLine(`[run_command] Test/build PASSED after ${previousAttempts} failed attempts`);
                    return {
                        exitCode,
                        output,
                        _testCycle: {
                            status: 'passed',
                            attemptsBeforeSuccess: previousAttempts + 1
                        },
                        _note: `Test/build passed after ${previousAttempts} failed attempt(s). The fix worked. Continue with the next task.`
                    };
                }

                return { exitCode, output };
            }

            // Non-test commands: return output without a reflection prompt.
            // Reflection is only for test/build commands to prevent infinite
            // self-correction loops on arbitrary failing commands.
            return {
                exitCode,
                output
            };
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
        description: 'Get current workspace problems (errors, warnings) from the IDE. Optionally scope to a single file for detailed diagnostics after an edit. Without filePath, returns a capped summary of all workspace problems.',
        inputSchema: z.object({
            filePath: z.string().optional().describe('Optional: scope to a specific file path for detailed diagnostics. Without this, returns workspace-wide summary (capped at 50).')
        }),
        execute: async (params: { filePath?: string }) => {
            const MAX_PROBLEMS = 50;
            const diagnostics = vscode.languages.getDiagnostics();
            let problemsText = "";
            let totalCount = 0;
            let shownCount = 0;

            // If scoped to a single file, return ALL errors/warnings for that file
            if (params.filePath) {
                const absPath = params.filePath.startsWith('/')
                    ? params.filePath
                    : require('path').join(workspaceRoot, params.filePath);
                const targetUri = vscode.Uri.file(absPath);
                const fileDiags = vscode.languages.getDiagnostics(targetUri);
                const relevant = fileDiags.filter(d =>
                    d.severity === vscode.DiagnosticSeverity.Error ||
                    d.severity === vscode.DiagnosticSeverity.Warning
                );

                if (relevant.length === 0) {
                    return { problems: `No errors or warnings in ${params.filePath}.` };
                }

                problemsText = `File: ${params.filePath}\n`;
                relevant.forEach(p => {
                    problemsText += `  - [${vscode.DiagnosticSeverity[p.severity]}] Line ${p.range.start.line + 1}: ${p.message}\n`;
                });
                return { problems: problemsText, count: relevant.length };
            }

            // Workspace-wide: filter to Error/Warning, cap at MAX_PROBLEMS
            for (const [uri, fileDiagnostics] of diagnostics) {
                const relevant = fileDiagnostics.filter(d =>
                    d.severity === vscode.DiagnosticSeverity.Error ||
                    d.severity === vscode.DiagnosticSeverity.Warning
                );
                if (relevant.length === 0) { continue; }

                totalCount += relevant.length;

                if (shownCount >= MAX_PROBLEMS) { continue; } // keep counting total but stop printing

                problemsText += `File: ${vscode.workspace.asRelativePath(uri)}\n`;
                for (const p of relevant) {
                    if (shownCount >= MAX_PROBLEMS) { break; }
                    problemsText += `  - [${vscode.DiagnosticSeverity[p.severity]}] Line ${p.range.start.line + 1}: ${p.message}\n`;
                    shownCount++;
                }
                problemsText += "\n";
            }

            if (!problemsText) {
                return { problems: "No errors or warnings found in the workspace." };
            }

            if (totalCount > MAX_PROBLEMS) {
                problemsText += `... [${totalCount - MAX_PROBLEMS} more problems hidden. Use get_workspace_problems with a filePath to see details for a specific file.]\n`;
            }

            return { problems: problemsText, total: totalCount, shown: shownCount };
        }
    } as any);

    return {
        run_command,
        search_workspace,
        get_workspace_problems
    };
}

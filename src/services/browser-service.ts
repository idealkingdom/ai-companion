/**
 * Browser Service — Wraps the `agent-browser` CLI for browser automation.
 * Uses a persistent session to maintain browser state across tool calls.
 * 
 * Requires: npm install -g agent-browser && agent-browser install
 */
import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { outputChannel } from '../logger';

const SESSION_NAME = 'kdaina';
const DEFAULT_TIMEOUT = 30_000; // 30s
const OPEN_TIMEOUT = 60_000;   // 60s (first launch may download Chrome)

export class BrowserService {
    private static installChecked = false;
    private static isInstalled: boolean | null = null;

    /**
     * Check if agent-browser is available.
     * On first miss, shows a VS Code notification offering auto-install.
     */
    static async ensureInstalled(): Promise<{ installed: boolean; message?: string }> {
        if (BrowserService.installChecked && BrowserService.isInstalled === true) {
            return { installed: true };
        }

        try {
            const version = cp.execSync('agent-browser --version', {
                timeout: 5000,
                encoding: 'utf-8'
            }).trim();
            BrowserService.isInstalled = true;
            BrowserService.installChecked = true;
            outputChannel.appendLine(`[Browser] agent-browser detected: ${version}`);
            return { installed: true };
        } catch {
            BrowserService.installChecked = true;
            BrowserService.isInstalled = false;
            outputChannel.appendLine('[Browser] agent-browser not found — offering install');

            // Show interactive VS Code notification
            const choice = await vscode.window.showWarningMessage(
                'Browser automation requires agent-browser (by Vercel Labs). Install it now?',
                'Install Now',
                'Not Now'
            );

            if (choice === 'Install Now') {
                // Run install in a visible terminal so user sees progress
                const terminal = vscode.window.createTerminal('agent-browser install');
                terminal.show();
                terminal.sendText('npm install -g agent-browser && agent-browser install');
                
                // Reset cache so next tool call re-checks
                BrowserService.installChecked = false;
                BrowserService.isInstalled = null;
                
                return {
                    installed: false,
                    message: 'Installing agent-browser... Please wait for the terminal to finish, then try again.'
                };
            }

            return {
                installed: false,
                message: 'Browser tools require agent-browser. Run: npm install -g agent-browser && agent-browser install'
            };
        }
    }

    /**
     * Execute an agent-browser command scoped to the kdaina session.
     * Returns stdout as a string.
     */
    static exec(command: string, timeoutMs?: number): { success: boolean; output: string } {
        const timeout = timeoutMs || DEFAULT_TIMEOUT;
        const fullCommand = `agent-browser --session ${SESSION_NAME} ${command}`;
        
        outputChannel.appendLine(`[Browser] exec: ${fullCommand}`);
        
        try {
            const output = cp.execSync(fullCommand, {
                timeout,
                encoding: 'utf-8',
                maxBuffer: 1024 * 1024, // 1MB
                stdio: ['pipe', 'pipe', 'pipe']
            }).trim();
            
            outputChannel.appendLine(`[Browser] output (${output.length} chars): ${output.substring(0, 200)}${output.length > 200 ? '...' : ''}`);
            return { success: true, output };
        } catch (err: any) {
            const stderr = err.stderr?.toString()?.trim() || '';
            const stdout = err.stdout?.toString()?.trim() || '';
            const errorMsg = stderr || stdout || err.message || 'Unknown error';
            
            outputChannel.appendLine(`[Browser] error: ${errorMsg}`);
            return { success: false, output: errorMsg };
        }
    }

    /**
     * Open a URL with optional device emulation and color scheme.
     */
    static open(url: string, options?: { device?: string; colorScheme?: string }): { success: boolean; output: string } {
        let cmd = `open ${url}`;
        if (options?.device) {
            cmd += ` --device "${options.device}"`;
        }
        if (options?.colorScheme) {
            cmd += ` --color-scheme ${options.colorScheme}`;
        }
        return BrowserService.exec(cmd, OPEN_TIMEOUT);
    }

    /**
     * Take a snapshot of the current page (accessibility tree).
     */
    static snapshot(interactiveOnly: boolean = true): { success: boolean; output: string } {
        const flag = interactiveOnly ? ' -i' : '';
        return BrowserService.exec(`snapshot${flag}`);
    }

    /**
     * Perform an action on an element by ref.
     */
    static action(action: string, ref: string, value?: string): { success: boolean; output: string } {
        let cmd = `${action} ${ref}`;
        if (value !== undefined && value !== '') {
            // Quote the value to handle spaces
            cmd += ` "${value.replace(/"/g, '\\"')}"`;
        }
        return BrowserService.exec(cmd);
    }

    /**
     * Get information from the page.
     */
    static getInfo(property: string, selector?: string): { success: boolean; output: string } {
        let cmd = `get ${property}`;
        if (selector) {
            cmd += ` ${selector}`;
        }
        return BrowserService.exec(cmd);
    }

    /**
     * Evaluate JavaScript in the page context.
     */
    static evaluate(script: string): { success: boolean; output: string } {
        // Escape the script for shell
        const escaped = script.replace(/'/g, "'\\''");
        return BrowserService.exec(`eval '${escaped}'`);
    }

    /**
     * Close the browser session.
     */
    static close(): { success: boolean; output: string } {
        return BrowserService.exec('close');
    }

    /**
     * Take a screenshot and save to a path.
     */
    static screenshot(savePath?: string, fullPage: boolean = false): { success: boolean; output: string } {
        let cmd = 'screenshot';
        if (fullPage) {
            cmd += ' --full';
        }
        if (savePath) {
            cmd += ` ${savePath}`;
        }
        return BrowserService.exec(cmd);
    }

    /**
     * Clean up on extension deactivation.
     */
    static dispose(): void {
        try {
            cp.execSync(`agent-browser --session ${SESSION_NAME} close`, {
                timeout: 5000,
                encoding: 'utf-8',
                stdio: 'ignore'
            });
        } catch {
            // Ignore — browser may already be closed
        }
    }

    private static getInstallInstructions(): string {
        return `agent-browser is not installed. To enable browser automation, run:\n\n  npm install -g agent-browser\n  agent-browser install\n\nThis is a one-time setup that downloads a lightweight Chrome binary (~200MB).`;
    }
}

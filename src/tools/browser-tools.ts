/**
 * Browser Tools — Agent tools for browser automation using agent-browser CLI.
 * Provides 6 tools: open, snapshot, action, get, evaluate, close.
 * 
 * Uses accessibility-tree refs (@e1, @e2) for reliable element targeting
 * instead of fragile CSS selectors.
 * 
 * Requires: npm install -g agent-browser && agent-browser install
 */
import { tool as _tool } from 'ai';
const tool = _tool as any;
import { z } from 'zod';
import { BrowserService } from '../services/browser-service';
import { outputChannel } from '../logger';

export function createBrowserTools() {
    return {
        /**
         * Open a URL in a managed browser instance.
         * The browser persists across tool calls — open once, interact many times.
         */
        browser_open: tool({
            description: `Open a URL in a browser. Use this to navigate to web pages for testing, visual QA, or interacting with web apps. The browser session persists across calls — open once, then use browser_snapshot and browser_action to interact. Call browser_close when done.

IMPORTANT: After opening, ALWAYS call browser_snapshot to see the page structure before interacting.`,
            inputSchema: z.object({
                url: z.string().describe('URL to open (e.g. https://example.com or http://localhost:3000)'),
                device: z.string().optional().describe('Optional device to emulate (e.g. "iPhone 15 Pro", "iPad Mini")'),
                colorScheme: z.enum(['dark', 'light']).optional().describe('Color scheme preference')
            }),
            execute: async (params: { url: string; device?: string; colorScheme?: string }) => {
                outputChannel.appendLine(`[BrowserTool] browser_open: ${params.url}`);

                // Check installation
                const installCheck = await BrowserService.ensureInstalled();
                if (!installCheck.installed) {
                    return { error: installCheck.message };
                }

                const result = BrowserService.open(params.url, {
                    device: params.device,
                    colorScheme: params.colorScheme
                });

                if (!result.success) {
                    return { error: `Failed to open browser: ${result.output}` };
                }

                // Auto-get page info after opening
                const titleResult = BrowserService.getInfo('title');
                const urlResult = BrowserService.getInfo('url');

                return {
                    success: true,
                    title: titleResult.success ? titleResult.output : '(unknown)',
                    url: urlResult.success ? urlResult.output : params.url,
                    message: 'Browser opened. Call browser_snapshot to see the page structure and discover element refs (@e1, @e2...).'
                };
            }
        } as any),

        /**
         * Get the accessibility tree of the current page.
         * Returns element refs that can be used with browser_action.
         */
        browser_snapshot: tool({
            description: `Get the accessibility tree of the current browser page. Returns a compact list of elements with refs like @e1, @e2 that you can use with browser_action. This is your "eyes" — ALWAYS call this before interacting with elements, and after any navigation or significant action.

Example output:
- heading "Welcome" [ref=e1]
- link "Login" [ref=e2]
- input "Email" [ref=e3]
- button "Submit" [ref=e4]`,
            inputSchema: z.object({
                interactiveOnly: z.boolean().optional().describe('If true (default), only show interactive elements (buttons, links, inputs). Set false to see all elements including headings and text.')
            }),
            execute: async (params: { interactiveOnly?: boolean }) => {
                const interactive = params.interactiveOnly !== false; // default true
                outputChannel.appendLine(`[BrowserTool] browser_snapshot (interactive=${interactive})`);

                const result = BrowserService.snapshot(interactive);

                if (!result.success) {
                    return { error: `Snapshot failed: ${result.output}` };
                }

                return {
                    snapshot: result.output,
                    tip: 'Use the @eN refs with browser_action to interact (e.g. action="click", ref="@e3").'
                };
            }
        } as any),

        /**
         * Interact with a page element using its ref from browser_snapshot.
         */
        browser_action: tool({
            description: `Interact with a page element using its ref from browser_snapshot. Supports: click, fill, type, select, check, uncheck, hover, focus, dblclick, press, scroll.

RULES:
- ALWAYS call browser_snapshot first to get refs
- Use refs from the LATEST snapshot only — refs change after each snapshot
- For forms: use fill (clears first) not type (appends)
- For keyboard: use press with key names (Enter, Tab, Escape, ArrowDown)
- For scrolling: ref is direction (up/down/left/right), value is optional pixel amount

Examples:
  action="click", ref="@e3"
  action="fill", ref="@e5", value="user@example.com"
  action="press", ref="Enter"
  action="scroll", ref="down", value="500"`,
            inputSchema: z.object({
                action: z.enum(['click', 'fill', 'type', 'select', 'check', 'uncheck', 'hover', 'focus', 'dblclick', 'press', 'scroll']).describe('Action to perform'),
                ref: z.string().describe('Element ref from snapshot (@e1, @e2) or direction for scroll (up/down), or key name for press'),
                value: z.string().optional().describe('Text for fill/type/select, key for press, pixel amount for scroll')
            }),
            execute: async (params: { action: string; ref: string; value?: string }) => {
                outputChannel.appendLine(`[BrowserTool] browser_action: ${params.action} ${params.ref} ${params.value || ''}`);

                // For press and scroll, the "ref" is actually the value (key name / direction)
                let ref = params.ref;
                let value = params.value;

                if (params.action === 'press') {
                    // press takes a key name, not a ref
                    const result = BrowserService.exec(`press ${ref}`);
                    return result.success
                        ? { success: true, action: 'press', key: ref }
                        : { error: `Press failed: ${result.output}` };
                }

                if (params.action === 'scroll') {
                    // scroll takes direction + optional pixels
                    let cmd = `scroll ${ref}`;
                    if (value) { cmd += ` ${value}`; }
                    const result = BrowserService.exec(cmd);
                    return result.success
                        ? { success: true, action: 'scroll', direction: ref }
                        : { error: `Scroll failed: ${result.output}` };
                }

                const result = BrowserService.action(params.action, ref, value);

                if (!result.success) {
                    return { error: `Action '${params.action}' on '${ref}' failed: ${result.output}` };
                }

                return {
                    success: true,
                    action: params.action,
                    ref: ref,
                    message: `${params.action} on ${ref} completed. Call browser_snapshot to see the updated page state.`
                };
            }
        } as any),

        /**
         * Extract information from the current page.
         */
        browser_get: tool({
            description: `Extract information from the current browser page. Get text content, HTML, input values, page title, URL, element count, or computed styles.

Examples:
  property="title" → page title
  property="url" → current URL
  property="text", selector="@e5" → text content of element
  property="value", selector="@e3" → input field value
  property="count", selector=".item" → number of matching elements`,
            inputSchema: z.object({
                property: z.enum(['text', 'html', 'value', 'title', 'url', 'count', 'styles']).describe('What to get'),
                selector: z.string().optional().describe('Element ref (@e1) or CSS selector. Required for text/html/value/count/styles.')
            }),
            execute: async (params: { property: string; selector?: string }) => {
                outputChannel.appendLine(`[BrowserTool] browser_get: ${params.property} ${params.selector || ''}`);

                const result = BrowserService.getInfo(params.property, params.selector);

                if (!result.success) {
                    return { error: `Get '${params.property}' failed: ${result.output}` };
                }

                return {
                    property: params.property,
                    result: result.output
                };
            }
        } as any),

        /**
         * Execute JavaScript in the browser page context.
         */
        browser_evaluate: tool({
            description: `Execute JavaScript in the browser page context and return the result. Use this for complex queries, DOM manipulation, or checking JS state that other tools can't access.

Examples:
  script="document.querySelectorAll('.item').length"
  script="window.localStorage.getItem('token')"
  script="document.title + ' - ' + location.href"`,
            inputSchema: z.object({
                script: z.string().describe('JavaScript code to execute in the page context')
            }),
            execute: async (params: { script: string }) => {
                outputChannel.appendLine(`[BrowserTool] browser_evaluate: ${params.script.substring(0, 100)}`);

                const result = BrowserService.evaluate(params.script);

                if (!result.success) {
                    return { error: `Eval failed: ${result.output}` };
                }

                return {
                    result: result.output
                };
            }
        } as any),

        /**
         * Close the browser session and clean up resources.
         */
        browser_close: tool({
            description: 'Close the browser session. Call this when you are done with browser automation to free resources.',
            inputSchema: z.object({}),
            execute: async () => {
                outputChannel.appendLine('[BrowserTool] browser_close');

                const result = BrowserService.close();

                return {
                    success: result.success,
                    message: result.success ? 'Browser closed.' : `Close failed: ${result.output}`
                };
            }
        } as any)
    };
}

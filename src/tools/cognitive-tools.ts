/**
 * Cognitive Tools — Agentic reasoning scaffolding for LLMs.
 * 
 * These tools help models structure their thinking:
 *   - plan_task:             Break down user request into steps (all tiers)
 *   - verify_completion:     Self-check all items addressed (all tiers)
 *   - update_task_progress:  Report progress to the user (all tiers)
 * 
 * Progress is auto-persisted to a session artifact (_progress.md) so the
 * agent can resume seamlessly when the user says "continue" after step limits.
 */
import { tool as _tool } from 'ai';
const tool = _tool as any;
import { z } from 'zod';
import { outputChannel } from '../logger';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export type ModelTier = 'frontier' | 'mid' | 'small';

/**
 * know exactly where it left off.
 */
function persistProgress(chatId: string, content: string) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot || chatId === 'unknown_chat') { return; }

    try {
        const dir = path.join(workspaceRoot, '.ai-companion', 'artifacts', 'sessions', chatId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(path.join(dir, 'task.md'), content, 'utf-8');
    } catch (e) {
        outputChannel.appendLine(`[Cognitive] Failed to persist progress: ${e}`);
    }
}

/**
 * Create cognitive tools (same for all tiers).
 * think_next_step was removed — models have native reasoning capabilities
 * and should use tool calls directly instead of wasting tokens on scratchpad calls.
 */
export function createCognitiveTools(tier: ModelTier, chatId?: string) {
    const tools: Record<string, any> = {};

    // ─── PLAN_TASK — All tiers ──────────────────────────────────────
    tools.plan_task = tool({
        description: 'Call this FIRST before starting any work. Break down the user\'s request into a numbered list of discrete steps. This helps you stay organized and ensures nothing is missed. The plan is auto-saved so you can resume after step limits.',
        inputSchema: z.object({
            user_intent: z.string().describe('One-line summary of what the user wants'),
            steps: z.array(z.string()).describe('Ordered list of concrete steps to complete the task')
        }),
        execute: async (params: { user_intent: string; steps: string[] }) => {
            outputChannel.appendLine(`[Cognitive] Plan created: ${params.steps.length} steps — "${params.user_intent}"`);

            // Auto-persist plan as a session artifact
            const progressMd = `# Task Progress\n**Goal:** ${params.user_intent}\n\n${params.steps.map((s, i) => `- [ ] ${i + 1}. ${s}`).join('\n')}\n\n_Last updated: ${new Date().toLocaleTimeString()}_\n`;
            persistProgress(chatId || 'unknown_chat', progressMd);

            return {
                plan_recorded: true,
                total_steps: params.steps.length,
                message: `Plan with ${params.steps.length} steps recorded. Execute each step in order. Call verify_completion when done.`
            };
        }
    } as any);

    // ─── VERIFY_COMPLETION — All tiers ──────────────────────────────
    tools.verify_completion = tool({
        description: 'Call this AFTER completing all work. List everything the user asked for and verify each item was addressed. If items remain, continue working on them.',
        inputSchema: z.object({
            user_request_items: z.array(z.string()).describe('List of distinct things the user asked for'),
            completed: z.array(z.string()).describe('Items you successfully completed'),
            remaining: z.array(z.string()).describe('Items still pending, if any')
        }),
        execute: async (params: { user_request_items: string[]; completed: string[]; remaining: string[] }) => {
            const total = params.user_request_items.length;
            const done = params.completed.length;
            const left = params.remaining.length;

            outputChannel.appendLine(`[Cognitive] Verify: ${done}/${total} done, ${left} remaining`);

            // Update progress artifact with completion status
            const progressMd = `# Task Progress\n**Status:** ${left > 0 ? 'IN PROGRESS' : 'COMPLETE'}\n\n## Completed (${done})\n${params.completed.map(c => `- [x] ${c}`).join('\n')}\n\n${left > 0 ? `## Remaining (${left})\n${params.remaining.map(r => `- [ ] ${r}`).join('\n')}` : ''}\n\n_Last updated: ${new Date().toLocaleTimeString()}_\n`;
            persistProgress(chatId || 'unknown_chat', progressMd);

            if (left > 0) {
                return {
                    status: 'incomplete',
                    message: `You completed ${done}/${total} items. Still remaining: ${params.remaining.join(', ')}. Continue working on these.`,
                    remaining: params.remaining
                };
            }
            return {
                status: 'complete',
                message: `All ${total} items addressed successfully.`
            };
        }
    } as any);

    // ─── UPDATE_TASK_PROGRESS — All tiers ─────────────────────────────
    tools.update_task_progress = tool({
        description: 'Report progress on the current task. Call this after completing each major step to keep the user informed. Shows a checklist in the chat. Progress is auto-saved for resumption.',
        inputSchema: z.object({
            tasks: z.array(z.object({
                description: z.string().describe('What this step is'),
                status: z.enum(['pending', 'in_progress', 'done', 'skipped']).describe('Current status of this step')
            })).describe('Full task list with current statuses')
        }),
        execute: async (params: { tasks: { description: string; status: string }[] }) => {
            const icons: Record<string, string> = { pending: '⬜', in_progress: '🔄', done: '✅', skipped: '⏭️' };
            const checkboxes: Record<string, string> = { pending: '- [ ]', in_progress: '- [ ] 🔄', done: '- [x]', skipped: '- [x] ~~' };
            const summary = params.tasks.map(t => `${icons[t.status] || '⬜'} ${t.description}`).join('\n');
            const done = params.tasks.filter(t => t.status === 'done').length;
            const total = params.tasks.length;

            outputChannel.appendLine(`[Cognitive] Progress: ${done}/${total} tasks done`);

            // Auto-persist progress for continuation
            const progressMd = `# Task Progress\n**Status:** ${done}/${total} steps complete\n\n${params.tasks.map(t => {
                const prefix = checkboxes[t.status] || '- [ ]';
                const suffix = t.status === 'skipped' ? '~~' : '';
                return `${prefix} ${t.description}${suffix}`;
            }).join('\n')}\n\n_Last updated: ${new Date().toLocaleTimeString()}_\n`;
            persistProgress(chatId || 'unknown_chat', progressMd);

            return {
                progress_recorded: true,
                completed: done,
                total: total,
                checklist: summary
            };
        }
    } as any);

    return tools;
}

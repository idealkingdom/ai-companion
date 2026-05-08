/**
 * Cognitive Tools — Agentic reasoning scaffolding for LLMs.
 * 
 * These tools help models (especially smaller ones) structure their thinking:
 *   - plan_task:         Break down user request into steps (all tiers)
 *   - think_next_step:   Scratchpad before each action (small/mid only)
 *   - verify_completion: Self-check all items addressed (all tiers)
 */
import { tool as _tool } from 'ai';
const tool = _tool as any;
import { z } from 'zod';
import { outputChannel } from '../logger';

export type ModelTier = 'frontier' | 'mid' | 'small';

/**
 * Create cognitive tools filtered by model tier.
 * - Frontier: plan_task + verify_completion only
 * - Mid/Small: all three (includes think_next_step scratchpad)
 */
export function createCognitiveTools(tier: ModelTier) {
    const tools: Record<string, any> = {};

    // ─── PLAN_TASK — All tiers ──────────────────────────────────────
    tools.plan_task = tool({
        description: 'Call this FIRST before starting any work. Break down the user\'s request into a numbered list of discrete steps. This helps you stay organized and ensures nothing is missed.',
        inputSchema: z.object({
            user_intent: z.string().describe('One-line summary of what the user wants'),
            steps: z.array(z.string()).describe('Ordered list of concrete steps to complete the task')
        }),
        execute: async (params: { user_intent: string; steps: string[] }) => {
            outputChannel.appendLine(`[Cognitive] Plan created: ${params.steps.length} steps — "${params.user_intent}"`);
            return {
                plan_recorded: true,
                total_steps: params.steps.length,
                message: `Plan with ${params.steps.length} steps recorded. Execute each step in order. Call verify_completion when done.`
            };
        }
    } as any);

    // ─── THINK_NEXT_STEP — Small/Mid only ───────────────────────────
    if (tier === 'small' || tier === 'mid') {
        tools.think_next_step = tool({
            description: 'Call this BEFORE each tool call. Write your reasoning about what you plan to do and why. This prevents mistakes and keeps you on track.',
            inputSchema: z.object({
                thought: z.string().describe('Your reasoning about what to do next'),
                planned_tool: z.string().describe('Name of the tool you will call next'),
                step_number: z.number().optional().describe('Which step from your plan you are on')
            }),
            execute: async (params: { thought: string; planned_tool: string; step_number?: number }) => {
                outputChannel.appendLine(`[Cognitive] Think: step=${params.step_number || '?'}, next=${params.planned_tool}`);
                return {
                    acknowledged: true,
                    proceed: `Now execute: ${params.planned_tool}`
                };
            }
        } as any);
    }

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

    return tools;
}

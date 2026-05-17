import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { tool as _tool } from 'ai';
const tool = _tool as any;
import { z } from 'zod';
import { outputChannel } from '../logger';

export function createArtifactTools(chatId: string) {

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const baseDir = path.join(workspaceRoot, '.kdaina', 'artifacts');

    // ─── TOOL: manage_artifact ──────────────────────────────────────────
    const manage_artifact = tool({
        description: 'Create or update a structured document artifact (e.g., Architecture, Walkthrough, Checklist). Artifacts are saved to a dedicated .kdaina/artifacts folder. Use this instead of outputting long plans in chat.',
        inputSchema: z.object({
            name: z.string().describe('Filename of the artifact (must end in .md, e.g., checklist.md)'),
            scope: z.enum(['global', 'session']).describe('global: persists across all chats in the workspace. session: ephemeral to this specific chat.'),
            action: z.enum(['create', 'update']).describe('create: write new file. update: replace entire contents (must provide full new content)'),
            content: z.string().describe('The full markdown content of the artifact')
        }),
        execute: async (params: { name: string; scope: 'global' | 'session'; action: 'create' | 'update'; content: string }, { toolCallId }: any) => {
            if (!params.name.endsWith('.md')) {
                return { error: 'Artifact name must end with .md' };
            }

            if (!workspaceRoot) {
                return { error: 'No workspace open to save artifacts.' };
            }

            // Determine directory
            const targetDir = params.scope === 'global' 
                ? path.join(baseDir, 'global')
                : path.join(baseDir, 'sessions', chatId);

            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            const filePath = path.join(targetDir, params.name);
            
            // For both create and update, we write the full content
            fs.writeFileSync(filePath, params.content, 'utf-8');

            // Trigger VS Code to open the preview
            const uri = vscode.Uri.file(filePath);
            vscode.commands.executeCommand('markdown.showPreviewToSide', uri).then(undefined, err => {
                outputChannel.appendLine(`[Artifact] Failed to open preview: ${err}`);
            });

            return {
                success: true,
                message: `Artifact ${params.name} saved successfully in ${params.scope} scope.`,
                path: filePath,
                _artifactManaged: {
                    name: params.name,
                    scope: params.scope,
                    action: params.action
                }
            };
        }
    } as any);

    // ─── TOOL: read_artifact ────────────────────────────────────────────
    const read_artifact = tool({
        description: 'Read the full content of a specific artifact by name and scope. Use this when you need to review a plan, checklist, or architecture document before continuing work. The system prompt shows you a manifest of available artifacts — use this tool to load the ones relevant to your current task.',
        inputSchema: z.object({
            name: z.string().describe('Filename of the artifact (e.g., checklist.md)'),
            scope: z.enum(['global', 'session']).describe('The scope where the artifact lives.')
        }),
        execute: async (params: { name: string; scope: 'global' | 'session' }) => {
            if (!workspaceRoot) {
                return { error: 'No workspace open.' };
            }

            const targetDir = params.scope === 'global'
                ? path.join(baseDir, 'global')
                : path.join(baseDir, 'sessions', chatId);

            const filePath = path.join(targetDir, params.name);

            if (!fs.existsSync(filePath)) {
                return { error: `Artifact not found: ${params.scope}/${params.name}` };
            }

            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                return {
                    name: params.name,
                    scope: params.scope,
                    content
                };
            } catch (e: any) {
                return { error: `Failed to read artifact: ${e.message}` };
            }
        }
    } as any);

    return { manage_artifact, read_artifact };
}

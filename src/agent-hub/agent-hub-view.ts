/**
 * Agent Hub View
 * WebviewPanel for managing indexed sources, agent profiles, and smart prompts.
 * Follows the same pattern as SettingsView.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { outputChannel } from '../logger';
import { SourceIndexService, SourceType, IndexedSource } from '../services/source-index';
import { WebScraperService } from '../services/web-scraper';
import { DocumentParserService } from '../services/document-parser';
import { SettingsManager } from '../services/settings-manager';
import { getModelProviderOptions, PromptDef } from '../constants';

export class AgentHubView {
    public static currentPanel: AgentHubView | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private sourceIndex: SourceIndexService;
    private scraper: WebScraperService;
    private docParser: DocumentParserService;

    private settingsManager: SettingsManager;

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        context: vscode.ExtensionContext
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this.sourceIndex = new SourceIndexService(context);
        this.scraper = new WebScraperService();
        this.docParser = new DocumentParserService();

        this.settingsManager = new SettingsManager(context);

        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => this._handleMessage(message),
            null,
            this._disposables
        );
    }

    public static createOrShow(context: vscode.ExtensionContext) {
        const column = vscode.window.activeTextEditor?.viewColumn;

        if (AgentHubView.currentPanel) {
            AgentHubView.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'aiCompanionAgentHub',
            'Agent Hub',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview')]
            }
        );

        AgentHubView.currentPanel = new AgentHubView(panel, context.extensionUri, context);
    }

    public dispose() {
        AgentHubView.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) { x.dispose(); }
        }
    }

    // ─── HELPERS ─────────────────────────────────────────────────────────

    private sendSources() {
        this._panel.webview.postMessage({
            command: 'loadSources',
            sources: this.sourceIndex.getSources()
        });
    }

    private sendAgents() {
        const settings = this.settingsManager.getSettings();
        this._panel.webview.postMessage({
            command: 'loadAgents',
            agents: settings.prompts
        });
    }

    private sendRules() {
        const settings = this.settingsManager.getSettings();
        this._panel.webview.postMessage({
            command: 'loadRules',
            rules: (settings as any).rules || []
        });
    }

    // ─── MESSAGE HANDLER ─────────────────────────────────────────────────

    private async _handleMessage(message: any) {
        switch (message.command) {

            // ═══ SOURCES ═══════════════════════════════════════════════

            case 'requestSources': {
                this.sendSources();
                return;
            }

            case 'addUrl': {
                const { url } = message.data;
                outputChannel.appendLine(`[AgentHub] Adding URL: ${url}`);

                const source = await this.sourceIndex.addSource({
                    type: 'url',
                    origin: url,
                    title: url,
                    content: '',
                    chunks: [],
                    metadata: {
                        dateIndexed: new Date().toISOString(),
                        lastUpdated: new Date().toISOString(),
                        contentType: 'text/html',
                        sizeBytes: 0,
                        wordCount: 0
                    },
                    status: 'indexing'
                });

                this._panel.webview.postMessage({ command: 'sourceAdded', source });

                const result = await this.scraper.scrape(url);
                if (result.success) {
                    const chunks = SourceIndexService.chunkContent(result.content);
                    await this.sourceIndex.updateSource(source.id, {
                        title: result.title,
                        content: result.content,
                        chunks,
                        status: 'indexed',
                        metadata: {
                            dateIndexed: source.metadata.dateIndexed,
                            lastUpdated: new Date().toISOString(),
                            contentType: result.contentType,
                            sizeBytes: result.sizeBytes,
                            wordCount: result.wordCount
                        }
                    });
                } else {
                    // Keep whatever was stored (empty for first add, but consistent)
                    await this.sourceIndex.updateSource(source.id, {
                        status: 'error',
                        metadata: { ...source.metadata, errorMessage: result.error || 'Failed to scrape URL' }
                    });
                }

                this.sendSources();
                return;
            }

            case 'uploadDocument': {
                const files = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    filters: {
                        'Documents': ['pdf', 'csv', 'txt', 'md', 'json', 'xml'],
                        'All Files': ['*']
                    },
                    title: 'Select Document to Index'
                });

                if (!files || files.length === 0) { return; }

                const filePath = files[0].fsPath;
                const fileName = path.basename(filePath);
                const ext = path.extname(filePath).toLowerCase().replace('.', '');
                let sourceType: SourceType;
                if (ext === 'pdf') { sourceType = 'pdf'; }
                else if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') { sourceType = 'excel'; }
                else { sourceType = 'text'; }

                const source = await this.sourceIndex.addSource({
                    type: sourceType,
                    origin: filePath,
                    title: fileName,
                    content: '',
                    chunks: [],
                    metadata: {
                        dateIndexed: new Date().toISOString(),
                        lastUpdated: new Date().toISOString(),
                        contentType: ext,
                        sizeBytes: 0,
                        wordCount: 0
                    },
                    status: 'indexing'
                });

                this._panel.webview.postMessage({ command: 'sourceAdded', source });

                const result = await this.docParser.parse(filePath);
                if (result.success) {
                    const chunks = SourceIndexService.chunkContent(result.content);
                    await this.sourceIndex.updateSource(source.id, {
                        title: result.title,
                        content: result.content,
                        chunks,
                        status: 'indexed',
                        metadata: {
                            dateIndexed: source.metadata.dateIndexed,
                            lastUpdated: new Date().toISOString(),
                            contentType: result.contentType,
                            sizeBytes: result.sizeBytes,
                            wordCount: result.wordCount
                        }
                    });
                } else {
                    await this.sourceIndex.updateSource(source.id, {
                        status: 'error',
                        metadata: { ...source.metadata, errorMessage: result.error || 'Failed to parse document' }
                    });
                }

                this.sendSources();
                return;
            }

            case 'deleteSource': {
                await this.sourceIndex.deleteSource(message.data.id);
                this.sendSources();
                return;
            }

            case 'updateSource': {
                const src = this.sourceIndex.getSource(message.data.id);
                if (!src) { return; }

                // Pre-check: file-based sources — does the file still exist?
                if (src.type !== 'url' && !fs.existsSync(src.origin)) {
                    const action = await vscode.window.showWarningMessage(
                        `File not found: ${path.basename(src.origin)}`,
                        { detail: src.origin, modal: false },
                        'Locate File', 'Remove Source'
                    );
                    if (action === 'Locate File') {
                        const newFile = await vscode.window.showOpenDialog({
                            canSelectMany: false,
                            title: `Locate: ${path.basename(src.origin)}`,
                            openLabel: 'Use This File'
                        });
                        if (newFile && newFile.length > 0) {
                            await this.sourceIndex.updateSource(src.id, { origin: newFile[0].fsPath });
                            // Re-trigger update with the corrected path
                            this._handleMessage({ command: 'updateSource', data: { id: src.id } });
                        }
                    } else if (action === 'Remove Source') {
                        await this.sourceIndex.deleteSource(src.id);
                        this.sendSources();
                    } else {
                        // User dismissed — mark as error but keep existing content
                        await this.sourceIndex.updateSource(src.id, {
                            status: 'error',
                            metadata: { ...src.metadata, errorMessage: 'File not found — try re-uploading or locating the file' }
                        });
                        this.sendSources();
                    }
                    return;
                }

                await this.sourceIndex.updateSource(src.id, { status: 'updating' });
                this.sendSources();

                if (src.type === 'url') {
                    const result = await this.scraper.scrape(src.origin);
                    if (result.success) {
                        const chunks = SourceIndexService.chunkContent(result.content);
                        await this.sourceIndex.updateSource(src.id, {
                            title: result.title, content: result.content, chunks, status: 'indexed',
                            metadata: { ...src.metadata, lastUpdated: new Date().toISOString(), sizeBytes: result.sizeBytes, wordCount: result.wordCount }
                        });
                    } else {
                        await this.sourceIndex.updateSource(src.id, { status: 'error', metadata: { ...src.metadata, errorMessage: result.error || 'Failed to scrape — previous content preserved' } });
                    }
                } else {
                    const result = await this.docParser.parse(src.origin);
                    if (result.success) {
                        const chunks = SourceIndexService.chunkContent(result.content);
                        await this.sourceIndex.updateSource(src.id, {
                            content: result.content, chunks, status: 'indexed',
                            metadata: { ...src.metadata, lastUpdated: new Date().toISOString(), sizeBytes: result.sizeBytes, wordCount: result.wordCount }
                        });
                    } else {
                        await this.sourceIndex.updateSource(src.id, { status: 'error', metadata: { ...src.metadata, errorMessage: result.error || 'Failed to parse — try re-uploading the file' } });
                    }
                }

                this.sendSources();
                return;
            }

            case 'updateAllSources': {
                const allSrc = this.sourceIndex.getSources().filter(s => s.status === 'indexed' || s.status === 'error');
                const missingSources: string[] = [];

                for (const src of allSrc) {
                    // Skip file-based sources whose files are missing
                    if (src.type !== 'url' && !fs.existsSync(src.origin)) {
                        missingSources.push(path.basename(src.origin));
                        await this.sourceIndex.updateSource(src.id, {
                            status: 'error',
                            metadata: { ...src.metadata, errorMessage: 'File not found — try re-uploading' }
                        });
                        continue;
                    }
                    await this.sourceIndex.updateSource(src.id, { status: 'updating' });
                }
                this.sendSources();

                // Notify about missing files
                if (missingSources.length > 0) {
                    vscode.window.showWarningMessage(
                        `${missingSources.length} source file(s) not found: ${missingSources.join(', ')}`
                    );
                }

                for (const src of allSrc) {
                    // Skip already-errored missing files
                    const current = this.sourceIndex.getSource(src.id);
                    if (!current || current.status === 'error') { continue; }

                    if (src.type === 'url') {
                        const result = await this.scraper.scrape(src.origin);
                        if (result.success) {
                            const chunks = SourceIndexService.chunkContent(result.content);
                            await this.sourceIndex.updateSource(src.id, {
                                title: result.title, content: result.content, chunks, status: 'indexed',
                                metadata: { ...src.metadata, lastUpdated: new Date().toISOString(), sizeBytes: result.sizeBytes, wordCount: result.wordCount }
                            });
                        } else {
                            await this.sourceIndex.updateSource(src.id, { status: 'error', metadata: { ...src.metadata, errorMessage: result.error || 'Failed to scrape — previous content preserved' } });
                        }
                    } else {
                        const result = await this.docParser.parse(src.origin);
                        if (result.success) {
                            const chunks = SourceIndexService.chunkContent(result.content);
                            await this.sourceIndex.updateSource(src.id, {
                                content: result.content, chunks, status: 'indexed',
                                metadata: { ...src.metadata, lastUpdated: new Date().toISOString(), sizeBytes: result.sizeBytes, wordCount: result.wordCount }
                            });
                        } else {
                            await this.sourceIndex.updateSource(src.id, { status: 'error', metadata: { ...src.metadata, errorMessage: result.error || 'Failed to parse — try re-uploading' } });
                        }
                    }
                    this.sendSources();
                }
                return;
            }

            case 'searchSources': {
                const results = this.sourceIndex.search(message.data.query);
                this._panel.webview.postMessage({ command: 'searchResults', results });
                return;
            }

            case 'viewSourceContent': {
                const src = this.sourceIndex.getSource(message.data.id);
                if (src) {
                    this._panel.webview.postMessage({ command: 'viewSourceContent', source: src });
                }
                return;
            }

            // ═══ AGENTS ═══════════════════════════════════════════════

            case 'requestAgents': {
                this.sendAgents();
                return;
            }

            case 'addAgent': {
                const settings = this.settingsManager.getSettings();
                settings.prompts = settings.prompts || [];
                const newAgent: PromptDef = {
                    id: Date.now().toString(),
                    name: 'New Agent',
                    description: 'A new custom agent profile.',
                    systemPrompt: 'You are an AI assistant.',
                    isActive: true,
                    order: settings.prompts.length + 1,
                    linkedSources: []
                };
                settings.prompts.push(newAgent);
                await this.settingsManager.updateSettings({ prompts: settings.prompts });
                vscode.window.showInformationMessage(`Agent '${newAgent.name}' created!`);
                this.sendAgents();
                return;
            }

            case 'updateAgent': {
                const { id, field, value } = message.data;
                const settings = this.settingsManager.getSettings();
                settings.prompts = settings.prompts || [];
                const agent = settings.prompts.find((p: PromptDef) => p.id === id);
                if (!agent) { return; }

                if (field === 'name') { agent.name = value; }
                else if (field === 'content') { agent.content = value; }
                else if (field === 'isActive') { agent.isActive = !!value; }

                await this.settingsManager.updateSettings({ prompts: settings.prompts });
                this.sendAgents();
                return;
            }

            case 'reorderAgents': {
                const { agentId: aId, newIndex } = message.data;
                const settings5 = this.settingsManager.getSettings();
                settings5.prompts = settings5.prompts || [];
                const agent5 = settings5.prompts.find((p: PromptDef) => p.id === aId);
                if (agent5) {
                    settings5.prompts = settings5.prompts.filter((p: PromptDef) => p.id !== aId);
                    settings5.prompts.splice(newIndex, 0, agent5);
                    settings5.prompts.forEach((p: PromptDef, i: number) => p.order = i + 1);
                    await this.settingsManager.updateSettings({ prompts: settings5.prompts });
                }
                this.sendAgents();
                return;
            }

            case 'deleteAgent': {
                const settings2 = this.settingsManager.getSettings();
                settings2.prompts = settings2.prompts || [];
                settings2.prompts = settings2.prompts.filter((p: PromptDef) => p.id !== message.data.id);
                settings2.prompts.forEach((p: PromptDef, i: number) => p.order = i + 1);
                await this.settingsManager.updateSettings({ prompts: settings2.prompts });
                this.sendAgents();
                return;
            }

            case 'linkSource': {
                const { agentId, sourceId } = message.data;
                const settings3 = this.settingsManager.getSettings();
                settings3.prompts = settings3.prompts || [];
                const agent3 = settings3.prompts.find((p: PromptDef) => p.id === agentId);
                if (!agent3) { return; }

                if (!agent3.linkedSources) { agent3.linkedSources = []; }
                if (!agent3.linkedSources.includes(sourceId)) {
                    agent3.linkedSources.push(sourceId);
                    await this.settingsManager.updateSettings({ prompts: settings3.prompts });
                }
                this.sendAgents();
                return;
            }

            case 'unlinkSource': {
                const { agentId: aId, sourceId: sId } = message.data;
                const settings4 = this.settingsManager.getSettings();
                settings4.prompts = settings4.prompts || [];
                const agent4 = settings4.prompts.find((p: PromptDef) => p.id === aId);
                if (!agent4 || !agent4.linkedSources) { return; }

                agent4.linkedSources = agent4.linkedSources.filter((id: string) => id !== sId);
                await this.settingsManager.updateSettings({ prompts: settings4.prompts });
                this.sendAgents();
                return;
            }

            // ═══ SMART GENERATE ═══════════════════════════════════════

            case 'smartGenerate': {
                const { agentId } = message.data;
                const settings5 = this.settingsManager.getSettings();
                settings5.prompts = settings5.prompts || [];
                const agent5 = settings5.prompts.find((p: PromptDef) => p.id === agentId);
                if (!agent5) { return; }

                // Gather context: agent name + current prompt + linked source content
                const linkedContent: string[] = [];
                if (agent5.linkedSources) {
                    for (const sid of agent5.linkedSources) {
                        const src = this.sourceIndex.getSource(sid);
                        if (src && src.status === 'indexed' && src.content) {
                            linkedContent.push(`[Source: ${src.title}]\n${src.content.substring(0, 3000)}`);
                        }
                    }
                }

                const sourceContext = linkedContent.length > 0
                    ? `\n\nThe following knowledge sources are linked to this agent:\n\n${linkedContent.join('\n\n---\n\n')}`
                    : '';

                const aiMessages = [
                    {
                        role: 'system',
                        content: `You are an expert at crafting precise, effective system prompts for AI assistants. Your task is to generate an improved system prompt based on the agent's identity and any linked knowledge sources. Output ONLY the system prompt text — no explanations, no markdown, no quotes.`
                    },
                    {
                        role: 'user',
                        content: `Agent name: "${agent5.name}"\nCurrent system prompt: "${agent5.content}"${sourceContext}\n\nGenerate an improved, detailed system prompt for this agent. The prompt should:\n- Define the agent's role and expertise clearly\n- Incorporate knowledge from linked sources if available\n- Be professional and actionable\n- Be 100-500 words`
                    }
                ];

                try {
                    const { openAIRequest } = require('../api/ai');
                    const result = await openAIRequest(
                        aiMessages,
                        settings5.models.textModel,
                        settings5.models.apiKey,
                        0.7,
                        settings5.models.baseUrl || undefined
                    );

                    if (result.content) {
                        // Persist the generated prompt
                        agent5.content = result.content;
                        await this.settingsManager.updateSettings({ prompts: settings5.prompts });

                        this._panel.webview.postMessage({
                            command: 'smartGenerateResult',
                            agentId,
                            generatedPrompt: result.content
                        });
                    }
                } catch (err: any) {
                    outputChannel.appendLine(`[AgentHub] Smart Generate failed: ${err.message}`);
                    vscode.window.showErrorMessage(`Smart Generate failed: ${err.message}`);
                    // Send empty result to reset button state
                    this._panel.webview.postMessage({
                        command: 'smartGenerateResult',
                        agentId,
                        generatedPrompt: null
                    });
                }
                return;
            }

            // ═══ RULES (#68) ═══════════════════════════════════════════

            case 'requestRules': {
                this.sendRules();
                return;
            }

            case 'addRule': {
                const settings = this.settingsManager.getSettings() as any;
                if (!settings.rules) { settings.rules = []; }
                const newRule = {
                    id: Date.now().toString(),
                    name: 'New Rule',
                    content: '',
                    scope: 'global'
                };
                settings.rules.push(newRule);
                await this.settingsManager.updateSettings({ rules: settings.rules } as any);
                vscode.window.showInformationMessage(`Rule '${newRule.name}' created!`);
                this.sendRules();
                return;
            }

            case 'updateRule': {
                const { id, field, value } = message.data;
                const settings = this.settingsManager.getSettings() as any;
                if (!settings.rules) { return; }
                const rule = settings.rules.find((r: any) => r.id === id);
                if (!rule) { return; }

                if (field === 'name') { rule.name = value; }
                else if (field === 'content') { rule.content = value; }
                else if (field === 'scope') { rule.scope = value; }

                await this.settingsManager.updateSettings({ rules: settings.rules } as any);
                return;
            }

            case 'deleteRule': {
                const settings = this.settingsManager.getSettings() as any;
                if (!settings.rules) { return; }
                settings.rules = settings.rules.filter((r: any) => r.id !== message.data.id);
                await this.settingsManager.updateSettings({ rules: settings.rules } as any);
                this.sendRules();
                return;
            }

            case 'smartGenerateRule': {
                const { ruleId } = message.data;
                const settings = this.settingsManager.getSettings() as any;
                const rule = (settings.rules || []).find((r: any) => r.id === ruleId);
                if (!rule) { return; }

                try {
                    const { aiRequest } = require('../api/ai');
                    const providerName = settings.models.provider || 'OpenAI';
                    const pConfig = settings.models.providerSettings?.[providerName] || {};
                    const apiKey = pConfig.apiKey || settings.models.apiKey || '';
                    const baseUrl = pConfig.baseUrl || '';

                    const result = await aiRequest(
                        [
                            {
                                role: 'system',
                                content: 'You are an expert at writing precise, actionable rules for AI coding assistants. Output ONLY the rule text — no markdown, no explanations, no quotes. Rules should be clear, specific, and enforceable.'
                            },
                            {
                                role: 'user',
                                content: `Generate a detailed rule for an AI coding assistant based on this rule name: "${rule.name}".\nCurrent content: "${rule.content || '(empty)'}"\n\nThe rule should:\n- Be specific and actionable\n- Cover edge cases\n- Be 50-200 words\n- Use imperative language`
                            }
                        ],
                        settings.models.textModel,
                        apiKey,
                        0.7,
                        providerName,
                        baseUrl
                    );

                    if (result.content) {
                        rule.content = result.content;
                        await this.settingsManager.updateSettings({ rules: settings.rules } as any);
                        this._panel.webview.postMessage({
                            command: 'smartGenerateRuleResult',
                            ruleId,
                            generatedContent: result.content
                        });
                    }
                } catch (err: any) {
                    outputChannel.appendLine(`[AgentHub] Rule Generate failed: ${err.message}`);
                    vscode.window.showErrorMessage(`Rule Generate failed: ${err.message}`);
                    this._panel.webview.postMessage({
                        command: 'smartGenerateRuleResult',
                        ruleId,
                        generatedContent: null
                    });
                }
                return;
            }
        }
    }

    // ─── HTML ────────────────────────────────────────────────────────────

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'webview', 'agent-hub', 'agent-hub.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'webview', 'agent-hub', 'agent-hub.css')
        );
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'webview', 'agent-hub', 'index.html');
        let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
        html = html.replace('agent-hub.css', styleUri.toString());
        html = html.replace('agent-hub.js', scriptUri.toString());
        return html;
    }
}

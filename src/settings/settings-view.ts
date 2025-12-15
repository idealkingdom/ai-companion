import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SettingsManager } from '../services/settings-manager';

export class SettingsView {
    public static currentPanel: SettingsView | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _settingsManager: SettingsManager;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, settingsManager: SettingsManager) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._settingsManager = settingsManager;

        // Set the webview's initial html content
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'requestSettings':
                        const settings = this._settingsManager.getSettings();
                        this._panel.webview.postMessage({ command: 'loadSettings', settings });
                        return;

                    case 'saveSettings':
                        await this._settingsManager.updateSettings(message.settings);
                        vscode.window.showInformationMessage('Settings saved successfully!');
                        break;

                    case 'fetchModels':
                        await this.handleFetchModels(message, this._panel.webview);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(context: vscode.ExtensionContext, settingsManager: SettingsManager) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it.
        if (SettingsView.currentPanel) {
            SettingsView.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            'aiCompanionSettings',
            'AI Companion Settings',
            column || vscode.ViewColumn.One,
            {
                // Enable javascript in the webview
                enableScripts: true,
                // And restrict the webview to only loading content from our extension's `media` directory.
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'webview')]
            }
        );

        SettingsView.currentPanel = new SettingsView(panel, context.extensionUri, settingsManager);
    }


    public dispose() {
        SettingsView.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Local path to main script run in the webview
        const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'webview', 'settings', 'settings.js');
        const scriptUri = webview.asWebviewUri(scriptPathOnDisk);

        // Local path to css styles
        const stylePathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'webview', 'settings', 'style.css');
        const styleUri = webview.asWebviewUri(stylePathOnDisk);

        // Use a nonce to whitelist which scripts can be run
        const nonce = getNonce();

        // Read HTML file from disk
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'webview', 'settings', 'index.html');
        let htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf8');

        // Replace placeholders with real URIs
        htmlContent = htmlContent.replace('style.css', styleUri.toString());
        htmlContent = htmlContent.replace('settings.js', scriptUri.toString());

        // Inject Nonce (Safety) - If we add CSP
        // htmlContent = htmlContent.replace(/nonce-PLACEHOLDER/g, nonce);

        return htmlContent;
    }
    private async handleFetchModels(message: any, webview: vscode.Webview) {
        const { provider, apiKey, baseUrl } = message;
        let models: string[] = [];

        try {
            // 1. OpenAI
            if (provider === 'OpenAI') {
                // Construct URL diligently
                // Default: https://api.openai.com/v1/models
                // IF baseUrl is provided, use it. logic: baseUrl + /models

                let endpoint = baseUrl || 'https://api.openai.com/v1';
                // Remove trailing slash if present to avoid //models
                endpoint = endpoint.replace(/\/+$/, '');
                const url = `${endpoint}/models`;

                // Debug log
                console.log(`[SettingsView] Fetching OpenAI models from: ${url}`);

                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Example: 401 Unauthorized. Details: ${errText}`);
                }

                const data = await response.json() as any;
                if (data.data && Array.isArray(data.data)) {
                    models = data.data.map((m: any) => m.id);
                }
            }
            // 2. Gemini
            else if (provider === 'Gemini') {
                // ... (url setup)
                let endpoint = baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
                endpoint = endpoint.replace(/\/+$/, '');
                const url = `${endpoint}/models?key=${apiKey}`;

                const response = await fetch(url);
                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Gemini Error ${response.status}: ${errText}`);
                }
                const data = await response.json() as any;
                if (data.models && Array.isArray(data.models)) {
                    models = data.models.map((m: any) => m.name.replace('models/', ''));
                }
            }

            if (models.length > 0) {
                // FILTER LOGIC
                let textModels: string[] = [];
                let imageModels: string[] = [];

                // User Requested Whitelist
                // "Just include only these models... gpt-3.5, gpt-4, gpt-5 etc"
                // We match based on prefixes to accommodate version dates (e.g. gpt-4-0613) and future suffix variants.
                const ALLOWED_PREFIXES = [
                    'gpt-3.5',
                    'gpt-4',
                    'gpt-5' // Future proofing
                ];

                if (provider === 'OpenAI') {
                    // OpenAI Filtering

                    // Vision: Known vision prefixes from the allowed list
                    // (Basically just gpt-4o, gpt-4-turbo, gpt-5 variants)
                    imageModels = models.filter(id => {
                        // Must start with allowed prefix
                        if (!ALLOWED_PREFIXES.some(prefix => id.startsWith(prefix))) return false;

                        // Must be vision capable (heuristic)
                        return (id.includes('gpt-4o') || id.includes('gpt-4-turbo') || id.includes('vision') || id.includes('gpt-5'));
                    }).sort();

                    // Text: Strictly the whitelist
                    textModels = models.filter(id => {
                        // Check whitelist
                        if (!ALLOWED_PREFIXES.some(prefix => id.startsWith(prefix))) return false;

                        // Exclude specific unwanted strings if necessary, but manual list implies checking prefixes is enough.
                        // We still filter out 'vision-preview' from text to keep it clean if user didn't ask for it explicitly,
                        // but since they just gave a list, let's just stick to the allowed prefixes text.
                        // Actually, let's keep it very clean:
                        if (id.includes('vision')) return false;
                        if (id.includes('audio')) return false;

                        return true;
                    }).sort();

                } else if (provider === 'Gemini') {
                    // Gemini Filtering

                    // Simple exclusion list for Gemini (hardcoded here since helper was removed)
                    // Mainly exclude embedding keys if they appear in list
                    const isGeminiExcluded = (id: string) => id.toLowerCase().includes('embedding');

                    // Vision: Multimodal models
                    imageModels = models.filter(id => {
                        if (isGeminiExcluded(id)) return false;
                        return (id.includes('gemini') && (id.includes('1.5') || id.includes('vision')));
                    }).sort();

                    // Text: Chat models
                    textModels = models.filter(id => {
                        if (isGeminiExcluded(id)) return false;
                        return id.includes('gemini');
                    }).sort();
                } else {
                    // Fallback
                    textModels = models.sort();
                    imageModels = models.sort();
                }

                webview.postMessage({
                    command: 'updateModelList',
                    textModels,
                    imageModels
                });
                vscode.window.showInformationMessage(`Fetched models for ${provider}: ${textModels.length} Text, ${imageModels.length} Vision.`);
            } else {
                vscode.window.showWarningMessage(`No models found for ${provider}.`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to fetch models: ${error}`);
        }
    }
}


function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SettingsManager } from '../services/settings-manager';
import { STATIC_MODELS } from '../constants';

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
                        this._panel.webview.postMessage({
                            command: 'loadSettings',
                            settings
                        });
                        return;

                    case 'saveSettings':
                        await this._settingsManager.updateSettings(message.settings);
                        vscode.window.showInformationMessage('Settings saved successfully!');
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

        // Inject Models
        htmlContent = htmlContent.replace(`"{{MODELS}}"`, JSON.stringify(STATIC_MODELS));

        // Inject Nonce (Safety) - If we add CSP
        // htmlContent = htmlContent.replace(/nonce-PLACEHOLDER/g, nonce);

        return htmlContent;
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

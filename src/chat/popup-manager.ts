import * as vscode from 'vscode';
import { ChatViewProvider } from './chat-view-provider';
import { EXTENSION_NAME } from '../constants';

/**
 * PopupManager - Manages the "Detached" WebviewPanel.
 * Allows the chat to live in an editor tab or a separate window.
 */
export class PopupManager {
    private static _panel: vscode.WebviewPanel | undefined;

    public static async togglePopup(context: vscode.ExtensionContext) {
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.Active);
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            'aiCompanionChatPopup',
            'AI Companion Chat',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        // Use the centralized setup logic
        const provider = ChatViewProvider.getInstance(context);
        provider.setupWebview(this._panel.webview);

        this._panel.onDidDispose(() => {
            if (this._panel) {
                ChatViewProvider.removeWebview(this._panel.webview);
            }
            this._panel = undefined;
        });

        // Set icon
        this._panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
    }
}

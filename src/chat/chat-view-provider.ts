import * as vscode from 'vscode';
import * as path from 'path';

import { fetchFilesWebView, getHTMLBase } from '../webviewshared';
import { SettingsManager } from '../services/settings-manager';

// import output channel for logging errors
import { outputChannel } from '../logger';


import { EXTENSION_NAME, MODEL_PROVIDER_OPTIONS } from '../constants';

//CONSTANTS var
import {
    LIBRARY_FOLDER,
    CHATBOX_FOLDER,
    INDEX_HTML,
    FILES_TO_LOAD,
    LIBRARIES_TO_LOAD,
    CHAT_COMMANDS,
    ROLE,
    COMMANDS,
    WORKFLOWS
} from './chat-constants';
import { ApprovalService } from './approval-service';
import { ReviewManager } from './review-manager';


// MESSAGE LISTENER
import { chatMessageListener } from './chat-message-listener';

export class ChatViewProvider implements vscode.WebviewViewProvider {

    private static instance: ChatViewProvider;
    public static readonly viewType = EXTENSION_NAME;
    private static _view?: vscode.WebviewView;
    private static _activeWebviews = new Set<vscode.Webview>();
    private static _context: vscode.ExtensionContext;
    private static _currentSessionId?: string;

    private constructor(private context: vscode.ExtensionContext) {
        outputChannel.appendLine('ChatViewProvider initialized');
        ChatViewProvider._context = context;

        // Subscribe to global updates once
        ApprovalService.getInstance().onDidResolveApproval(({ toolCallId, approved }) => {
            this.postMessage({
                command: 'chatApprovalUpdate',
                data: { toolCallId, approved }
            });
        });

        ReviewManager.getInstance().onDidUpdateStaging((count: number) => {
            this.postMessage({
                command: 'chatStagingUpdate',
                content: { stagedFilesCount: count }
            });
        });

        SettingsManager.onDidUpdateSettings((updated) => {
            this.postMessage({ command: 'uiSettingsUpdate', ui: updated.ui });
            this.postMessage({ command: 'agentsUpdate', agents: updated.prompts || [] });
            this.postMessage({ command: 'modelsUpdate', models: updated.models, customModels: updated.customModels });
        });
    }

    public static setCurrentSessionId(id: string) {
        this._currentSessionId = id;
    }

    public static getCurrentSessionId() {
        return this._currentSessionId;
    }

    public static getInstance(context?: vscode.ExtensionContext): ChatViewProvider {
        if (!this.instance) {
            if (!context) { throw new Error('ChatViewProvider requires context on first getInstance() call.'); }
            this.instance = new ChatViewProvider(context);
        }
        return this.instance;
    }

    public static getContext() {
        return ChatViewProvider._context;
    }

    public static getView() {
        return ChatViewProvider._view;
    }

    /**
     * Broadcasts a message to all active webviews (sidebar + popups).
     */
    public postMessage(message: any) {
        const disposedWebviews: vscode.Webview[] = [];
        ChatViewProvider._activeWebviews.forEach(webview => {
            try {
                webview.postMessage(message);
            } catch (err) {
                // If it throws, the webview is likely disposed.
                disposedWebviews.push(webview);
            }
        });
        
        // Clean up disposed webviews
        disposedWebviews.forEach(wv => ChatViewProvider._activeWebviews.delete(wv));
    }

    public static removeWebview(webview: vscode.Webview) {
        this._activeWebviews.delete(webview);
    }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        ChatViewProvider._view = webviewView;
        this.setupWebview(webviewView.webview);
        
        // Remove from active list when disposed
        webviewView.onDidDispose(() => {
            ChatViewProvider._activeWebviews.delete(webviewView.webview);
            ChatViewProvider._view = undefined;
        });
    }

    public setupWebview(webview: vscode.Webview) {
        webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this.context.extensionUri,
                this.context.globalStorageUri,
                vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'chatbox'),
                vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'libraries')
            ]
        };

        let html = getHTMLBase(webview, this.context, CHATBOX_FOLDER, INDEX_HTML);

        FILES_TO_LOAD.forEach(file => {
            html = fetchFilesWebView(webview, this.context, CHATBOX_FOLDER, html, file.placeholder, file.name);
        });

        LIBRARIES_TO_LOAD.forEach(lib => {
            html = fetchFilesWebView(webview, this.context, path.join(LIBRARY_FOLDER, lib.folderName).toString(), html, lib.placeholder, lib.name);
        });

        const settingsManager = new SettingsManager(this.context);
        const settings = settingsManager.getSettings();

        const SHARED_CONSTANTS = JSON.stringify({
            CHAT_COMMANDS: CHAT_COMMANDS,
            ROLE: ROLE,
            COMMANDS: COMMANDS,
            WORKFLOWS: WORKFLOWS,
            AGENTS: settings.prompts || [],
            MODELS: settings.models,
            AVAILABLE_MODELS: MODEL_PROVIDER_OPTIONS,
            CUSTOM_MODELS: settings.customModels || [],
            PERMISSIONS: settings.permissions,
            UI: settings.ui
        });

        webview.html = html.replace(`"{{CONSTANTS}}"`, SHARED_CONSTANTS);

        // Add to active list
        ChatViewProvider._activeWebviews.add(webview);

        // Register message listener
        webview.onDidReceiveMessage(chatMessageListener);
    }
}

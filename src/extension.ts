// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';


// import output channel for logging errors
import { outputChannel } from './logger';


//CONSTANTS
import { EXTENSION_NAME } from './constants';
import { ChatViewProvider } from './chat/chat-view-provider';
import { CHAT_COMMANDS } from './chat/chat-constants';
import { chatMessageListener } from './chat/chat-message-listener';
import { SettingsManager } from './services/settings-manager';
import { SettingsView } from './settings/settings-view';
import { DiffContentProvider } from './chat/diff-content-provider';
import { ReviewManager } from './chat/review-manager';

import { ReviewCodeLensProvider, ReviewDecorationProvider } from './chat/review-codelens';
import { PopupManager } from './chat/popup-manager';
import { AgentHubView } from './agent-hub/agent-hub-view';

// editor
const editor = vscode.window.activeTextEditor;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    // 1. Initialize Logging
    // show the extension output channel
    outputChannel.show();
    outputChannel.appendLine(`Congratulations, your extension ${EXTENSION_NAME} is now active!`);

    // 2. Initialize the Webview Provider
    // The Provider now handles the Services (History/Core) internally
    const provider = ChatViewProvider.getInstance(context);

    // 3. Register the provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // 4. Register Virtual Document Provider for Diffs
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
            DiffContentProvider.scheme,
            DiffContentProvider.getInstance()
        )
    );

    // Register Load History Command
    context.subscriptions.push(
        vscode.commands.registerCommand(`${EXTENSION_NAME}.${CHAT_COMMANDS.HISTORY_LOAD}`, () => {
            const view = ChatViewProvider.getView();
            if (view) {
                chatMessageListener({ command: CHAT_COMMANDS.HISTORY_LOAD });
            }
        })
    );

    // Register New Chat Command
    context.subscriptions.push(
        vscode.commands.registerCommand(`${EXTENSION_NAME}.${CHAT_COMMANDS.CHAT_RESET}`, () => {
            // Send a signal to the Webview: "User clicked New Chat Button"
            const view = ChatViewProvider.getView();
            if (view) {
                chatMessageListener({ command: CHAT_COMMANDS.CHAT_RESET });
            }
        })
    );

    // Register UI Settings Command
    context.subscriptions.push(
        vscode.commands.registerCommand(`${EXTENSION_NAME}.updateUISettings`, (uiData) => {
            const view = ChatViewProvider.getView();
            if (view && view.webview) {
                view.webview.postMessage({
                    command: 'uiSettingsUpdate',
                    ui: uiData
                });
            }
        })
    );

    // Register Settings Command
    context.subscriptions.push(
        vscode.commands.registerCommand(`${EXTENSION_NAME}.openSettings`, () => {
            const settingsManager = new SettingsManager(context);
            SettingsView.createOrShow(context, settingsManager);
        })
    );

    // 5. Register Review Manager Commands
    const reviewManager = ReviewManager.getInstance();
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-companion.nextDiff', () => reviewManager.openNextDiff()),
        vscode.commands.registerCommand('ai-companion.prevDiff', () => reviewManager.openPrevDiff()),
        vscode.commands.registerCommand('ai-companion.acceptCurrent', () => reviewManager.commitCurrent()),
        vscode.commands.registerCommand('ai-companion.rejectCurrent', () => reviewManager.discardCurrent()),
        vscode.commands.registerCommand('ai-companion.acceptAll', () => reviewManager.commitAll()),
        vscode.commands.registerCommand('ai-companion.rejectAll', () => reviewManager.discardAll())
    );

    // 6. Direct In-File Review Features
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ scheme: 'file' }, new ReviewCodeLensProvider())
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ai-companion.toggleHunk', async (uriStr: string, index: number, accepted: boolean) => {
            reviewManager.toggleHunk(uriStr, index, accepted);
            
            // Sync with Webview
            const view = ChatViewProvider.getView();
            if (view && view.webview) {
                const hunksData = reviewManager.getHunksForAllFiles();
                view.webview.postMessage({
                    command: CHAT_COMMANDS.REVIEW_HUNKS_DATA,
                    content: hunksData
                });
            }
        })
    );

    // Update decorations when editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                ReviewDecorationProvider.updateDecorations(editor);
            }
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;
            if (editor && event.document === editor.document) {
                ReviewDecorationProvider.updateDecorations(editor);
            }
        })
    );

    if (vscode.window.activeTextEditor) {
        ReviewDecorationProvider.updateDecorations(vscode.window.activeTextEditor);
    }

    // Register Popup Toggle
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-companion.togglePopup', () => {
            PopupManager.togglePopup(context);
        })
    );

    // Register Agent Hub
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-companion.openAgentHub', () => {
            AgentHubView.createOrShow(context);
        })
    );

}


// This method is called when your extension is deactivated
export function deactivate() { }
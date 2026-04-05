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

    // Register Settings Command

    context.subscriptions.push(
        vscode.commands.registerCommand(`${EXTENSION_NAME}.openSettings`, () => {
            const settingsManager = new SettingsManager(context);
            SettingsView.createOrShow(context, settingsManager);
        })
    );

    // 5. Register Review Manager (Accept/Reject Inline Review)
    const reviewManager = ReviewManager.getInstance();
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-companion.acceptReview', (hunkId: string) => reviewManager.acceptHunk(hunkId)),
        vscode.commands.registerCommand('ai-companion.rejectReview', (hunkId: string) => reviewManager.rejectHunk(hunkId)),
        vscode.commands.registerCommand('ai-companion.acceptAll', () => reviewManager.acceptAll()),
        vscode.commands.registerCommand('ai-companion.rejectAll', () => reviewManager.rejectAll()),
        vscode.languages.registerCodeLensProvider({ scheme: 'file' }, reviewManager)
    );


}


// This method is called when your extension is deactivated
export function deactivate() { }
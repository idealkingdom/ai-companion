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
            // Initialize Settings Manager (Singleton-ish or recreate)
            // Ideally we should have a singleton or pass it around.
            // For now, new instance is cheap as it just wraps context.
            const settingsManager = new SettingsManager(context);
            SettingsView.createOrShow(context, settingsManager);
        })
    );


}


// This method is called when your extension is deactivated
export function deactivate() { }
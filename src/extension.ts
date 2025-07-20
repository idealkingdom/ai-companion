// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';


// import output channel for logging errors
import { outputChannel } from './logger';


//CONSTANTS
import { EXTENSION_NAME } from './constants';
import { ChatViewProvider } from './chat/chat-view-provider';
import { ChatHistory } from './chat/chat-history';
import { ChatCore } from './chat/chat-core';





// editor
const editor = vscode.window.activeTextEditor;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    // show the extension output channel
    outputChannel.show();

    // This line of code will only be executed once when your extension is activated
    outputChannel.appendLine(`Congratulations, your extension ${EXTENSION_NAME} is now active!`);
    // WebView Provider
    const provider = ChatViewProvider.getInstance(context);

    // Register the webview view provider for the chatbox
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider)
    );
    // Register the command to open the chat view
    context.subscriptions.push(
        vscode.commands.registerCommand(`${EXTENSION_NAME}.loadHistory`, () => {
            ChatHistory.loadHistoryToWebview();
        }));

    // Register the command to open a new tab in the chat view
    context.subscriptions.push(
        vscode.commands.registerCommand(`${EXTENSION_NAME}.resetChat`, () => {
            ChatCore.resetChat();
        })
    );


    // Register the command to open the user settings and focus on the extension settings
    context.subscriptions.push(
        vscode.commands.registerCommand(`${EXTENSION_NAME}.openSettings`, () => {
            vscode.commands.executeCommand(
                'workbench.action.openSettings',
                `@${EXTENSION_NAME}` // Focus on the AI Companion extension settings
            );
        })
    );


}


// This method is called when your extension is deactivated
export function deactivate() { }
import * as vscode from 'vscode';
import * as path from 'path';

import { fetchFilesWebView, getHTMLBase } from '../webviewshared';

// import output channel for logging errors
import { outputChannel } from '../logger';


import { EXTENSION_NAME } from '../constants';

//CONSTANTS var
import {
    LIBRARY_FOLDER,
    CHATBOX_FOLDER,
    INDEX_HTML,
    FILES_TO_LOAD,
    LIBRARIES_TO_LOAD,
    CHAT_COMMANDS,
    ROLE
    } from './chat-constants';


// MESSAGE LISTENER
import { chatMessageListener } from './chat-message-listener';

export class ChatViewProvider implements vscode.WebviewViewProvider {

    private static instance: ChatViewProvider;
    public static readonly viewType = EXTENSION_NAME;
    private static _view?: vscode.WebviewView;
    private static _context: vscode.ExtensionContext;

    private constructor(private context: vscode.ExtensionContext) {
        outputChannel.appendLine('ChatViewProvider initialized');
        ChatViewProvider._context = context;
    }

    public static getInstance(context?: vscode.ExtensionContext): ChatViewProvider {
    if (!this.instance) {
      if (!context) {throw new Error('ChatViewProvider requires context on first getInstance() call.');}
      this.instance = new ChatViewProvider(context);
    }
      return this.instance;
    }

    public static getContext(){
        return ChatViewProvider._context;
    }

    public static getView(){
        return ChatViewProvider._view;
    }
    
    public resolveWebviewView(
        webviewView: vscode.WebviewView
    ) {
        

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'chatbox'),
            vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'libraries')
            ]
        };
        // READ BASE HTML - in this case chatbox.html
        webviewView.webview.html = getHTMLBase(webviewView.webview, this.context, CHATBOX_FOLDER, INDEX_HTML);

        // Load files and parse each for needed script and style paths
        // This will replace the placeholders in the HTML with the actual paths to the files
        // For example, it will replace {{scriptPath}} with the actual path to chatbox.js
        // and {{stylePath}} with the actual path to chatbox.css
        // This is done for each file in the FILES_TO_LOAD array
        // and each library in the LIBRARIES_TO_LOAD array
        // This will allow the webview to load the necessary files and libraries
        // and display the chatbox correctly
        FILES_TO_LOAD.forEach(file => {
            webviewView.webview.html =
                fetchFilesWebView(
                    webviewView.webview,
                    this.context,
                    CHATBOX_FOLDER, // chatbox folder where the files are stored
                    webviewView.webview.html, // get the HTML base path
                    file.placeholder, // file placeholder ex: '{{scriptPath}}'
                    file.name // file name ex: 'chatbox.js'
                );
        });

        // Load libraries and parse each for needed script paths
        // This will replace the placeholders in the HTML with the actual paths to the libraries
        // For example, it will replace {{htmxSriptPath}} with the actual path to htmx.min.js
        // This is done for each library in the LIBRARIES_TO_LOAD array
        // This will allow the webview to load the necessary libraries
        LIBRARIES_TO_LOAD.forEach(lib => {
            webviewView.webview.html =
                fetchFilesWebView(
                    webviewView.webview,
                    this.context,
                    path.join(LIBRARY_FOLDER, lib.folderName).toString(), // library folder where the libraries are stored
                    webviewView.webview.html, // get the HTML base path
                    lib.placeholder, // library placeholder ex: '{{htmxSriptPath}}'
                    lib.name // library name ex: 'htmx.min.js'   
                );

        });

        // LOAD THE CONSTANTS WE CAN USE IN THE WEBVIEW
        const SHARED_CONSTANTS = JSON.stringify({
            CHAT_COMMANDS: CHAT_COMMANDS,
            ROLE: ROLE
        });
        
        // Inject the constants into the HTML by replacing the {{constants}} placeholder
        webviewView.webview.html = webviewView.webview.html.replace(`"{{CONSTANTS}}"`, SHARED_CONSTANTS);



        ChatViewProvider._view = webviewView;
        // =================================================================
        // 7. REGISTER THE LISTENER HERE 🚀
        // =================================================================
        // This tells VS Code: "When the HTML sends a message, run this function."
        webviewView.webview.onDidReceiveMessage(chatMessageListener);

    }
}

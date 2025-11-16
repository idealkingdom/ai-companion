import * as vscode from 'vscode';
import path from 'path';

import { PathLike } from "fs";
import { FileHandle, writeFile } from "fs/promises";
import { CHAT_COMMANDS, ChatMessage, HISTORY_FILENAME, ROLE } from "./chat-constants";
import { ChatViewProvider } from "./chat-view-provider";
import { ndJSONParse } from './chat-utils';
import { outputChannel } from '../logger';


export class ChatHistory  {

    private static  _chatHistoryFilePath?: PathLike | FileHandle;
    private static _chatHistory: {[chat_id:string]: { timestamp: string; role: ROLE; message: string }[]};

    private constructor(){
        ChatHistory._chatHistory = {};
    }

        // Open chat history in webview
    public static loadHistoryToWebview() {
        if (ChatViewProvider.getView()) {
            ChatViewProvider.getView()?.webview.postMessage({ command: CHAT_COMMANDS.HISTORY_LOAD , content: ChatHistory._chatHistory});
        } else {
            vscode.window.showErrorMessage('Chat view is not available.');
        }
    }

// read chat history
    public static async readChatHistory(){
        //clear chat history variable
        ChatHistory._chatHistory = {};
        try{
            // Define the path to save the chat history
            ChatHistory._chatHistoryFilePath = path.join(ChatViewProvider.getContext().globalStorageUri.fsPath, HISTORY_FILENAME);
            const historyFileUri = vscode.Uri.file(ChatHistory._chatHistoryFilePath);
            // Ensure the directory exists
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(ChatViewProvider.getContext().globalStorageUri.fsPath));

            let content = '';
            try {
                const fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(ChatHistory._chatHistoryFilePath));
                content = Buffer.from(fileData).toString('utf8');
                
            } catch (readError) {
                // If file doesn't exist, initialize empty object and create the file
                content = "";
                await vscode.workspace.fs.writeFile(historyFileUri,Buffer.from(""));
            }
            if(content){
                ChatHistory._chatHistory = ndJSONParse(content,'chat_id');
            }
        }catch(error){
            outputChannel.appendLine('Error reading file:' + error);
            vscode.window.showErrorMessage('Failed to retrieve messages');
        }finally{
            
            return ChatHistory._chatHistory;
            
        }

    }

    // GET CHAT HISTORY
    public static getChatHistory(){
        return ChatHistory._chatHistory;
    }
    
    // Save Messages to File for History Tracking
    public static async saveMessageToHistory(data:ChatMessage) {
        try {
            // exclude the chat_id from the data field
            const {chat_id, ...rest} = data;
            // Append the message to the file
            if (!ChatHistory._chatHistoryFilePath)
                {throw new Error("History File not found or exists!");}
                
            await writeFile(ChatHistory._chatHistoryFilePath, JSON.stringify(data) + '\n', { flag: 'a' });
            if (!ChatHistory._chatHistory[chat_id]) {
                ChatHistory._chatHistory[chat_id] = [];
            }
            ChatHistory._chatHistory[chat_id].push(rest);
        } catch (error) {
            outputChannel.appendLine("_saveMessageToFile " , error);
        }
    }
}
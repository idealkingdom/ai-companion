/*
This function was originally from ChatViewProvider, however for simplicity and easy to access
separated by another module.
*/
import { outputChannel } from "../logger";
import { CHAT_COMMANDS, ROLE } from "./chat-constants";
import { ChatCoreService } from "./chat-core"; // Assuming you updated this to a Service, or kept it static
import { ChatHistoryService } from "./chat-history"; // Import the NEW Service
import { ChatViewProvider } from "./chat-view-provider";
import * as vscode from 'vscode';
import * as path from 'path';
import { processBinaryFile } from "./binary-handler";


    // message sent from client js
export async function chatMessageListener(message: any) {
    
    // 1. GET DEPENDENCIES
    // We get the context from your Provider to initialize the History Service
    const context = ChatViewProvider.getContext();
    const webview = ChatViewProvider.getView()?.webview;

    if (!webview) {
        outputChannel.appendLine('Webview is missing.');
        return;
    }


    // 2. INSTANTIATE SERVICES
    // History needs storage, Core needs History.
    const historyService = new ChatHistoryService(context.globalState);
    const coreService = new ChatCoreService(historyService);

switch (message.command) {
        // --- 1. INIT ---
        case CHAT_COMMANDS.CHAT_WEBVIEW_READY:
            {
            // Now: We generate ID and send it manually, or add resetChat() to your Service.
            const newChatId = coreService.generateChatID();
            await webview.postMessage({
                command: CHAT_COMMANDS.CHAT_RESET, 
                content: { uid: newChatId } 
            });
            break;
            }
        
        case CHAT_COMMANDS.CHAT_RESET:
            {
            // Now: We generate ID and send it manually, or add resetChat() to your Service.
            const newChatId = coreService.generateChatID();
            await webview.postMessage({
                command: CHAT_COMMANDS.CHAT_RESET, 
                content: { uid: newChatId } 
            });
            break;
            }
            
        case CHAT_COMMANDS.CHAT_REQUEST:
            {
            // This handles saving User + AI msg to history internally.
            
            // FORMAT THE MESSAGE (Text + Files)
            const rawText = message.data.message;
            const files = message.data.files;
            
            // This turns the text + files into one big Markdown string
            const formattedMessage = formatMessageWithFiles(rawText, files);

            await webview.postMessage({
                command: CHAT_COMMANDS.CHAT_REQUEST, 
                content: formattedMessage, 
                role: ROLE.USER
            });

            // We replace the original message data with our new formatted one
            const aiData = { 
                ...message.data, 
                message: formattedMessage, // <--- Pass the FULL content
                files: [] // Clear files so Core doesn't double-append them
            };

            const aiResponse = await coreService.processChatRequest(aiData);
            webview.postMessage({
                command: CHAT_COMMANDS.CHAT_REQUEST, 
                content: aiResponse,
                role: ROLE.BOT
            });
            break;
            }
        // --- HISTORY: SHOW LIST ---
        case CHAT_COMMANDS.HISTORY_LOAD:
            {
            const historyData = historyService.getFormattedHistoryGroups();
            await webview.postMessage({
                command: CHAT_COMMANDS.HISTORY_LOAD,
                content: historyData
            });
            break;
            }
        // --- HISTORY: LOAD SPECIFIC CHAT ---
        case CHAT_COMMANDS.CHAT_LOAD:
            {
            const targetId = message.data.chatId;
            const conversation = historyService.getConversation(targetId);

            if (conversation) {
                // A. Reset UI with the old ID
                await webview.postMessage({
                    command: CHAT_COMMANDS.CHAT_RESET,
                    content: { uid: conversation.chat_id }
                });

                // B. Restore Messages
                // We loop through the stored messages and send them to the UI
                for (const msg of conversation.messages) {
                    // We use the existing 'chatRequest' command but add the 'role'
                    // so the frontend knows if it's USER or BOT.
                    await webview.postMessage({
                        command: CHAT_COMMANDS.CHAT_REQUEST,
                        content: msg.message,
                        role: msg.role === ROLE.USER ? ROLE.USER : ROLE.BOT
                    });
                }
            }
            break;
            }
            // --- CLEAR HISTORY ---
        case CHAT_COMMANDS.HISTORY_CLEAR:
            {
            await historyService.clear();
            await webview.postMessage({
                command: CHAT_COMMANDS.HISTORY_LOAD,
                content: []
            });
            break;
            }

        case CHAT_COMMANDS.CONVERSATION_DELETE:
            {
            const targetId = message.data.chatId;
            await historyService.deleteConversation(targetId);
            break;
            }
        
        case CHAT_COMMANDS.ADD_CONTEXT:
            {
                const editor = vscode.window.activeTextEditor;
                const type = message.data.type;

                if (type === 'currentFile') {
                    if (!editor) {
                        // No file is open
                        await webview.postMessage({
                            command: 'error',
                            content: 'No active text editor found.'
                        });
                        return;
                    }

                    const document = editor.document;
                    const fileName = document.fileName.split(/[\\/]/).pop(); // Get just "script.js"
                    const fileContent = document.getText();
                    const languageId = document.languageId;

                    // Send back to Frontend to "attach" it
                    await webview.postMessage({
                        command: 'fileContextAdded', // We reuse your existing listener logic
                        content: {
                            name: fileName,
                            text: fileContent,
                            language: languageId,
                            type: 'file'
                        }
                    });

                }
                // --- B. ACTIVE SELECTION ---
                else if (type === 'selection') {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        vscode.window.showWarningMessage("No active editor found.");
                        return;
                    }

                    const selection = editor.selection;
                    const text = editor.document.getText(selection);

                    if (!text) {
                        vscode.window.showInformationMessage("No text selected.");
                        return;
                    }

                    // We create a "virtual" filename for the selection
                    const fileName = path.basename(editor.document.fileName);
                    
                    await webview.postMessage({
                        command: 'fileContextAdded',
                        content: {
                            name: `Selection (${fileName})`, // e.g. "Selection (script.ts)"
                            text: text,
                            language: editor.document.languageId
                        }
                    });
                }
                // --- C. PICK FILE (Native Dialog) ---
                else if (type === 'pickFile') {
                    // Open the native OS file picker
                    const uris = await vscode.window.showOpenDialog({
                        canSelectMany: true,
                        openLabel: 'Attach',
                        title: 'Select files to attach to chat'
                    });

                    if (uris && uris.length > 0) {
                        // Loop through all selected files
                        for (const uri of uris) {
                            try {
                                const fileName = path.basename(uri.fsPath);
                                const fileExt = fileName.split('.').pop()?.toLowerCase();
                                
                                let fileContent = "";
                                let language = "";

                                // --- A. CHECK FOR BINARIES ---
                                if (fileExt === 'pdf') {
                                    // Use our new binary handler
                                    const extractedText = await processBinaryFile(uri);
                                    if (extractedText) {
                                        fileContent = extractedText;
                                        language = "markdown"; // PDFs are just text, MD is a safe fallback
                                    }
                                } 
                                // --- B. CHECK FOR IMAGES (If you want to handle them as context) ---
                                else if (['png', 'jpg', 'jpeg', 'gif'].includes(fileExt || '')) {
                                     // For images, we usually don't extract text unless using OCR.
                                     // Ideally, you would push this to the 'images' array instead of 'files'.
                                     vscode.window.showInformationMessage("Image attachment via file picker is not yet supported. Use Copy/Paste.");
                                     continue;
                                }
                                // --- C. DEFAULT: TEXT FILES ---
                                else {
                                    const doc = await vscode.workspace.openTextDocument(uri);
                                    fileContent = doc.getText();
                                    language = doc.languageId;
                                }

                                // Send result to frontend
                                await webview.postMessage({
                                    command: 'fileContextAdded',
                                    content: {
                                        name: fileName,
                                        text: fileContent,
                                        language: language
                                    }
                                });

                            } catch (error) {
                                console.error(`Failed to read file: ${uri.fsPath}`, error);
                                vscode.window.showErrorMessage(`Failed to attach ${path.basename(uri.fsPath)}`);
                            }
                        }
                    }
                }

                break;

            }
            


        // Handle other messages here
        default:
            outputChannel.appendLine('Unknown message received:' + message);
    }


 function formatMessageWithFiles(originalMessage: string, files: any[]): string {
    let fullMessage = originalMessage;

    if (files && Array.isArray(files) && files.length > 0) {
        fullMessage += "\n\n--- ATTACHED CONTEXT ---\n";
        
        files.forEach((file: any) => {
            fullMessage += `\nFile: ${file.name}\n`;
            // Wrap content in Markdown code blocks
            fullMessage += "```" + (file.language || '') + "\n";
            fullMessage += (file.content || '') + "\n"; 
            fullMessage += "```\n";
        });
    }
    return fullMessage;
}
};
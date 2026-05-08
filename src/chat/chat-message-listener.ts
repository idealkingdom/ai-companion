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
import { ImageStorageService } from "./image-storage";
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { SettingsManager } from '../services/settings-manager';
import { ApprovalService } from "./approval-service";

import { ReviewManager } from "./review-manager";
import { PopupManager } from "./popup-manager";

// For Handshake/Syncing
const chunkAcks = new Map<string, (val: any) => void>();
let nextSeq = 0;

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


    const imageService = new ImageStorageService(context);
    const settingsManager = new SettingsManager(context);

    // const historyService = new ChatHistoryService(context.globalState, imageService);
    // Note: ChatHistoryService also needs context.globalState. It seems okay.
    const historyService = new ChatHistoryService(context.globalState, imageService);

    const coreService = new ChatCoreService(historyService, imageService, settingsManager);

    switch (message.command) {
        // --- 1. INIT ---
        case CHAT_COMMANDS.CHAT_WEBVIEW_READY:
            {
                const existingId = ChatViewProvider.getCurrentSessionId();
                if (existingId) {
                    // REHYDRATE
                    const conversation = historyService.getConversation(existingId);
                    if (conversation) {
                        await ChatViewProvider.getInstance().postMessage({
                            command: CHAT_COMMANDS.CHAT_STATE_REHYDRATE,
                            content: {
                                chatId: existingId,
                                messages: conversation.messages,
                                stagedFilesCount: ReviewManager.getInstance().getStagedUris().length,
                                agentId: conversation.agentId
                            }
                        });
                        return;
                    }
                }

                // NEW CHAT
                const newChatId = coreService.generateChatID();
                ChatViewProvider.setCurrentSessionId(newChatId);
                await ChatViewProvider.getInstance().postMessage({
                    command: CHAT_COMMANDS.CHAT_RESET,
                    content: { uid: newChatId }
                });

                // Sync the initial staging state
                const count = ReviewManager.getInstance().getStagedUris().length;
                await ChatViewProvider.getInstance().postMessage({
                    command: 'chatStagingUpdate',
                    content: { stagedFilesCount: count }
                });

                // Send initial workspace index stats
                try {
                    const { WorkspaceIndexService } = require('../services/workspace-index');
                    const wsIndex = new WorkspaceIndexService();
                    await wsIndex.refresh();
                    const fileCount = wsIndex.getFileList().length;
                    await ChatViewProvider.getInstance().postMessage({
                        command: 'indexUpdate',
                        content: { fileCount, lastUpdated: new Date().toISOString() }
                    });
                    wsIndex.dispose();
                } catch (e) {
                    outputChannel.appendLine(`[Index] Initial index failed: ${e}`);
                }
                break;
            }
        case 'searchWorkspaceFiles':
            {
                const query = message.data.query || '';
                
                const workspaceFiles = await vscode.workspace.findFiles(
                    '**/*',
                    '{**/node_modules/**,**/dist/**,**/build/**,**/.git/**,**/out/**,**/.vscode/**}'
                );

                const results = workspaceFiles
                    .map(uri => vscode.workspace.asRelativePath(uri))
                    .filter(p => p.toLowerCase().includes(query.toLowerCase()))
                    .slice(0, 25)
                    .map(p => ({
                        label: p.split(/[\\/]/).pop() || p,
                        description: p,
                        path: p
                    }));

                await ChatViewProvider.getInstance().postMessage({
                    command: 'searchFilesResult',
                    query: query,
                    results: results
                });
                break;
            }
        case 'saveSettings':

        case 'updateNestedSetting': {
            const { category, key, value } = message.data;
            const currentSettings = settingsManager.getSettings();
            if (currentSettings[category as keyof typeof currentSettings]) {
                (currentSettings[category as keyof typeof currentSettings] as any)[key] = value;
                await settingsManager.updateSettings({ [category]: currentSettings[category as keyof typeof currentSettings] });
            }
            break;
        }

        case 'updateCategorySettings': {
            const { category, settings } = message.data;
            const currentSettings = settingsManager.getSettings();
            if (currentSettings[category as keyof typeof currentSettings]) {
                const updatedCategory = { ...currentSettings[category as keyof typeof currentSettings], ...settings };
                await settingsManager.updateSettings({ [category]: updatedCategory });
            }
            break;
        }

        // Pull-based model refresh: chatbox requests fresh model data (e.g. when dropdown opens)
        case 'requestModels': {
            const { getModelProviderOptions } = require('../constants');
            const latestSettings = settingsManager.getSettings();
            await ChatViewProvider.getInstance().postMessage({
                command: 'modelsUpdate',
                models: latestSettings.models,
                customModels: latestSettings.customModels,
                availableModels: getModelProviderOptions()
            });
            break;
        }

        // #46: Scrape a URL and return content to the frontend
        case 'scrapeUrl': {
            const { WebScraperService } = require('../services/web-scraper');
            const scraper = new WebScraperService();
            const url = message.url;
            try {
                const result = await scraper.scrape(url);
                await ChatViewProvider.getInstance().postMessage({
                    command: 'scrapeResult',
                    url: url,
                    success: result.success,
                    title: result.title,
                    content: result.content?.substring(0, 8000) || '',
                    wordCount: result.wordCount,
                    error: result.error
                });
            } catch (err: any) {
                await ChatViewProvider.getInstance().postMessage({
                    command: 'scrapeResult',
                    url: url,
                    success: false,
                    error: err.message || 'Scraping failed'
                });
            }
            break;
        }

        case CHAT_COMMANDS.CHAT_RESET:
            {
                // Now: We generate ID and send it manually, or add resetChat() to your Service.
                const newChatId = coreService.generateChatID();
                await ChatViewProvider.getInstance().postMessage({
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
                const images = message.data.images;
                const agentId = message.data.agentId;
                // This turns the text + files into one big Markdown string
                const formattedMessage = formatMessageWithFiles(rawText, files);

                await ChatViewProvider.getInstance().postMessage({
                    command: CHAT_COMMANDS.CHAT_REQUEST,
                    content: formattedMessage,
                    images: images,
                    files: files,
                    role: ROLE.USER
                });

                // We replace the original message data with our new formatted one
                const aiData = {
                    ...message.data,
                    message: formattedMessage, // <--- Pass the FULL content
                    agentId: agentId,          // <--- Pass the agent mode
                    files: [] // Clear files so Core doesn't double-append them
                };

                let chatId = aiData.chat_id;
                if (!chatId || chatId === "") {
                    chatId = coreService.generateChatID();
                    // Update webview with the new ID so future cancellations/messages use it
                    await ChatViewProvider.getInstance().postMessage({
                        command: CHAT_COMMANDS.CHAT_ID_UPDATE,
                        content: { uid: chatId }
                    });
                    // Update the data object we pass to the core service
                    aiData.chat_id = chatId;
                }

                ChatViewProvider.getInstance().postMessage({ command: CHAT_COMMANDS.CHAT_STREAM_START });

                const { text: aiResponse, usage } = await coreService.processChatRequest(
                    aiData,
                    // onChunk — stream text to frontend
                    async (chunk) => {
                        const seq = ++nextSeq;
                        const ackPromise = new Promise(resolve => {
                            chunkAcks.set(seq.toString(), resolve);
                        });

                        await ChatViewProvider.getInstance().postMessage({
                            command: CHAT_COMMANDS.CHAT_STREAM_CHUNK,
                            content: chunk,
                            seq: seq
                        });

                        // Wait for webview to acknowledge receipt before sending next chunk
                        // This ensures backend and UI are perfectly synced for cancellation
                        await ackPromise;
                    },
                    // onAgentStep — stream tool telemetry to frontend
                    async (step) => {
                        await ChatViewProvider.getInstance().postMessage({
                            command: CHAT_COMMANDS.CHAT_AGENT_STEP,
                            content: step
                        });
                    }
                );

                if (usage) {
                    ChatViewProvider.getInstance().postMessage({
                        command: CHAT_COMMANDS.CHAT_USAGE_UPDATE,
                        usage: usage
                    });
                }

                ChatViewProvider.getInstance().postMessage({
                    command: CHAT_COMMANDS.CHAT_STREAM_END,
                    content: aiResponse,
                    role: ROLE.BOT
                });
                break;
            }

        case CHAT_COMMANDS.CHAT_RETRY:
            {
                const chatId = message.data.chat_id;
                const deleteCount = message.data.count ?? 2;
                const overrideMessage = message.data.overrideMessage ?? null;
                const retryAgentId = message.data.agentId || null;

                // 1. Delete messages from history, get the original user text back
                const lastUserMessage = await historyService.deleteLastMessages(chatId, deleteCount);
                const messageToSend = overrideMessage || lastUserMessage;
                if (!messageToSend) {
                    // No message recovered — cancel the loading state cleanly
                    ChatViewProvider.getInstance().postMessage({
                        command: CHAT_COMMANDS.CHAT_STREAM_END,
                        content: '',
                        role: ROLE.BOT
                    });
                    break;
                }

                // 2. Re-stream using recovered or overridden message
                const retryData = {
                    message: messageToSend,
                    chat_id: chatId,
                    agentId: retryAgentId,
                    timestamp: new Date().toISOString(),
                    files: [],
                    images: []
                };

                ChatViewProvider.getInstance().postMessage({ command: CHAT_COMMANDS.CHAT_STREAM_START });

                try {
                    const { text: aiResponse, usage } = await coreService.processChatRequest(
                        retryData, 
                        async (chunk) => {
                            await ChatViewProvider.getInstance().postMessage({
                                command: CHAT_COMMANDS.CHAT_STREAM_CHUNK,
                                content: chunk
                            });
                        },
                        async (step) => {
                            await ChatViewProvider.getInstance().postMessage({
                                command: CHAT_COMMANDS.CHAT_AGENT_STEP,
                                content: step
                            });
                        }
                    );

                    if (usage) {
                        ChatViewProvider.getInstance().postMessage({
                            command: CHAT_COMMANDS.CHAT_USAGE_UPDATE,
                            usage: usage
                        });
                    }

                    ChatViewProvider.getInstance().postMessage({
                        command: CHAT_COMMANDS.CHAT_STREAM_END,
                        content: aiResponse,
                        role: ROLE.BOT
                    });
                } catch (retryError: any) {
                    outputChannel.appendLine(`[Retry] Error: ${retryError?.message || retryError}`);
                    ChatViewProvider.getInstance().postMessage({
                        command: CHAT_COMMANDS.CHAT_STREAM_END,
                        content: `Error: ${retryError?.message || 'Retry failed'}`,
                        role: ROLE.BOT
                    });
                }
                break;
            }

        // --- HISTORY: SHOW LIST ---
        case CHAT_COMMANDS.HISTORY_LOAD:
            {
                const historyData = historyService.getFormattedHistoryGroups();
                await ChatViewProvider.getInstance().postMessage({
                    command: CHAT_COMMANDS.HISTORY_LOAD,
                    content: historyData
                });
                break;
            }

        case CHAT_COMMANDS.CHAT_CHUNK_ACK:
            {
                const seq = message.seq?.toString();
                if (seq && chunkAcks.has(seq)) {
                    const resolver = chunkAcks.get(seq);
                    if (resolver) { resolver(true); }
                    chunkAcks.delete(seq);
                }
                break;
            }

        case 'cancelChatRequest':
            {
                const chatId = message.data.chat_id;
                outputChannel.appendLine(`[Cancel] Received cancelChatRequest for chatId=${chatId}`);
                if (chatId) {
                    // 1. Abort the backend stream
                    const cancelled = coreService.cancelChatRequest(chatId);
                    outputChannel.appendLine(`[Cancel] AbortController found and aborted: ${cancelled}`);

                    // 2. Flush all pending chunk ACKs to unblock the backend
                    //    (the backend is waiting for ACKs that will never come because the UI stopped)
                    for (const [seq, resolver] of chunkAcks.entries()) {
                        resolver(false);
                    }
                    chunkAcks.clear();
                    outputChannel.appendLine(`[Cancel] Flushed all pending chunk ACKs`);
                }
                break;
            }

        // --- HISTORY: LOAD SPECIFIC CHAT ---
        case CHAT_COMMANDS.CHAT_LOAD:
            {
                const targetId = message.data.chatId;
                const conversation = historyService.getConversation(targetId);

                if (conversation) {
                    ChatViewProvider.setCurrentSessionId(targetId);
                    // A. Reset UI with the old ID
                    await ChatViewProvider.getInstance().postMessage({
                        command: CHAT_COMMANDS.CHAT_RESET,
                        content: { 
                            uid: conversation.chat_id,
                            agentId: conversation.agentId
                        }
                    });

                    // B. Restore Messages
                    // We loop through the stored messages and send them to the UI
                    for (const msg of conversation.messages) {
                        // We use the existing 'chatRequest' command but add the 'role'
                        // so the frontend knows if it's USER or BOT.

                        // RESOLVE IMAGES: Convert "img_123.png" -> "vscode-resource://..."
                        // #63: Extract original display names from message text (e.g. "[Pasted Image 2]")
                        let displayImages: any[] = [];
                        if (msg.images && msg.images.length > 0) {
                            // Extract image names from message text by finding [Bracketed Names]
                            const namePattern = /\[(Pasted Image[^\]]*|Image[^\]]*)\]/g;
                            const messageNames: string[] = [];
                            let match;
                            while ((match = namePattern.exec(msg.message)) !== null) {
                                messageNames.push(match[1]);
                            }

                            displayImages = msg.images.map((fileName, idx) => ({
                                name: messageNames[idx] || `Image ${idx + 1}`,
                                dataUrl: imageService.getWebviewUri(fileName, webview),
                                path: imageService.getImagePath(fileName).fsPath // <--- Send REAL path
                            }));
                        }



                        await ChatViewProvider.getInstance().postMessage({
                            command: CHAT_COMMANDS.CHAT_REQUEST,
                            content: msg.message,
                            images: displayImages,
                            role: msg.role === ROLE.USER ? ROLE.USER : ROLE.BOT,
                            isHistory: true, // TODO flag to avoid saving again
                            agentSteps: msg.agentSteps // <--- Restore agent steps
                        });
                    }
                }
                break;
            }
        // --- CLEAR HISTORY ---
        case CHAT_COMMANDS.HISTORY_CLEAR:
            {
                await historyService.clear();
                await ChatViewProvider.getInstance().postMessage({
                    command: CHAT_COMMANDS.HISTORY_LOAD,
                    content: []
                });
                break;
            }

        case CHAT_COMMANDS.CONVERSATION_DELETE:
            {
                const targetId = message.data.chatId;
                await historyService.deleteConversation(targetId);
                await historyService.deleteConversation(targetId);
                break;
            }

        case CHAT_COMMANDS.OPEN_IMAGE:
            {
                const data = message.data.path; // Can be path OR base64
                if (!data) { return; }

                let uri: vscode.Uri;

                // Check if it's Base64
                if (data.startsWith('data:')) {
                    try {
                        // 1. Parse Base64
                        const matches = data.match(/^data:image\/([a-z]+);base64,(.+)$/);
                        const ext = matches ? matches[1] : 'png';
                        const rawData = matches ? matches[2] : data;
                        const buffer = Buffer.from(rawData, 'base64');

                        // 2. Generate Hash for Deduplication
                        const hash = crypto.createHash('md5').update(buffer).digest('hex');
                        const fileName = `vscode_ai_preview_${hash}.${ext}`;
                        const tempPath = path.join(os.tmpdir(), fileName);

                        // 3. Write only if not exists (Cache!)
                        if (!fs.existsSync(tempPath)) {
                            await fs.promises.writeFile(tempPath, buffer);
                        }

                        uri = vscode.Uri.file(tempPath);

                    } catch (e) {
                        console.error("Preview Error:", e);
                        vscode.window.showErrorMessage("Failed to open image preview.");
                        return;
                    }
                } else {
                    // It's a normal path
                    uri = vscode.Uri.file(data);
                }

                // Execute VS Code's native open command
                vscode.commands.executeCommand('vscode.open', uri);
                break;
            }

        case 'openFile':
            {
                const path = message.data.path;
                if (!path) { return; }
                const uri = vscode.Uri.file(path);
                vscode.commands.executeCommand('vscode.open', uri);
                break;
            }

        case 'openVirtualFile':
            {
                const { name, text, language } = message.data;
                if (!text) { return; }
                vscode.workspace.openTextDocument({
                    content: text,
                    language: language || 'markdown'
                }).then(doc => {
                    vscode.window.showTextDocument(doc, { preview: true });
                });
                break;
            }
        case 'addFileByPath':
            {
                const relativePath = message.data.path;
                if (!relativePath) { break; }
                
                try {
                    // Locate absolute file path via workspace findFiles
                    const files = await vscode.workspace.findFiles(relativePath, '{**/node_modules/**,**/dist/**,**/build/**,**/.git/**}');
                    if (files.length === 0) {
                        vscode.window.showErrorMessage(`File not found: ${relativePath}`);
                        break;
                    }

                    const document = await vscode.workspace.openTextDocument(files[0]);
                    const fileName = document.fileName.split(/[\\/]/).pop();
                    const fileContent = document.getText();
                    const languageId = document.languageId;

                    await ChatViewProvider.getInstance().postMessage({
                        command: 'fileContextAdded',
                        content: {
                            name: fileName,
                            text: fileContent,
                            language: languageId,
                            type: 'file',
                            path: document.uri.fsPath
                        }
                    });
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed to read file context: ${relativePath}`);
                }
                break;
            }
        case CHAT_COMMANDS.ADD_CONTEXT:
            {
                const editor = vscode.window.activeTextEditor;
                const type = message.data.type;

                if (type === 'currentFile') {
                    if (!editor) {
                        // No file is open
                        await ChatViewProvider.getInstance().postMessage({
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
                    await ChatViewProvider.getInstance().postMessage({
                        command: 'fileContextAdded', // We reuse your existing listener logic
                        content: {
                            name: fileName,
                            text: fileContent,
                            language: languageId,
                            type: 'file',
                            path: document.uri.fsPath
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

                    await ChatViewProvider.getInstance().postMessage({
                        command: 'fileContextAdded',
                        content: {
                            name: `Selection (${fileName})`, // e.g. "Selection (script.ts)"
                            text: text,
                            language: editor.document.languageId,
                            path: editor.document.uri.fsPath
                        }
                    });
                }
                // --- C. PICK FILE (Workspace File Picker) ---
                else if (type === 'pickFile') {
                    // Fetch all files in the workspace excluding common hidden/build folders
                    const files = await vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/dist/**,**/build/**,**/.git/**}');
                    const quickPickItems = files.map(uri => ({
                        label: vscode.workspace.asRelativePath(uri),
                        description: path.basename(uri.fsPath),
                        uri: uri
                    }));

                    const selectedItems = await vscode.window.showQuickPick(quickPickItems, {
                        canPickMany: true,
                        placeHolder: 'Select workspace files to attach (multi-select allowed)',
                        matchOnDescription: true,
                        title: 'Select files to attach to chat'
                    });

                    if (selectedItems && selectedItems.length > 0) {
                        const uris = selectedItems.map(item => item.uri);
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
                                // --- B. CHECK FOR IMAGES (Supported Now) ---
                                else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(fileExt || '')) {
                                    // Read file as Buffer
                                    const fileData = await vscode.workspace.fs.readFile(uri);
                                    const base64 = Buffer.from(fileData).toString('base64');
                                    // mime type (simple check)
                                    const mime = fileExt === 'jpg' ? 'jpeg' : fileExt;
                                    const dataUrl = `data:image/${mime};base64,${base64}`;

                                    // Send to Frontend
                                    await ChatViewProvider.getInstance().postMessage({
                                        command: CHAT_COMMANDS.IMAGE_CONTEXT_ADDED,
                                        content: {
                                            name: fileName,
                                            dataUrl: dataUrl
                                        }
                                    });
                                    continue; // Skip the text file handling
                                }
                                // --- C. DEFAULT: TEXT FILES ---
                                else {
                                    const doc = await vscode.workspace.openTextDocument(uri);
                                    fileContent = doc.getText();
                                    language = doc.languageId;
                                }

                                // Send result to frontend
                                await ChatViewProvider.getInstance().postMessage({
                                    command: 'fileContextAdded',
                                    content: {
                                        name: fileName,
                                        text: fileContent,
                                        language: language,
                                        path: uri.fsPath
                                    }
                                });

                            } catch (error) {
                                console.error(`Failed to read file: ${uri.fsPath}`, error);
                                vscode.window.showErrorMessage(`Failed to attach ${path.basename(uri.fsPath)}`);
                            }
                        }
                    }
                }

                // --- D. PROBLEMS ---
                else if (type === 'problems') {
                    const diagnostics = vscode.languages.getDiagnostics();
                    let problemsText = "";

                    for (const [uri, problems] of diagnostics) {
                        if (problems.length === 0) { continue; }

                        const relativePath = vscode.workspace.asRelativePath(uri);
                        problemsText += `File: ${relativePath}\n`;

                        problems.forEach(p => {
                            problemsText += `  - [${vscode.DiagnosticSeverity[p.severity]}] Line ${p.range.start.line + 1}: ${p.message}\n`;
                        });
                        problemsText += "\n";
                    }

                    if (!problemsText) {
                        problemsText = "No problems found in the workspace.";
                    }

                    // Send back to frontend
                    await ChatViewProvider.getInstance().postMessage({
                        command: CHAT_COMMANDS.PROBLEM_CONTEXT_ADDED,
                        content: {
                            name: "Workspace Problems",
                            text: problemsText,
                            language: "markdown", // It's a text summary
                            type: 'problems',
                            path: null
                        }
                    });
                }
                // --- E. WORKSPACE ---
                else if (type === 'workspace') {
                    const workspaceFiles = await vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/dist/**,**/build/**,**/.git/**}');
                    
                    if (workspaceFiles.length === 0) {
                        await ChatViewProvider.getInstance().postMessage({
                            command: 'fileContextAdded',
                            content: {
                                name: "Workspace",
                                text: "No files found in the current workspace.",
                                language: "markdown",
                                type: 'workspace'
                            }
                        });
                        return;
                    }

                    // Build a tree representation
                    // We sort by file path to group folder contents together
                    const paths = workspaceFiles.map(uri => vscode.workspace.asRelativePath(uri)).sort();
                    
                    let treeOutput = "Project File Tree:\n";
                    let currentPathParts: string[] = [];
                    
                    for (const p of paths) {
                        const parts = p.split(/[\\/]/);
                        const fileName = parts.pop();
                        
                        // Find common prefix length with previous path
                        let commonLen = 0;
                        while (commonLen < parts.length && commonLen < currentPathParts.length && parts[commonLen] === currentPathParts[commonLen]) {
                            commonLen++;
                        }
                        
                        // Print new directories
                        for (let i = commonLen; i < parts.length; i++) {
                            treeOutput += '  '.repeat(i) + '📁 ' + parts[i] + '/\n';
                        }
                        
                        // Print file
                        treeOutput += '  '.repeat(parts.length) + '📄 ' + fileName + '\n';
                        
                        currentPathParts = parts;
                    }

                    await ChatViewProvider.getInstance().postMessage({
                        command: 'fileContextAdded',
                        content: {
                            name: "Workspace",
                            text: treeOutput,
                            language: "markdown",
                            type: 'workspace',
                            path: null
                        }
                    });
                }

                break;
            }

        case 'chatToolApproval':
            {
                const { toolCallId, approved } = message.data;
                if (approved) {
                    await ReviewManager.getInstance().commitAll();
                } else {
                    ReviewManager.getInstance().discardAll();
                }
                ApprovalService.getInstance().resolveApproval(toolCallId, approved);
                break;
            }

        case 'chatReviewDiff':
            {
                const { toolCallId, toolName, args } = message.data;
                outputChannel.appendLine(`Received chatReviewDiff for tool: ${toolName}`);
                // Re-reveal the existing review
                await handleInlineReview(toolCallId, toolName, args);
                break;
            }

        case CHAT_COMMANDS.CHAT_REVIEW_HUNKS:
            {
                const reviewManager = ReviewManager.getInstance();
                const count = reviewManager.getTotalPendingCount();
                
                if (count === 0) {
                    vscode.window.showInformationMessage('No pending changes to review.');
                } else {
                    const uris = reviewManager.getStagedUris();
                    const filesData = uris.map(uri => {
                        const edits = reviewManager.getPendingEdits(uri.toString()) || [];
                        return {
                            fileName: path.basename(uri.fsPath),
                            uri: uri.toString(),
                            isNewFile: false,
                            hunks: edits.map(e => ({ accepted: true })) // Dummy hunks just for the count
                        };
                    });

                    await ChatViewProvider.getInstance().postMessage({
                        command: CHAT_COMMANDS.REVIEW_HUNKS_DATA,
                        content: filesData
                    });
                }
                break;
            }

        case CHAT_COMMANDS.COMMIT_SELECTED_HUNKS:
            {
                const { action } = message.data;
                outputChannel.appendLine(`[Review] Action: ${action}`);
                
                if (action === 'discard') {
                    await ReviewManager.getInstance().discardAll();
                    vscode.window.showInformationMessage('All changes reverted.');
                } else if (action === 'commit') {
                    await ReviewManager.getInstance().commitAll();
                    vscode.window.showInformationMessage('All changes accepted.');
                }
                
                // Notify webview
                await ChatViewProvider.getInstance().postMessage({
                    command: CHAT_COMMANDS.REVIEW_HUNKS_DATA,
                    content: []
                });
                break;
            }

        case 'acceptFile':
            {
                const { uri } = message.data;
                const fileUri = vscode.Uri.parse(uri);
                const reviewManager = ReviewManager.getInstance();
                reviewManager.acceptAllForFile(fileUri.toString());
                vscode.window.showInformationMessage('Changes accepted in ' + path.basename(fileUri.fsPath));
                
                // Update the review window
                const count = reviewManager.getTotalPendingCount();
                if (count === 0) {
                    await ChatViewProvider.getInstance().postMessage({ command: CHAT_COMMANDS.REVIEW_HUNKS_DATA, content: [] });
                } else {
                    const uris = reviewManager.getStagedUris();
                    const filesData = uris.map(u => ({
                        fileName: path.basename(u.fsPath),
                        uri: u.toString(),
                        isNewFile: false,
                        hunks: (reviewManager.getPendingEdits(u.toString()) || []).map(e => ({ accepted: true }))
                    }));
                    await ChatViewProvider.getInstance().postMessage({ command: CHAT_COMMANDS.REVIEW_HUNKS_DATA, content: filesData });
                }
                break;
            }
        
        case 'rejectFile':
            {
                const { uri } = message.data;
                const fileUri = vscode.Uri.parse(uri);
                const reviewManager = ReviewManager.getInstance();
                await reviewManager.revertAllForFile(fileUri.toString());
                vscode.window.showInformationMessage('Changes reverted in ' + path.basename(fileUri.fsPath));
                
                // Update the review window
                const count = reviewManager.getTotalPendingCount();
                if (count === 0) {
                    await ChatViewProvider.getInstance().postMessage({ command: CHAT_COMMANDS.REVIEW_HUNKS_DATA, content: [] });
                } else {
                    const uris = reviewManager.getStagedUris();
                    const filesData = uris.map(u => ({
                        fileName: path.basename(u.fsPath),
                        uri: u.toString(),
                        isNewFile: false,
                        hunks: (reviewManager.getPendingEdits(u.toString()) || []).map(e => ({ accepted: true }))
                    }));
                    await ChatViewProvider.getInstance().postMessage({ command: CHAT_COMMANDS.REVIEW_HUNKS_DATA, content: filesData });
                }
                break;
            }

        case CHAT_COMMANDS.CHAT_TOGGLE_HUNK:
            {
                // Legacy — no-op in direct-write model
                break;
            }

        case CHAT_COMMANDS.CHAT_OPEN_FILE:
            {
                const { uri } = message.data;
                let fileUri: vscode.Uri;

                // Handle both full URIs (file:///...) and relative workspace paths
                if (uri.startsWith('file:') || uri.startsWith('/') || /^[a-zA-Z]:/.test(uri)) {
                    fileUri = uri.startsWith('file:') ? vscode.Uri.parse(uri) : vscode.Uri.file(uri);
                } else {
                    // Relative path — resolve against workspace root
                    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
                    fileUri = vscode.Uri.file(path.join(workspaceRoot, uri));
                }
                
                // #43: Just open the file — CodeLens + Decorations handle the review inline
                await vscode.window.showTextDocument(fileUri);
                break;
            }

        case CHAT_COMMANDS.CHAT_CHUNK_ACK:
            {
                const seq = message.data.seq;
                const resolver = chunkAcks.get(seq.toString());
                if (resolver) {
                    resolver(true);
                    chunkAcks.delete(seq.toString());
                }
                break;
            }

        case 'refreshIndex':
            {
                const { WorkspaceIndexService } = require('../services/workspace-index');
                const wsIndex = new WorkspaceIndexService();
                await wsIndex.refresh();
                const fileCount = wsIndex.getFileList().length;
                const fileList = wsIndex.getFileList();
                outputChannel.appendLine(`[Index] Manual refresh: ${fileCount} files indexed.`);
                
                await ChatViewProvider.getInstance().postMessage({
                    command: 'indexUpdate',
                    content: { fileCount, lastUpdated: new Date().toISOString(), fileList }
                });
                
                vscode.window.showInformationMessage(`Workspace index refreshed: ${fileCount} files indexed.`);
                wsIndex.dispose();
                break;
            }

        case 'viewIndex':
            {
                const { WorkspaceIndexService } = require('../services/workspace-index');
                const wsIndex = new WorkspaceIndexService();
                await wsIndex.refresh();
                const fileCount = wsIndex.getFileList().length;
                const fileList = wsIndex.getFileList();

                await ChatViewProvider.getInstance().postMessage({
                    command: 'indexUpdate',
                    content: { fileCount, lastUpdated: new Date().toISOString(), fileList, showViewer: true }
                });
                wsIndex.dispose();
                break;
            }

        // Handle other messages here
        default:
            outputChannel.appendLine('Unknown message received:' + message);
    }
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

export async function handleInlineReview(
    toolCallId?: string, 
    toolName?: string, 
    args?: any
) {
    try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        
        let fileUri: vscode.Uri | undefined;

        // A. Global Review Mode (User clicked "Review All")
        if (!args || !args.filePath && !args.TargetFile) {
            const reviewManager = ReviewManager.getInstance();
            const stagedUris = Array.from(reviewManager.getStagedUris());
            if (stagedUris.length === 0) {
                vscode.window.showInformationMessage('No pending changes.');
                return;
            }
            // #43: Open the first file with pending edits — CodeLens handles the rest
            await vscode.window.showTextDocument(stagedUris[0]);
            return;
        } else {
            // B. Specific Tool Review — open the edited file
            const filePathParam = args.filePath || args.TargetFile;
            const filePath = path.isAbsolute(filePathParam) ? filePathParam : path.join(workspaceRoot, filePathParam);
            fileUri = vscode.Uri.file(filePath);
        }

        if (!fileUri) { return; }
        
        // #43: Just open the file — decorations + CodeLens show the review inline
        await vscode.window.showTextDocument(fileUri);
        outputChannel.appendLine(`[InlineReview] Opened ${path.basename(fileUri.fsPath)} for inline review`);
    } catch (e) {
        outputChannel.appendLine(`[InlineReview] Error: ${e}`);
    }
}

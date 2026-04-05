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
import { DiffContentProvider } from "./diff-content-provider";
import { ReviewManager } from "./review-manager";
import * as Diff from 'diff';

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
                const images = message.data.images;
                const agentId = message.data.agentId;
                // This turns the text + files into one big Markdown string
                const formattedMessage = formatMessageWithFiles(rawText, files);

                await webview.postMessage({
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

                webview.postMessage({ command: CHAT_COMMANDS.CHAT_STREAM_START });

                const aiResponse = await coreService.processChatRequest(
                    aiData,
                    // onChunk — stream text to frontend
                    async (chunk) => {
                        await webview.postMessage({
                            command: CHAT_COMMANDS.CHAT_STREAM_CHUNK,
                            content: chunk
                        });
                    },
                    // onAgentStep — stream tool telemetry to frontend
                    async (step) => {
                        await webview.postMessage({
                            command: CHAT_COMMANDS.CHAT_AGENT_STEP,
                            content: step
                        });
                    }
                );

                webview.postMessage({
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

                // 1. Delete messages from history, get the original user text back
                const lastUserMessage = await historyService.deleteLastMessages(chatId, deleteCount);
                const messageToSend = overrideMessage || lastUserMessage;
                if (!messageToSend) { break; }

                // 2. Re-stream using recovered or overridden message
                const retryData = {
                    message: messageToSend,
                    chat_id: chatId,
                    timestamp: new Date().toISOString(),
                    files: [],
                    images: []
                };

                webview.postMessage({ command: CHAT_COMMANDS.CHAT_STREAM_START });

                const aiResponse = await coreService.processChatRequest(retryData, async (chunk) => {
                    await webview.postMessage({
                        command: CHAT_COMMANDS.CHAT_STREAM_CHUNK,
                        content: chunk
                    });
                });

                webview.postMessage({
                    command: CHAT_COMMANDS.CHAT_STREAM_END,
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

                        // RESOLVE IMAGES: Convert "img_123.png" -> "vscode-resource://..."
                        let displayImages: any[] = [];
                        if (msg.images && msg.images.length > 0) {
                            displayImages = msg.images.map(fileName => ({
                                name: "Image",
                                dataUrl: imageService.getWebviewUri(fileName, webview),
                                path: imageService.getImagePath(fileName).fsPath // <--- Send REAL path
                            }));
                        }



                        await webview.postMessage({
                            command: CHAT_COMMANDS.CHAT_REQUEST,
                            content: msg.message,
                            images: displayImages,
                            role: msg.role === ROLE.USER ? ROLE.USER : ROLE.BOT,
                            isHistory: true, // TODO flag to avoid saving again
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

                    await webview.postMessage({
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
                                    await webview.postMessage({
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
                                await webview.postMessage({
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
                    await webview.postMessage({
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
                        await webview.postMessage({
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

                    await webview.postMessage({
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

/**
 * Opens a native VS Code side-by-side diff view showing original vs proposed content.
 * Does NOT modify the file buffer — the user reviews visually and clicks Approve/Deny in the chat.
 * Works for ALL files regardless of git status.
 */
/**
 * Applies a proposed change to the editor buffer and initiates an inline review.
 * Uses robust line-level diffing to find only changed hunks and handles L-prefixes.
 */
export async function handleInlineReview(
    toolCallId: string, 
    toolName: string, 
    args: any
) {
    try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        
        let filePath = '';
        if (toolName === 'create_file' || toolName === 'chunk_replace') {
            filePath = path.isAbsolute(args.filePath) ? args.filePath : path.join(workspaceRoot, args.filePath);
        }

        if (!filePath) { 
            outputChannel.appendLine(`[InlineReview] No filePath provided for ${toolName}. Skipping.`);
            return; 
        }

        // 0. Handle non-existent files (Create empty for preview)
        if (!fs.existsSync(filePath)) {
            if (toolName === 'create_file') {
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
                fs.writeFileSync(filePath, '', 'utf8');
                outputChannel.appendLine(`[InlineReview] Created placeholder for new file: ${filePath}`);
            } else {
                outputChannel.appendLine(`[InlineReview] File not found: ${filePath}. Cannot preview.`);
                return;
            }
        }

        const fileUri = vscode.Uri.file(filePath);
        const fileName = path.basename(filePath);
        
        const doc = await vscode.workspace.openTextDocument(fileUri);
        const editor = await vscode.window.showTextDocument(doc);

        // Read the latest buffer content (for the AI to apply its next hunk against)
        const latestContent = doc.getText();
        
        // Read the INITIAL content from the start of the turn (for the diff's Left side)
        const startOfTurnContent = ReviewManager.getInstance().getOriginalTurnContent(fileUri) || latestContent;

        // --- OPTIMIZATION: If review already active for this tool, just reveal it ---
        if (ReviewManager.getInstance().hasReviewsForTool(toolCallId)) {
            ReviewManager.getInstance().refreshDecorations();
            return;
        }

        // 1. Prepare proposed content (Always against LATEST buffer state)
        let fullProposedContent: string;
        if (toolName === 'create_file') {
            const cleanContent = (args.content || '').replace(/^L\d+:\s/gm, '');
            fullProposedContent = cleanContent;
        } else {
            const cleanTarget = args.targetContent.replace(/^L\d+:\s/gm, '');
            const cleanReplacement = (args.replacementContent || '').replace(/^L\d+:\s/gm, '');

            if (latestContent.includes(cleanTarget)) {
                fullProposedContent = latestContent.replace(cleanTarget, cleanReplacement);
            } else {
                outputChannel.appendLine(`[SplitReview] Error: Target text not found in ${fileName}. (Matches are case-sensitive and must be exact).`);
                ApprovalService.getInstance().resolveApproval(toolCallId, false);
                return;
            }
        }

        // 2. Open Split Diff Overview (Original Turn State vs Current Buffer)
        const originalVirtualUri = vscode.Uri.parse(`${DiffContentProvider.scheme}:original-${fileName}?${fileUri.toString()}`);
        DiffContentProvider.getInstance().updateContent(originalVirtualUri, startOfTurnContent);
        
        // Show the editor toolbar buttons
        vscode.commands.executeCommand('setContext', 'ai-companion.reviewPending', true);

        await vscode.commands.executeCommand('vscode.diff', 
            originalVirtualUri, 
            fileUri, 
            `${fileName} (Review Changes)`
        );

        // 3. Apply changes directly to the buffer 
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
        edit.replace(fileUri, fullRange, fullProposedContent);
        
        const success = await vscode.workspace.applyEdit(edit);
        if (!success) {
            outputChannel.appendLine(`[SplitReview] Failed to apply changes to buffer for ${fileName}.`);
            ApprovalService.getInstance().resolveApproval(toolCallId, false);
            return;
        }

        // 4. Identify hunks for granular 'Keep | Undo' Lenses
        // We diff latestContent vs fullProposedContent to find where THIS hunk ended up
        const hunks = Diff.diffLines(latestContent, fullProposedContent);
        let finalLineCounter = 0;
        let originalLineCounter = 0;
        let hunkCounter = 0;

        for (const hunk of hunks) {
            const lines = hunk.value.split('\n');
            if (lines[lines.length - 1] === '') { lines.pop(); }

            if (!hunk.added && !hunk.removed) {
                finalLineCounter += lines.length;
                originalLineCounter += lines.length;
            } else if (hunk.added) {
                // This is a NEW or REPLACEMENT block in the final buffer
                const hunkId = `${toolCallId}:hunk${hunkCounter++}`;
                const range = new vscode.Range(
                    new vscode.Position(finalLineCounter, 0),
                    new vscode.Position(finalLineCounter + lines.length - 1, 1000)
                );

                // Find corresponding original lines if it was a replacement
                // (Advanced: we could check if previous hunk was 'removed')
                // For now, store whatever lines were added.
                ReviewManager.getInstance().registerHunk({
                    id: hunkId,
                    toolCallId,
                    uri: fileUri,
                    range,
                    originalLines: [], // Simplified undo: just delete added lines
                    proposedLines: lines
                });
                finalLineCounter += lines.length;
            } else if (hunk.removed) {
                // If it's a pure removal, we can put an 'Undo Delete' lens at the current line
                const hunkId = `${toolCallId}:hunk${hunkCounter++}`;
                const range = new vscode.Range(
                    new vscode.Position(finalLineCounter, 0),
                    new vscode.Position(finalLineCounter, 1000)
                );
                
                ReviewManager.getInstance().registerHunk({
                    id: hunkId,
                    toolCallId,
                    uri: fileUri,
                    range,
                    originalLines: lines,
                    proposedLines: []
                });
                originalLineCounter += lines.length;
            }
        }

        outputChannel.appendLine(`[SplitReview] Applied changes to ${fileName} and opened Split Diff.`);
    } catch (e) {
        outputChannel.appendLine(`[SplitReview] CRITICAL ERROR: ${e}`);
    }
}
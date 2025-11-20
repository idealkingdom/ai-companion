/*
This function was originally from ChatViewProvider, however for simplicity and easy to access
separated by another module.
*/
import { outputChannel } from "../logger";
import { CHAT_COMMANDS, ROLE } from "./chat-constants";
import { ChatCoreService } from "./chat-core"; // Assuming you updated this to a Service, or kept it static
import { ChatHistoryService } from "./chat-history"; // Import the NEW Service
import { ChatViewProvider } from "./chat-view-provider";

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
            
            await webview.postMessage({
                command: CHAT_COMMANDS.CHAT_REQUEST, 
                content: message.data.message, 
                role: ROLE.USER
            });

            const aiResponse = await coreService.processChatRequest(message.data);
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

        // Handle other messages here
        default:
            outputChannel.appendLine('Unknown message received:' + message);
    }
};
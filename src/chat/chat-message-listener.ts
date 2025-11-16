/*
This function was originally from ChatViewProvider, however for simplicity and easy to access
separated by another module.
*/

import { outputChannel } from "../logger";
import { CHAT_COMMANDS } from "./chat-constants";
import { ChatCore} from "./chat-core";
import { ChatHistory } from "./chat-history";
import { ChatViewProvider } from "./chat-view-provider";

    // message sent from client js
export async function chatMessageListener(message: any) {
    switch (message.command) {
        case CHAT_COMMANDS.CHAT_WEBVIEW_READY:
            await ChatHistory.readChatHistory();
            ChatCore.resetChat();
            break;
        case CHAT_COMMANDS.CHAT_REQUEST:
            ChatViewProvider.getView()?.webview.postMessage(
                {command: 'chatRequest', content: await ChatCore.getChatRequest(message.data) }
            );
            break;
        // Handle other messages here
        default:
            outputChannel.appendLine('Unknown message received:' + message);
    }
};
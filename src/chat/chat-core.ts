import * as vscode from 'vscode';
import { openAIRequest } from '../api/ai';
import { outputChannel } from '../logger';
import { ChatMessage } from '../chat/chat-constants';

import {ROLE} from '../chat/chat-constants';


//import chatview provider
import { ChatViewProvider } from './chat-view-provider';


//utils
import { generateChatID } from './chat-utils';
import { ChatHistory } from './chat-history';
import { MODEL_PROVIDER, OPEN_AI_MODELS } from '../constants';



export class ChatCore{




    // reset chat
    public static async resetChat(){
        if (ChatViewProvider.getView()) {
        
             await ChatViewProvider.getView()?.webview.postMessage({ command: 'resetChat' , content:{uid:generateChatID()}});
        } else {
            outputChannel.appendLine("**Chat view is not available.**");
        }
    }

    // get the chat request from user
    public static async getChatRequest(data: any): Promise<any> {
        const config = vscode.workspace.getConfiguration('aiCompanion');
        const modelProvider = config.get<string>('modelProvider');
        const accessToken = config.get<string>('accessToken') || '';
        const temperature = config.get<number>('modelProvider.temperature') || 0.5;
        let returnValue:string = "";
        // input the user chat first
        try{
            switch (modelProvider) {
                case MODEL_PROVIDER.OPEN_AI:
                    const response = await openAIRequest(data.message, OPEN_AI_MODELS.GPT41_NANO, accessToken, temperature);
                    outputChannel.appendLine(response.content);
                    returnValue = response.content;
                default:
                    break;
            }
            
            const userMessage:ChatMessage = ChatCore.MakeChatInterface( data.chat_id, data.timestamp, ROLE.USER, data.message);
            const botMessage:ChatMessage = ChatCore.MakeChatInterface( data.chat_id, new Date().toISOString(), ROLE.BOT, returnValue);
            // SAVE TO HISTORY
            await ChatHistory.saveMessageToHistory(userMessage);
            await ChatHistory.saveMessageToHistory(botMessage);

            outputChannel.appendLine("To History SAVED! ");

        }catch(error){
            // Handle the error (log, notify user, etc.)
            console.error('Error fetching chat response:', error);
            outputChannel.appendLine('Failed to get response from AI service.');
            // Optionally, return a fallback message or rethrow
            returnValue = 'Sorry, I could not process your request at this time.';

        }
        return returnValue;
    }


    private static MakeChatInterface(chat_id: string, timestamp: string, role: ROLE, message:string): ChatMessage{
        return {
                chat_id : chat_id,
                timestamp: timestamp,
                role: role,
                message: message
        };
    }
}


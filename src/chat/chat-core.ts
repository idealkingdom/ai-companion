import * as vscode from 'vscode';
import { openAIRequest } from '../api/ai';
import { outputChannel } from '../logger';

import {ROLE} from '../chat/chat-constants';

//import chatview provider
import { ChatViewProvider } from './chat-view-provider';


//utils
import { ChatHistoryService } from './chat-history';
import { MODEL_PROVIDER, OPEN_AI_MODELS } from '../constants';
import * as crypto from 'crypto';




export class ChatCoreService{


    constructor(private readonly historyService: ChatHistoryService) {}

    /**
     * Helper to generate a new Chat ID uuid v4
     */
    public generateChatID():string {
        return crypto.randomUUID();
    }

    /**
     * Processes the user's message:
     * 1. Saves User Message to History
     * 2. Calls AI API
     * 3. Saves AI Message to History
     * 4. Returns the AI response text
     */
    public async processChatRequest(data: { message: string, chat_id: string, timestamp: string }): Promise<string> {
        const config = vscode.workspace.getConfiguration('aiCompanion');
        const modelProvider = config.get<string>('modelProvider');
        const accessToken = config.get<string>('accessToken') || '';
        const temperature = config.get<number>('modelProvider.temperature') || 0.5;
        
        let aiResponseText = "";

        try {
            // 1. SAVE USER MESSAGE (using the service)
            await this.historyService.addMessage(data.chat_id, ROLE.USER, data.message);

            // 2. CALL AI API
            switch (modelProvider) {
                case MODEL_PROVIDER.OPEN_AI:
                    //TODO: Make model configurable
                    const response = await openAIRequest(data.message, OPEN_AI_MODELS.GPT41_NANO, accessToken, temperature);
                    aiResponseText = response.content;
                    break;
                default:
                    // Fallback or other providers
                    aiResponseText = "Model provider not configured correctly.";
                    break;
            }
            
            // 3. SAVE AI MESSAGE (using the service)
            await this.historyService.addMessage(data.chat_id, ROLE.BOT, aiResponseText);

            outputChannel.appendLine("Chat interaction saved to history.");

        } catch (error) {
            console.error('Error fetching chat response:', error);
            outputChannel.appendLine('Failed to get response from AI service.');
            aiResponseText = 'Sorry, I could not process your request at this time.';
            
            // Optionally save the error message to history too
            await this.historyService.addMessage(data.chat_id, ROLE.BOT, aiResponseText);
        }

        return aiResponseText;
    }


}


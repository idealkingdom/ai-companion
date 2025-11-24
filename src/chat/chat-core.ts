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
    public async processChatRequest(data: {
        message: string, 
        chat_id: string, 
        timestamp: string,
        files?: any[]
    }): Promise<string> {
        
        
        // 1. GET SETTINGS
        // We read from config so you don't have to hardcode the System Prompt
        const config = vscode.workspace.getConfiguration('aiCompanion'); // Verify your config section name
        const maxContext = config.get<number>('maxContextMessages') || 10;
        const systemPromptText = config.get<string>('systemPrompt') || 
            "You are an expert code assistant. Answer coding relevant topics only.";
        const accessToken = config.get<string>('accessToken') || '';
        const temperature = config.get<number>('modelProvider.temperature') || 0.5;
        // ... get model provider settings ...

        let aiResponseText = "";


        try {
            let fullMessage = data.message;

            // Important: We save it to history *before* fetching context
            // so the user's current question is included in the history list.
            await this.historyService.addMessage(data.chat_id, ROLE.USER, data.message);

            // Fetch the last N messages (which now includes the one we just saved)
            const contextMessages = this.historyService.getContextWindow(data.chat_id, maxContext);

            // The system prompt must always be the very first message
            const apiPayload = [
                { role: 'system', content: systemPromptText },
                ...contextMessages
            ];

            // 5. CALL AI (Using your updated LangChain wrapper)
            // We pass the full array now
            const response = await openAIRequest(
                apiPayload, 
                OPEN_AI_MODELS.GPT41_NANO, // Or your config variable
                accessToken, 
                temperature
            );
            
            // LangChain returns an object, we want the text content
            aiResponseText = response.content; 
            
            // 6. SAVE AI RESPONSE
            await this.historyService.addMessage(data.chat_id, ROLE.BOT, aiResponseText);

            outputChannel.appendLine("Chat interaction saved and processed.");

        } catch (error) {
            console.error('Error fetching chat response:', error);
            aiResponseText = 'Sorry, I could not process your request at this time.';
            // Optionally save error to history
            await this.historyService.addMessage(data.chat_id, ROLE.BOT, aiResponseText);
        }

        return aiResponseText;
    }


}


import * as vscode from 'vscode';
import { openAIRequest } from '../api/ai';
import { outputChannel } from '../logger';
import { ROLE } from '../chat/chat-constants';
import { ChatHistoryService } from './chat-history';
import { MODEL_PROVIDER, OPEN_AI_MODELS } from '../constants';
import * as crypto from 'crypto';
import { ImageStorageService } from './image-storage';

export class ChatCoreService {

    constructor(
        private readonly historyService: ChatHistoryService,
        private readonly imageService: ImageStorageService
    ) {}

    /**
     * Helper to generate a new Chat ID uuid v4
     */
    public generateChatID(): string {
        return crypto.randomUUID();
    }

    /**
     * Processes the user's message:
     * 1. Saves Images to Disk (Hybrid Storage)
     * 2. Saves User Message to History (with file paths)
     * 3. Calls AI API (with Base64 images)
     * 4. Saves AI Message to History
     */
    public async processChatRequest(data: {
        message: string, 
        chat_id: string, 
        timestamp: string,
        files?: any[],
        images?: any[] 
    }): Promise<string> {
        
        const hasImages = data.images && Array.isArray(data.images) && data.images.length > 0;

        // 1. GET SETTINGS
        const config = vscode.workspace.getConfiguration('aiCompanion');
        const maxContext = config.get<number>('maxContextMessages') || 10;
        const systemPromptText = config.get<string>('systemPrompt') || 
            "You are an expert code assistant. Answer coding relevant topics only.";
        const accessToken = config.get<string>('accessToken') || '';
        const temperature = config.get<number>('modelProvider.temperature') || 0.5;

        let aiResponseText = "";

        try {
            // --- STEP A: HANDLE IMAGES ---
            const storedImageFilenames: string[] = []; // For History (Disk paths)
            const aiImagePayload: any[] = [];          // For OpenAI (Base64)

            if (hasImages) {
                for (const img of data.images!) {
                    // 1. Save to Disk -> Get Filename (e.g., "img_123.png")
                    // This keeps globalState small
                    const fileName = await this.imageService.saveImage(img.dataUrl);
                    storedImageFilenames.push(fileName);

                    // 2. Prepare for OpenAI (needs URL/Base64)
                    aiImagePayload.push({
                        type: "image_url",
                        image_url: { url: img.dataUrl }
                    });
                }
            }

            // --- STEP B: SAVE USER MESSAGE TO HISTORY ---
            // We save the text + filenames of images (NOT base64)
            // Note: 'data.message' might already contain the markdown for file attachments 
            // if processed by the listener.
            await this.historyService.addMessage(
                data.chat_id, 
                ROLE.USER, 
                data.message,
                storedImageFilenames // Pass the filenames array
            );

            // --- STEP C: PREPARE API PAYLOAD ---
            
            // 1. Fetch Context (Text History)
            // This fetches the message we just saved + previous messages
            const contextMessages = this.historyService.getContextWindow(data.chat_id, maxContext);

            // 2. Construct the Current Message Payload for AI
            let currentMessageContent: any;

            if (hasImages) {
                // Multimodal format: [ {type: text}, {type: image}, ... ]
                currentMessageContent = [
                    { type: "text", text: data.message },
                    ...aiImagePayload
                ];
            } else {
                // Text-only format
                currentMessageContent = data.message;
            }

            // 3. Final Payload
            // We append the current message manually because 'contextMessages' 
            // might only have text representation of images, but we want to send 
            // actual Base64 for the *current* turn.
            
            // (Optimization: If you want context images to be "seen" again, 
            // you'd need complex logic to re-read them from disk. 
            // For now, standard practice is usually sending images only for current turn 
            // or recent context if token limits allow).
            
            // Let's use the context window + current message structure
            // NOTE: Since we just saved the user message to history, contextMessages 
            // includes it. But contextMessages is purely text.
            // To ensure Vision works, we replace the *last* message in context 
            // with our multimodal payload, OR we exclude the last save from context fetch 
            // and append manually.
            
            // Strategy: Remove the last item from context (which is the text-only version we just saved)
            // and replace it with the full multimodal version.
            if (contextMessages.length > 0 && contextMessages[contextMessages.length - 1].role === 'user') {
                contextMessages.pop();
            }

            const apiPayload = [
                { role: 'system', content: systemPromptText },
                ...contextMessages,
                { role: 'user', content: currentMessageContent }
            ];

            // --- STEP D: CALL AI ---
            // Use a Vision-capable model if images are present
            const targetModel = hasImages ? OPEN_AI_MODELS.GPT4o : OPEN_AI_MODELS.GPT41_NANO;

            const response = await openAIRequest(
                apiPayload, 
                targetModel,
                accessToken, 
                temperature
            );
            
            aiResponseText = response.content; 
            
            // --- STEP E: SAVE AI RESPONSE ---
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
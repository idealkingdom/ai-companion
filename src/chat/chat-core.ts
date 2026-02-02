import * as vscode from 'vscode';
import { openAIRequest } from '../api/ai';
import { outputChannel } from '../logger';
import { ROLE } from '../chat/chat-constants';
import { ChatHistoryService } from './chat-history';
import * as crypto from 'crypto';
import { ImageStorageService } from './image-storage';
import { ImageDescriptionService } from './image-description-service';

import { SettingsManager } from '../services/settings-manager';

export class ChatCoreService {

    constructor(
        private readonly historyService: ChatHistoryService,
        private readonly imageService: ImageStorageService,
        private readonly settingsManager: SettingsManager,
        private readonly descriptionService: ImageDescriptionService = new ImageDescriptionService(settingsManager)
    ) { }

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
        const appSettings = this.settingsManager.getSettings();

        const maxContext = appSettings.general.maxContextMessages;
        const accessToken = appSettings.models.apiKey;
        const temperature = appSettings.general.temperature;

        let aiResponseText = "";

        try {
            // --- STEP A: HANDLE IMAGES ---
            const storedImageFilenames: string[] = []; // For History (Disk paths)
            const storedImageDescriptions: string[] = []; // For Memory/Fallback
            const aiImagePayload: any[] = [];          // For OpenAI (Base64)

            // 1. New Images from User
            if (hasImages) {
                const descriptionPromises = data.images!.map(async (img) => {
                    // a. Save to Disk
                    const fileName = await this.imageService.saveImage(img.dataUrl);
                    storedImageFilenames.push(fileName);

                    // b. Generate Description (Memory)
                    const desc = await this.descriptionService.describeImage(img.dataUrl);
                    storedImageDescriptions.push(desc);

                    // c. Prepare Payload
                    aiImagePayload.push({
                        type: "image_url",
                        image_url: { url: img.dataUrl }
                    });
                });

                // Wait for all saves/descriptions
                await Promise.all(descriptionPromises);
            }

            // --- STEP B: SAVE USER MESSAGE TO HISTORY ---
            // We save the text + filenames of images (NOT base64)
            // Note: 'data.message' might already contain the markdown for file attachments 
            // if processed by the listener.
            await this.historyService.addMessage(
                data.chat_id,
                ROLE.USER,
                data.message,
                storedImageFilenames,
                storedImageDescriptions // <--- Save descriptions too
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

            const configModel = appSettings.models.provider; // e.g. "OpenAI", "Mistral"
            // Simple check: Only use Vision model if explicitly OpenAI + Has Images.
            // (You might want better logic if other providers support vision).
            const isVisionCapable = (configModel === 'OpenAI' || !configModel) && hasImages;

            // Allow user to pick model, but force Vision if they uploaded images AND didn't pick a non-vision one?
            // Actually, per requirement: If model is text-only, use descriptions.

            // Let's check the requested model from standard logic or config
            // For now, let's say: If hasImages, we WANT to use GPT-4o.
            // BUT, if the user forced a text-only model setting (e.g. "DeepSeek"), we should respect that?
            // The prompt says "if we use doesn't support images... how can we deal with it?"

            let targetModel: string = 'gpt-4o-mini'; // Default fallback
            let finalContextMessages = [...contextMessages];
            let finalCurrentMessage: any = currentMessageContent;

            // Decision Logic
            if (hasImages) {
                if (isVisionCapable) {
                    targetModel = appSettings.models.imageModel || 'gpt-4o-mini';
                    // If using a custom provider or model, we trust the setting.
                    // For OpenAI compatibility, we ensure the model name is correct.
                } else {
                    // FALLBACK: Text-Only Model selected or provider doesn't support vision
                    // Replace the Image Payload with Text Descriptions
                    const descriptionContext = storedImageDescriptions.map((d, i) => `[Image ${i + 1} Description: ${d}]`).join("\n");

                    // Override the current message content to be just text
                    finalCurrentMessage = `${data.message}\n\n${descriptionContext}`;
                }
            } else {
                targetModel = appSettings.models.textModel || 'gpt-4o';
            }

            // --- SEQUENTIAL PROMPT EXECUTION ---

            // 1. Get Active Prompts
            const activePrompts = appSettings.prompts
                .filter((p: any) => p.isActive)
                .sort((a: any, b: any) => a.order - b.order);

            // 2. Define Execution Loop
            // If no prompts are active, we run once with the default system prompt.
            // If prompts are active, we run sequentially.
            // Note: The 'User Message' for Step N+1 is the 'AI Response' from Step N.

            let pipelineContext = finalCurrentMessage; // Start with user input (or multimodal array)
            const steps = activePrompts.length > 0 ? activePrompts : [{ content: appSettings.general.systemPrompt || "You are a helpful assistant." }];

            // Global settings overrides
            const apiBaseUrl = appSettings.models.baseUrl;
            const apiKey = appSettings.models.apiKey;

            for (const step of steps) {

                // Construct Payload for this step
                // Ideally, we might want to keep history? 
                // For a true chain, maybe only the immediate context matters, 
                // OR we append the chain to the history?
                // Let's keep the shared historyContext for now.

                const apiPayload = [
                    // The System Prompt for this specific agent
                    { role: 'system', content: (step as any).content || step },
                    ...finalContextMessages,
                    { role: 'user', content: pipelineContext }
                ];

                // O1 Models do not support temperature (must be 1 or default).
                // To be safe, if model is o1, we force temperature to 1 (or undefined if api supports it).
                const isO1 = targetModel.startsWith('o1');
                const requestTemperature = isO1 ? 1 : temperature;

                // Call AI
                const response = await openAIRequest(
                    apiPayload,
                    targetModel,
                    apiKey || accessToken,
                    requestTemperature,
                    apiBaseUrl
                );

                // Output becomes input for next step (if any)
                // If multimodal input was used in Step 1, the response text becomes text input for Step 2.
                pipelineContext = response.content;
                aiResponseText = response.content; // Update final result
            }

            // Also handle PREVIOUS context images?
            // Right now contextMessages is text-only from historyService.getContextWindow
            // Ideally, getContextWindow should return descriptions if available!
            // (We haven't updated getContextWindow yet, but since we saved descriptions to history, 
            //  we should update that method to append them if they exist).

            // Update: Since we can't easily change getContextWindow return type (it expects array of objects), 
            // let's rely on the fact that we might need to inject descriptions into the text content stored 
            // OR update getContextWindow to append them.

            // For now, let's assume getContextWindow returns the text prompt.
            // If we save descriptions in a separate field, they are NOT in 'message' text by default.







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
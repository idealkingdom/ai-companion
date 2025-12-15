import { openAIRequest } from '../api/ai';
import { OPEN_AI_MODELS } from '../constants';
import * as vscode from 'vscode';

import { SettingsManager } from '../services/settings-manager';

export class ImageDescriptionService {

    constructor(private readonly settingsManager: SettingsManager) { }

    /**
     * Generates a text description (caption) for a given Base64 image.
     * Uses a lightweight vision model (e.g. GPT-4o-mini) to save costs.
     */
    public async describeImage(base64Image: string): Promise<string> {
        try {
            const appSettings = this.settingsManager.getSettings();
            const accessToken = appSettings.models.apiKey;

            // Use gpt-4o-mini for fast/cheap vision
            // If strictly unavailable, could fallback to GPT-4o
            const visionModel = appSettings.models.imageModel || "gpt-4o-mini";

            const messages = [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Describe this image in detail for a coding assistant context. Focus on code, errors, UI elements, or diagrams visible." },
                        {
                            type: "image_url",
                            image_url: {
                                "url": base64Image,
                            },
                        }
                    ]
                }
            ];

            // Reuse existing API wrapper
            // Note: openAIRequest expects standard { role, content } objects, 
            // but our content here is an array (Multimodal). 
            // LangChain's ChatOpenAI handles this if the type allows it, or we cast 'any'.
            const response = await openAIRequest(
                messages as any,
                visionModel,
                accessToken,
                0.3 // Low temp for factual description
            );

            return response.content || "Image description unavailable.";

        } catch (error) {
            console.error("Failed to describe image:", error);
            return "Failed to generate image description.";
        }
    }
}

import { aiRequest } from '../api/ai';


import { SettingsManager } from '../services/settings-manager';

export class ImageDescriptionService {

    constructor(private readonly settingsManager: SettingsManager) { }

    /**
     * Generates a text description (caption) for a given Base64 image.
     * Uses the configured image model and provider.
     */
    public async describeImage(base64Image: string): Promise<string> {
        try {
            const appSettings = this.settingsManager.getSettings();

            // Use the configured image model for vision (falls back to text model)
            const visionModel = appSettings.models.imageModel || appSettings.models.textModel;

            // #71: Resolve custom model config — custom model's own apiKey/baseUrl take priority
            const customModel = (appSettings.customModels || []).find((cm: any) => cm.name === visionModel);
            const currentProvider = customModel?.provider || appSettings.models.provider || 'OpenAI';
            const pSettings = appSettings.models.providerSettings?.[currentProvider] || {};

            const accessToken = customModel?.apiKey || pSettings.apiKey || appSettings.models.apiKey || '';
            const baseUrl = customModel?.baseUrl || pSettings.baseUrl || '';

            const messages = [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Describe this image in detail for a coding assistant context. Focus on code, errors, UI elements, or diagrams visible." },
                        {
                            type: "image",
                            image: new URL(base64Image)
                        }
                    ]
                }
            ];

            // Use the provider-agnostic request function
            const response = await aiRequest(
                messages as any,
                visionModel,
                accessToken,
                0.3, // Low temp for factual description
                currentProvider,
                baseUrl
            );

            return response.content || "Image description unavailable.";

        } catch (error) {
            console.error("Failed to describe image:", error);
            return "Failed to generate image description.";
        }
    }
}

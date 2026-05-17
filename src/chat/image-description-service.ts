import { aiRequest } from '../api/ai';
import { outputChannel } from '../logger';

import { SettingsManager } from '../services/settings-manager';

export class ImageDescriptionService {

    constructor(private readonly settingsManager: SettingsManager) { }

    /**
     * Generates a text description (caption) for a given Base64 image.
     * Uses the configured image model and provider.
     * Falls back to the active text model if the image model is misconfigured.
     */
    public async describeImage(base64Image: string): Promise<string> {
        try {
            const appSettings = this.settingsManager.getSettings();
            const textModel = appSettings.models.textModel;
            const imageModel = appSettings.models.imageModel;

            // Determine the best model for vision:
            // 1. Configured image model (if it exists as a valid custom model)
            // 2. Active text model (if it has IMAGE toggle ON)
            // 3. Configured image model as raw fallback
            // 4. Text model as ultimate fallback
            let visionModel = textModel;
            let resolvedCustomModel: any = null;
            let resolvedBuiltInProvider: string | null = null;
            const { getModelProviderOptions } = require('../constants');
            const providerOptions = getModelProviderOptions();

            // Helper to check if a model is a known built-in image model
            const getBuiltInProvider = (modelName: string) => {
                for (const [providerKey, providerData] of Object.entries(providerOptions)) {
                    const source: any = (providerData as any).models || providerData;
                    if (source.image && source.image.includes(modelName)) {
                        return providerKey;
                    }
                }
                return null;
            };

            if (imageModel) {
                const imageCustomModel = (appSettings.customModels || []).find((cm: any) => cm.name === imageModel);
                if (imageCustomModel) {
                    // Custom model found — use it (empty baseUrl = use provider default)
                    visionModel = imageModel;
                    resolvedCustomModel = imageCustomModel;
                } else {
                    // Not a custom model — check built-in providers
                    const builtInProvider = getBuiltInProvider(imageModel);
                    if (builtInProvider) {
                        visionModel = imageModel;
                        resolvedBuiltInProvider = builtInProvider;
                    } else {
                        outputChannel.appendLine(`[ImageDescription] Image model "${imageModel}" is unknown, falling back to text model "${textModel}"`);
                    }
                }
            }

            // If no valid model resolved yet, try the text model
            if (!resolvedCustomModel && !resolvedBuiltInProvider) {
                resolvedCustomModel = (appSettings.customModels || []).find((cm: any) => cm.name === textModel);
                visionModel = textModel;
                if (!resolvedCustomModel) {
                    resolvedBuiltInProvider = getBuiltInProvider(textModel) || appSettings.models.provider;
                }
            }

            const currentProvider = resolvedCustomModel?.provider || resolvedBuiltInProvider || appSettings.models.provider || 'OpenAI';
            const pSettings = appSettings.models.providerSettings?.[currentProvider] || {};

            const accessToken = resolvedCustomModel?.apiKey || pSettings.apiKey || appSettings.models.apiKey || '';
            const baseUrl = resolvedCustomModel?.baseUrl || pSettings.baseUrl || '';

            outputChannel.appendLine(`[ImageDescription] model=${visionModel}, provider=${currentProvider}, baseUrl=${baseUrl || '(default)'}, imageLen=${base64Image.length}`);

            const messages = [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Describe this image in detail for a coding assistant context. Focus on code, errors, UI elements, or diagrams visible." },
                        {
                            type: "image",
                            image: base64Image
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
            outputChannel.appendLine(`[ImageDescription] ❌ Failed: ${error}`);
            console.error("Failed to describe image:", error);
            return "Failed to generate image description.";
        }
    }
}

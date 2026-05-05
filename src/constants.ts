import * as fs from 'fs';
import * as path from 'path';

export const EXTENSION_NAME = 'ai-companion';

export enum MODEL_PROVIDER {
    OPEN_AI = 'OpenAI',
    GEMINI = 'Gemini'
}

export function getModelProviderOptions(): Record<string, { name: string; models: { text: string[]; image: string[] } }> {
    try {
        const modelsJsonPath = path.join(__dirname, '..', 'models.json');
        if (fs.existsSync(modelsJsonPath)) {
            return JSON.parse(fs.readFileSync(modelsJsonPath, 'utf8'));
        }
    } catch (e) {
        console.error("Failed to load models.json dynamically", e);
    }
    // Fallback if not found
    return {
        "OpenAI": {
            "name": "OpenAI",
            "models": { "text": ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"], "image": ["dall-e-3"] }
        }
    };
}


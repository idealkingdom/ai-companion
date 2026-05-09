import * as fs from 'fs';
import * as path from 'path';

export const EXTENSION_NAME = 'ai-companion';

export enum MODEL_PROVIDER {
    OPEN_AI = 'OpenAI',
    GEMINI = 'Gemini'
}

export interface PromptDef {
    id: string;
    name: string;
    content: string;
    description?: string;
    systemPrompt?: string;
    isDefault?: boolean;
    isActive?: boolean;
    order?: number;
    linkedSources?: string[];
    linkedRules?: string[];
    [key: string]: any;
}

export interface AppSettings {
    general: {
        systemPrompt: string;
        temperature: number;
        theme: string;
    };
    models: {
        textModel: string;
        imageModel: string;
        baseUrl: string;
        apiKey: string;
        provider: string;
        providerSettings: Record<string, {
            apiKey: string;
            baseUrl: string;
            textModel: string;
            imageModel: string;
        }>;
        inactiveModels: string[];
    };
    permissions: {
        readFilesConfirmation: boolean;
        writeFilesConfirmation: boolean;
        runCommandsConfirmation: boolean;
        alwaysProceed?: boolean;
    };
    ui: {
        sidebarPosition: 'left' | 'right';
        showLineNumbers: boolean;
    };
    prompts: PromptDef[];
    customTemplates: any[];
    customModels: any[];
    rules: { id: string; name: string; content: string; scope: 'global' | 'workspace' | 'assignable' }[];
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

/**
 * Resolve the tier for a given model name.
 * Looks up the `tiers` map in models.json for the active provider.
 * Custom/unknown models default to 'mid' (safe middle ground).
 */
export function getModelTier(provider: string, modelName: string): 'frontier' | 'mid' | 'small' {
    try {
        const providers = getModelProviderOptions() as any;
        const providerData = providers[provider];
        if (providerData?.tiers?.[modelName]) {
            return providerData.tiers[modelName];
        }
    } catch { }
    return 'mid'; // Default for custom/unknown models
}

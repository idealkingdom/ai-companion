import * as vscode from 'vscode';

export interface PromptDef {
    id: string;
    name: string;
    content: string;
    isActive: boolean;
    order: number;
}

export interface AppSettings {
    general: {
        temperature: number;
        maxContextMessages: number;
        systemPrompt: string;
    };
    models: {
        textModel: string;
        imageModel: string;
        baseUrl: string;
        apiKey: string;
        provider: 'OpenAI' | 'Gemini';

        // Persisted per-provider settings
        providerSettings: {
            [key: string]: {
                apiKey: string;
                baseUrl: string;
                textModel: string;
                imageModel: string;
            }
        };
    };
    prompts: PromptDef[];
}

const DEFAULT_SETTINGS: AppSettings = {
    general: {
        temperature: 0.7,
        maxContextMessages: 10,
        systemPrompt: "You are an expert code assistant. Answer coding relevant topics only."
    },
    models: {
        textModel: 'gpt-4o',
        imageModel: 'gpt-4o',
        baseUrl: '',
        apiKey: '',
        provider: 'OpenAI',
        providerSettings: {
            'OpenAI': { apiKey: '', baseUrl: 'https://api.openai.com/v1', textModel: 'gpt-4o', imageModel: 'gpt-4o' },
            'Gemini': { apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', textModel: 'gemini-1.5-pro', imageModel: 'gemini-1.5-flash' }
        }
    },
    prompts: []
};

export class SettingsManager {
    private static readonly KEY = 'aiCompanion.customSettings';

    constructor(private readonly context: vscode.ExtensionContext) { }

    public getSettings(): AppSettings {
        const stored = this.context.globalState.get<AppSettings>(SettingsManager.KEY);
        if (!stored) {
            return DEFAULT_SETTINGS;
        }

        // Ensure structure (naive merge)
        const merged = {
            general: { ...DEFAULT_SETTINGS.general, ...stored.general },
            models: { ...DEFAULT_SETTINGS.models, ...stored.models },
            prompts: stored.prompts || []
        };

        // Ensure providerSettings exists inside models if it wasn't there (though spread above handles it if stored.models has it)
        // If stored.models didn't have providerSettings (older version), we need defaults.
        if (!merged.models.providerSettings) {
            merged.models.providerSettings = DEFAULT_SETTINGS.models.providerSettings;
        } else {
            // Deep merge providerSettings to ensure keys exist
            merged.models.providerSettings = {
                ...DEFAULT_SETTINGS.models.providerSettings,
                ...merged.models.providerSettings
            };
        }

        return merged;
    }

    public async updateSettings(newSettings: Partial<AppSettings>): Promise<void> {
        const current = this.getSettings();
        const updated = { ...current, ...newSettings };
        await this.context.globalState.update(SettingsManager.KEY, updated);
    }

    public async resetSettings(): Promise<void> {
        await this.context.globalState.update(SettingsManager.KEY, undefined);
    }
}

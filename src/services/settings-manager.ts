import * as vscode from 'vscode';
import { MODEL_PROVIDER } from '../constants';

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
        provider: MODEL_PROVIDER.OPEN_AI | MODEL_PROVIDER.GEMINI;

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
    permissions: {
        readFilesConfirmation: boolean;
        writeFilesConfirmation: boolean;
        runCommandsConfirmation: boolean;
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
        provider: MODEL_PROVIDER.OPEN_AI,
        providerSettings: {
            [MODEL_PROVIDER.OPEN_AI]: { apiKey: '', baseUrl: 'https://api.openai.com/v1', textModel: 'gpt-4o', imageModel: 'gpt-4o' },
            [MODEL_PROVIDER.GEMINI]: { apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', textModel: 'gemini-2.5-pro', imageModel: 'gemini-2.5-pro' }
        }
    },
    permissions: {
        readFilesConfirmation: false,
        writeFilesConfirmation: true,
        runCommandsConfirmation: true
    },
    prompts: [
        {
            id: 'agent-assistant-1',
            name: 'Assistant',
            content: 'You are a helpful and expert AI coding assistant. Provide clean, secure, and well-documented code.',
            isActive: false,
            order: 1
        },
        {
            id: 'agent-architect-2',
            name: 'Architect',
            content: 'You are a Senior Technical Lead and Systems Architect. When analyzing problems, outline the solution step-by-step, listing prerequisites, edge cases, and architectural diagrams before writing any code.',
            isActive: false,
            order: 2
        }
    ]
};

export class SettingsManager {
    private static readonly KEY = 'aiCompanion.customSettings';

    constructor(private readonly context: vscode.ExtensionContext) { }

    public getSettings(): AppSettings {
        const stored = this.context.globalState.get<AppSettings>(SettingsManager.KEY);
        if (!stored) {
            return DEFAULT_SETTINGS;
        }

        let finalPrompts = stored.prompts || [];
        if (finalPrompts.length === 0) {
            // Guarantee predefined agents load securely for existing profiles
            finalPrompts = [...DEFAULT_SETTINGS.prompts];
        }

        // Ensure structure (naive merge)
        const merged = {
            general: { ...DEFAULT_SETTINGS.general, ...stored.general },
            models: { ...DEFAULT_SETTINGS.models, ...stored.models },
            permissions: { ...DEFAULT_SETTINGS.permissions, ...stored.permissions },
            prompts: finalPrompts
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

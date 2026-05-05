import * as vscode from 'vscode';
import { MODEL_PROVIDER } from '../constants';

export interface PromptDef {
    id: string;
    name: string;
    content: string;
    isActive: boolean;
    order: number;
    linkedSources?: string[];
}

export interface CustomModel {
    id: string;
    name: string;
    provider: string;
    apiKey: string;
    baseUrl: string;
    supportsImage: boolean;
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
        inactiveModels: string[]; // List of models explicitly marked as inactive
    };
    permissions: {
        readFilesConfirmation: boolean;
        writeFilesConfirmation: boolean;
        runCommandsConfirmation: boolean;
    };
    ui: {
        customCss: string;
        lastCustomCss?: string;
    };
    customTemplates?: { id: string; name: string; css: string }[];
    customModels?: CustomModel[];
    prompts: PromptDef[];
}

const DEFAULT_SETTINGS: AppSettings = {
    general: {
        temperature: 0.7,
        maxContextMessages: 10,
        systemPrompt: "You are an expert code assistant. Answer coding relevant topics only."
    },
    models: {
        textModel: 'gpt-5.2-pro',
        imageModel: 'gpt-5.2-pro',
        baseUrl: '',
        apiKey: '',
        provider: MODEL_PROVIDER.OPEN_AI,
        providerSettings: {
            [MODEL_PROVIDER.OPEN_AI]: { apiKey: '', baseUrl: 'https://api.openai.com/v1', textModel: 'gpt-5.2-pro', imageModel: 'gpt-5.2-pro' },
            [MODEL_PROVIDER.GEMINI]: { apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', textModel: 'gemini-2.5-pro', imageModel: 'gemini-2.5-pro' }
        },
        inactiveModels: []
    },
    permissions: {
        readFilesConfirmation: false,
        writeFilesConfirmation: true,
        runCommandsConfirmation: true
    },
    ui: {
        customCss: `/* ─── AI Companion Premium Styles ─── */\n\n/* 1. Global Typography */\nbody {\n    font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, sans-serif) !important;\n    -webkit-font-smoothing: antialiased;\n}\n\n/* 2. Input Editor Enhancements */\n#messageInput, code, .textarea {\n    font-family: var(--font-editor, monospace) !important;\n    font-size: 0.92rem !important;\n    line-height: 1.6 !important;\n}\n\n/* 3. Floating Bubble Adjustments */\n.message-body {\n    border-radius: 12px !important;\n    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1) !important;\n}\n`
    },
    prompts: [
        {
            id: 'agent-assistant-1',
            name: 'Chat',
            content: 'You are a helpful and expert AI coding assistant. Provide clean, secure, and well-documented code.',
            isActive: true,
            order: 1
        },
        {
            id: 'agent-architect-2',
            name: 'Architect',
            content: 'You are a Senior Technical Lead and Systems Architect. When analyzing problems, outline the solution step-by-step, listing prerequisites, edge cases, and architectural diagrams before writing any code.',
            isActive: true,
            order: 2
        }
    ]
};

export class SettingsManager {
    private static readonly KEY = 'aiCompanion.customSettings';
    private static readonly _onDidUpdateSettings = new vscode.EventEmitter<AppSettings>();
    public static readonly onDidUpdateSettings = SettingsManager._onDidUpdateSettings.event;

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
        // Migration: Removed previous logic that force-enabled default agents, 
        // as it was overriding user's explicit choices to disable them.

        // Ensure structure (naive merge)
        const merged: AppSettings = {
            general: { ...DEFAULT_SETTINGS.general, ...stored.general },
            models: { ...DEFAULT_SETTINGS.models, ...stored.models },
            permissions: { ...DEFAULT_SETTINGS.permissions, ...stored.permissions },
            ui: { ...DEFAULT_SETTINGS.ui, ...stored.ui },
            prompts: finalPrompts,
            customTemplates: stored.customTemplates || [],
            customModels: stored.customModels || []
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
        SettingsManager._onDidUpdateSettings.fire(updated);
    }

    public async resetSettings(): Promise<void> {
        await this.context.globalState.update(SettingsManager.KEY, undefined);
    }
}

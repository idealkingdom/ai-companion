import * as vscode from 'vscode';
import { MODEL_PROVIDER, getModelProviderOptions } from '../constants';

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
        provider: string;
        inactiveModels?: string[];
        providerSettings: Record<string, {
            textModel?: string;
            imageModel?: string;
            apiKey?: string;
            baseUrl?: string;
        }>;
    };
    permissions: {
        allowShellExecution: boolean;
        allowFileModification: boolean;
    };
    ui: {
        theme: 'dark' | 'light' | 'system';
        fontSize: number;
        accentColor: string;
        customCss: string;
        lastCustomCss?: string;
    };
    prompts?: PromptDef[];
    customTemplates?: any[];
    customModels?: CustomModel[];
}

export const DEFAULT_SETTINGS: AppSettings = (() => {
    const options = getModelProviderOptions();
    const defaultProviderKey = Object.keys(options)[0] || MODEL_PROVIDER.OPEN_AI;
    const defaultProviderData = options[defaultProviderKey] || { models: { text: [], image: [] } };
    const defaultTextModel = (defaultProviderData.models?.text || [])[0] || '';
    const defaultImageModel = (defaultProviderData.models?.image || [])[0] || '';

    const dynamicProviderSettings: any = {};
    for (const [key, data] of Object.entries(options)) {
        let baseUrl = '';
        if (key === MODEL_PROVIDER.OPEN_AI) { baseUrl = 'https://api.openai.com/v1'; }
        if (key === MODEL_PROVIDER.GEMINI) { baseUrl = 'https://generativelanguage.googleapis.com/v1beta'; }
        dynamicProviderSettings[key] = {
            apiKey: '',
            baseUrl: baseUrl,
            textModel: (data.models?.text || [])[0] || '',
            imageModel: (data.models?.image || [])[0] || ''
        };
    }

    return {
        general: {
            temperature: 0.7,
            maxContextMessages: 10,
            systemPrompt: "You are an expert code assistant. Answer coding relevant topics only."
        },
        models: {
            textModel: defaultTextModel,
            imageModel: defaultImageModel,
            baseUrl: '',
            apiKey: '',
            provider: defaultProviderKey,
            providerSettings: dynamicProviderSettings,
            inactiveModels: []
        },
        permissions: {
            allowShellExecution: false,
            allowFileModification: false
        },
        ui: {
            theme: 'system',
            fontSize: 14,
            accentColor: '#007acc',
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
})();

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
            finalPrompts = [...(DEFAULT_SETTINGS.prompts || [])];
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
        
        // Diagnostic logging — trace what's being persisted
        const { outputChannel } = require('../logger');
        outputChannel.appendLine(`[SettingsManager] updateSettings called`);
        outputChannel.appendLine(`[SettingsManager] inactiveModels in payload: ${JSON.stringify(updated.models?.inactiveModels || [])}`);
        outputChannel.appendLine(`[SettingsManager] Firing onDidUpdateSettings event...`);
        
        await this.context.globalState.update(SettingsManager.KEY, updated);
        SettingsManager._onDidUpdateSettings.fire(updated);
        
        outputChannel.appendLine(`[SettingsManager] Event fired successfully.`);
    }

    public async resetSettings(): Promise<void> {
        await this.context.globalState.update(SettingsManager.KEY, undefined);
    }
}

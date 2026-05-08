import * as vscode from 'vscode';
import { AppSettings, MODEL_PROVIDER } from '../constants';
import { getModelProviderOptions } from '../constants';

/**
 * Default settings for the application.
 * #52: Dynamic population from models.json registry.
 */
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
            systemPrompt: "You are an expert AI assistant.",
            temperature: 0.7,
            theme: 'dark'
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
            readFilesConfirmation: true,
            writeFilesConfirmation: true,
            runCommandsConfirmation: true,
            alwaysProceed: false
        },
        ui: {
            sidebarPosition: 'right',
            showLineNumbers: true
        },
        prompts: [
            {
                id: 'agent-1',
                name: 'Software Engineer',
                description: 'Expert in coding and architecture.',
                systemPrompt: 'You are an expert software engineer.',
                isDefault: true,
                isActive: true
            }
        ],
        customTemplates: [],
        customModels: [],
        rules: []
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
            finalPrompts = [...(DEFAULT_SETTINGS.prompts || [])];
        }

        const merged: AppSettings = {
            general: { ...DEFAULT_SETTINGS.general, ...stored.general },
            models: { ...DEFAULT_SETTINGS.models, ...stored.models },
            permissions: { ...DEFAULT_SETTINGS.permissions, ...stored.permissions },
            ui: { ...DEFAULT_SETTINGS.ui, ...stored.ui },
            prompts: finalPrompts,
            customTemplates: stored.customTemplates || [],
            customModels: stored.customModels || [],
            rules: stored.rules || []
        };

        if (!merged.models.providerSettings) {
            merged.models.providerSettings = DEFAULT_SETTINGS.models.providerSettings;
        } else {
            merged.models.providerSettings = {
                ...DEFAULT_SETTINGS.models.providerSettings,
                ...merged.models.providerSettings
            };
        }

        // Sync with VS Code official settings (#52)
        const config = vscode.workspace.getConfiguration('aiCompanion');
        const configProvider = config.get<string>('modelProvider');
        const configToken = config.get<string>('accessToken');

        if (configProvider && !stored.models?.provider) {
            merged.models.provider = configProvider;
        }
        if (configToken && configToken.trim() !== '') {
            merged.models.apiKey = configToken;
            const currentProvider = merged.models.provider;
            if (merged.models.providerSettings[currentProvider] && !merged.models.providerSettings[currentProvider].apiKey) {
                merged.models.providerSettings[currentProvider].apiKey = configToken;
            }
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

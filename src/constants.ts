export const EXTENSION_NAME = 'ai-companion';


export enum MODEL_PROVIDER {
    OPEN_AI = 'OpenAI',
    GEMINI = 'Gemini'
}

export const MODEL_PROVIDER_OPTIONS:
    Record<string, { name: string; models: { text: string[]; image: string[] } }>
    = {
    [MODEL_PROVIDER.OPEN_AI]: {
        name: MODEL_PROVIDER.OPEN_AI, models: {
            text: ['gpt-5.2-pro', 'gpt-5.2', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'], image: ['gpt-4o', 'gpt-4-turbo']
        }
    },
    [MODEL_PROVIDER.GEMINI]: {
        name: MODEL_PROVIDER.GEMINI, models:
            { text: ['gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro'], image: ['gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro'] }
    }
};


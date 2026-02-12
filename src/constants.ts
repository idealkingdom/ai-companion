export const EXTENSION_NAME = 'ai-companion';


export enum MODEL_PROVIDER {
    OPEN_AI = 'OpenAI',
    GEMINI = 'Gemini'
}

export const MODEL_PROVIDER_OPTIONS: Record<string, { name: string; value: MODEL_PROVIDER }> = {
    [MODEL_PROVIDER.OPEN_AI]: { name: MODEL_PROVIDER.OPEN_AI, value: MODEL_PROVIDER.OPEN_AI },
    [MODEL_PROVIDER.GEMINI]: { name: MODEL_PROVIDER.GEMINI, value: MODEL_PROVIDER.GEMINI }
};


export const STATIC_MODELS: Record<string, { text: string[]; image: string[] }> = {
    [MODEL_PROVIDER.OPEN_AI]: {
        text: ['gpt-5', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
        image: ['gpt-4o', 'gpt-4-turbo']
    },
    [MODEL_PROVIDER.GEMINI]: {
        text: ['gemini-3.5-pro', 'gemini-2.5-pro'],
        image: ['gemini-3.5-pro', 'gemini-2.5-pro']
    }
};
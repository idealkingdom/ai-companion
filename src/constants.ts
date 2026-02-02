export const EXTENSION_NAME = 'ai-companion';


export enum MODEL_PROVIDER {
    OPEN_AI = 'OpenAI',
}

export const STATIC_MODELS: Record<string, { text: string[]; image: string[] }> = {
    'OpenAI': {
        text: ['gpt-5', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
        image: ['gpt-4o', 'gpt-4-turbo']
    },
    'Gemini': {
        text: ['gemini-3.5-pro', 'gemini-2.5-pro'],
        image: ['gemini-3.5-pro', 'gemini-2.5-pro']
    }
};
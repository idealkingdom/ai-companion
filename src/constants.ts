export const EXTENSION_NAME = 'ai-companion';


export enum MODEL_PROVIDER {
    OPEN_AI = 'OpenAI',
    GEMINI = 'Gemini'
}

export const MODEL_PROVIDER_OPTIONS:
    Record<string, { name: string; models: { text: string[]; image: string[] } }>
    = require('../models.json');


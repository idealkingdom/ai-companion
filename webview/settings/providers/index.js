import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';

class Registry {
    constructor() {
        this.providers = {
            'OpenAI': new OpenAIProvider(),
            'Gemini': new GeminiProvider()
        };
    }

    get(name) {
        return this.providers[name] || this.providers['OpenAI'];
    }

    getAll() {
        return Object.values(this.providers);
    }
}

export const ProviderRegistry = new Registry();

import { BaseProvider } from './base.js';

export class OpenAIProvider extends BaseProvider {
    constructor() {
        super('OpenAI');
    }

    getDefaults() {
        return {
            apiKey: '',
            baseUrl: 'https://api.openai.com/v1',
            textModel: 'gpt-4o',
            imageModel: 'gpt-4o'
        };
    }
}

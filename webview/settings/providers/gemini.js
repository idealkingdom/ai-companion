import { BaseProvider } from './base.js';

export class GeminiProvider extends BaseProvider {
    constructor() {
        super('Gemini');
    }

    getDefaults() {
        return {
            apiKey: '',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            textModel: 'gemini-1.5-pro',
            imageModel: 'gemini-1.5-flash-8b'
        };
    }
}

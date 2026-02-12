/**
 * Base class for model providers to ensure consistent interface.
 */
export class BaseProvider {
    constructor(name) {
        this.name = name;
    }

    /**
     * Returns the default settings for this provider.
     * @returns {Object} { apiKey, baseUrl, textModel, imageModel }
     */
    getDefaults() {
        return {
            apiKey: '',
            baseUrl: '',
            textModel: '',
            imageModel: ''
        };
    }

    /**
     * Returns the target models based on defaults or fallbacks.
     * @returns {Object} { text, image }
     */
    getModels() {
        return {
            text: '',
            image: ''
        };
    }
}

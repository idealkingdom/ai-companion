import { ChatOpenAI } from '@langchain/openai';
import { outputChannel } from '../logger';

/**
 * Updated to accept an Array of messages for context awareness.
 */
export async function openAIRequest(
    messages: { role: string; content: string }[], // <--- CHANGED: Accepts array
    model: string, 
    accessToken: string,
    temperature: number
): Promise<any> {

    const chat = new ChatOpenAI({
        model: model,
        openAIApiKey: accessToken,
        temperature: temperature,
        streamUsage: false
    });

    try {
        // LangChain accepts the standard OpenAI message format:
        // [{ role: 'system', ... }, { role: 'user', ... }, { role: 'assistant', ... }]
        return await chat.invoke(messages);
    } catch(error){
        outputChannel.appendLine("Error during OpenAI Request: " + error);
        throw error; // Rethrow so the caller knows it failed
    }
}
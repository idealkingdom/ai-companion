import { ChatOpenAI } from '@langchain/openai';
import { outputChannel } from '../logger';

// Request with OpenAI provider
export async function openAIRequest(message: string, model: string, accessToken: string, temperature: number): Promise<any> {

    const system_prompt = `You are an expert code assistant, you will answer coding relevant topic only`;

    const user_prompt = `user_prompt: ${message}`;

    const chat = new ChatOpenAI({
        model: model,
        openAIApiKey: accessToken,
        temperature: temperature,
        streamUsage: false
    });
    try {
        return await chat.invoke([

        { role: 'system', content: system_prompt },
        { role: 'user', content: user_prompt },

    ]);
    } catch(error){
        outputChannel.appendLine("Error during OpenAI Request: ", error);
    }
    
}
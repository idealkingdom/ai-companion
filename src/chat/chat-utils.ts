    import { ChatHistory } from "./chat-history";
import { ChatViewProvider } from "./chat-view-provider";
    


    export function generateChatID():string {
        //we are making sure that the value generated ID is not in our file, thou it's unlikely.
        let generatedID:string;
        if(ChatHistory.getChatHistory() === undefined){
            return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        }
        do{
            generatedID = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        }
        while(generatedID in ChatHistory.getChatHistory());
        return generatedID;
    }

    


    // to parse and group ndJSON
    export function ndJSONParse(data:String, key:string) {
        const returningData:{[key:string]: any[]}= {};
        // Parse and group
        const lines = data.split('\n').filter(line => line.trim() !== '');
        for (const line of lines){
            const entry = JSON.parse(line);
            const gkey = entry[key];
            if (!returningData[gkey]) {
                returningData[gkey] = [];
            }
            returningData[gkey].push(entry);
        }
        return returningData;
    }
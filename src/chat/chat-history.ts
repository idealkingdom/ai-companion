import * as vscode from 'vscode';
import { ChatViewProvider } from "./chat-view-provider";
import { CHAT_COMMANDS, ROLE, StoredMessage, Conversation } from "./chat-constants";


export class ChatHistoryService{


    private static readonly STORAGE_KEY = 'spes_chat_history_v1';

    // Dependency Injection: We inject the storage mechanism here.
    // context.globalState implements vscode.Memento
    constructor(private readonly storage: vscode.Memento) {}


    /**
     * Generating a simple unique ID
     */
    private static generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    /**
     * Get all raw history
     */
    public getHistory(): Conversation[] {
        return this.storage.get<Conversation[]>(ChatHistoryService.STORAGE_KEY, []);
    }

    
    /**
     * Get a specific conversation by ID
     */
    public getConversation(chatId: string): Conversation | undefined {
        return this.getHistory().find(c => c.chat_id === chatId);
    }


    /**
     * Clear all history
     */
    public async clear(): Promise<void> {
        await this.storage.update(ChatHistoryService.STORAGE_KEY, []);
    }



    /**
     * Main Logic: Save a message
     */
    public async addMessage(chatId: string, role: ROLE, messageText: string): Promise<StoredMessage> {
        let history = this.getHistory();
        const timestamp = new Date().toISOString();
        let chatIndex = history.findIndex(c => c.chat_id === chatId);

        // Create the message object
        const newMessage: StoredMessage = {
            message_id: ChatHistoryService.generateId(),
            role: role,
            message: messageText,
            timestamp: timestamp
        };

        if (chatIndex === -1) {
            // --- Create New Chat ---
            const newChat: Conversation = {
                chat_id: chatId,
                // Title logic: User message = title, AI message = "New Chat"
                title: role === ROLE.USER ? messageText.substring(0, 40) + (messageText.length > 40 ? "..." : "") : "New Chat",
                timestamp: timestamp,
                messages: [newMessage]
            };
            // Add to top
            history.unshift(newChat);
        } else {
            // --- Update Existing Chat ---
            const chat = history[chatIndex];
            chat.messages.push(newMessage);
            chat.timestamp = timestamp;

            // Update title if it's still generic and the user typed something
            if (chat.title === "New Chat" && role === ROLE.USER) {
                chat.title = messageText.substring(0, 40) + (messageText.length > 40 ? "..." : "");
            }

            // Move to top (Most Recent)
            history.splice(chatIndex, 1);
            history.unshift(chat);
        }

        await this.storage.update(ChatHistoryService.STORAGE_KEY, history);
        return newMessage;
    }

    /**
     * DELETE a specific conversation
     */
    public async deleteConversation(chatId: string): Promise<void> {
        let history = this.getHistory();
        // Filter out the specific ID
        const newHistory = history.filter(c => c.chat_id !== chatId);
        await this.storage.update(ChatHistoryService.STORAGE_KEY, newHistory);
    }


    /**
     * SEARCH history
     * Returns formatted groups matching the query
     */
    public searchHistory(query: string) {
        const history = this.getHistory();
        const lowerQuery = query.toLowerCase();

        // Filter logic: Check title OR message content
        const filtered = history.filter(chat => {
            const titleMatch = chat.title.toLowerCase().includes(lowerQuery);
            // Optional: Deep search inside messages (can be slow if history is huge)
            // const msgMatch = chat.messages.some(m => m.message.toLowerCase().includes(lowerQuery));
            return titleMatch; // || msgMatch;
        });

        // Reuse your existing formatting logic for the filtered result
        return this.formatGroups(filtered);
    }

    /**
     * Format Data for Webview
     * This returns the data structure the frontend needs, 
     * instead of sending the message directly. Separation of concerns!
     */
    /**
     * Refactored Formatting Helper
     * (Move your existing getFormattedHistoryGroups logic here so 'search' can use it too)
     */
    private formatGroups(historyList: Conversation[]) {
         const groups: { [key: string]: any[] } = {};

        historyList.forEach(chat => {
            const date = new Date(chat.timestamp);
            let dateKey = date.toDateString(); 
            if (dateKey === new Date().toDateString()) dateKey = "Today";

            if (!groups[dateKey]) groups[dateKey] = [];

            groups[dateKey].push({
                id: chat.chat_id,
                title: chat.title,
                time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        });

        return Object.keys(groups).map(dateTitle => ({
            title: dateTitle,
            chats: groups[dateTitle]
        }));
    }

    public getFormattedHistoryGroups() {
        return this.formatGroups(this.getHistory());
    }
}
  

/**
 * This script adds event listeners for the history view.
 * It assumes 'vscode', 'sendMessage', and 'showChatView'
 * are defined globally by Chatbox.js.
 */
window.addEventListener('DOMContentLoaded', () => {
    
    const backToChatButton = document.getElementById('back-to-chat-btn');
    const clearHistoryButton = document.getElementById('clear-history-btn');
    const historyListContainer = document.getElementById('history-list-container');

    if (backToChatButton) {
        backToChatButton.addEventListener('click', () => {
            // This function is defined in Chatbox.js
            showChatView();
        });
    }

    if (clearHistoryButton) {
        // 2. Clear History Button Click
        clearHistoryButton.addEventListener('click', () => {
            // Update: Use CHAT_COMMANDS.HISTORY_CLEAR
            sendMessage(CHAT_COMMANDS.HISTORY_CLEAR);
            historyListContainer.innerHTML = '<div class="empty-message">History cleared.</div>';
        });
    }

    if (historyListContainer) {
        // 3. Load Specific Chat (Click on History Item)
            console.log("HISTORY LIST CONTAINER CLICKED");
            historyListContainer.addEventListener('click', (e) => {
            // 1. CHECK IF "X" BUTTON WAS CLICKED
            const deleteBtn = e.target.closest('.delete-item-btn');
            if (deleteBtn) {
                e.stopPropagation(); // Prevent opening the chat
                
                const item = deleteBtn.closest('.history-item');
                const chatId = item.dataset.chatId;
                
                sendMessage(CHAT_COMMANDS.CONVERSATION_DELETE, { chatId: chatId });

                // delete the item from the DOM
                item.remove();
                return;
            }

            // 2. OTHERWISE, OPEN THE CHAT
            const item = e.target.closest('.history-item');
            if (item) {
                const chatId = item.dataset.chatId;
                sendMessage(CHAT_COMMANDS.CHAT_LOAD, { chatId: chatId });
            }
        });
    }


});
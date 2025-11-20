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
        // Handle clicks on the history list using event delegation
        historyListContainer.addEventListener('click', (e) => {
            const item = e.target.closest('.history-item');
            if (item) {
                const chatId = item.dataset.chatId;
                if (chatId) {
                    // This function is defined in Chatbox.js
                    sendMessage('loadChat', { chatId: chatId });
                    // The 'resetChat' message from the extension
                    // will automatically call showChatView()
                }
            }
        });
    }
});
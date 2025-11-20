/**
 * This script adds event listeners for the history view.
 * It assumes 'vscode', 'sendMessage', and 'showChatView'
 * are defined globally by Chatbox.js.
 */
window.addEventListener('DOMContentLoaded', () => {
    
    const backToChatButton = document.getElementById('back-to-chat-btn');
    const clearHistoryButton = document.getElementById('clear-history-btn');
    const historyListContainer = document.getElementById('history-list-container');
    const searchInput = document.getElementById('history-search-input');


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


    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.trim().toLowerCase();
            const groups = document.querySelectorAll('.history-group');
            let totalVisibleItems = 0;

            groups.forEach(group => {
                const items = group.querySelectorAll('.history-item');
                let visibleInGroup = 0;

                items.forEach(item => {
                    const titleEl = item.querySelector('.history-item-title');
                    // We read the raw text content (ignoring previous highlights)
                    const originalText = titleEl.textContent;

                    if (searchTerm === "") {
                        // RESET: If search is empty, just show original text
                        // (We re-escape it to be safe)
                        titleEl.innerHTML = escapeHtml(originalText);
                        item.style.display = 'flex';
                        visibleInGroup++;
                        totalVisibleItems++;
                    } 
                    else if (originalText.toLowerCase().includes(searchTerm)) {
                        // MATCH: Highlight the term
                        item.style.display = 'flex';
                        
                        // 1. Escape the whole text first (security)
                        const safeText = escapeHtml(originalText);
                        
                        // 2. Create regex for case-insensitive match
                        // We escape the search term to prevent regex errors (e.g. if user types "?")
                        const regex = new RegExp(`(${escapeRegExp(searchTerm)})`, 'gi');
                        
                        // 3. Replace match with highlighted span
                        titleEl.innerHTML = safeText.replace(regex, '<span class="highlight">$1</span>');
                        
                        visibleInGroup++;
                        totalVisibleItems++;
                    } else {
                        // NO MATCH: Hide
                        item.style.display = 'none';
                        // Optional: Reset text so it looks normal if unhidden later
                        titleEl.innerHTML = escapeHtml(originalText); 
                    }
                });

                // Toggle Group Header
                if (visibleInGroup > 0) {
                    group.style.display = 'block';
                } else {
                    group.style.display = 'none';
                }
            });

            // Handle Empty State
            let noResultsMsg = document.getElementById('no-search-results');
            if (totalVisibleItems === 0 && searchTerm.length > 0) {
                if (!noResultsMsg) {
                    noResultsMsg = document.createElement('div');
                    noResultsMsg.id = 'no-search-results';
                    noResultsMsg.className = 'empty-message';
                    noResultsMsg.innerText = 'No conversations found.';
                    historyContainer.appendChild(noResultsMsg);
                }
                noResultsMsg.style.display = 'block';
            } else if (noResultsMsg) {
                noResultsMsg.style.display = 'none';
            }
        });
    }

    // --- HELPER: Escape Regex Characters ---
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

});
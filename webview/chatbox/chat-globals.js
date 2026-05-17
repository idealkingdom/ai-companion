// --- GLOBALS (accessible by history.js) ---
const vscode = acquireVsCodeApi();
// Injected constants from the extension, ignore the error this would be replaced by our extension.
if (typeof window.VS_CONSTANTS === 'string') {
    try {
        window.VS_CONSTANTS = JSON.parse(window.VS_CONSTANTS);
    } catch (e) {
        console.error('Failed to parse VS_CONSTANTS:', e);
        window.VS_CONSTANTS = {};
    }
}
console.log('VS_CONSTANTS:', window.VS_CONSTANTS);
// Extract the constants injected by the backend
const { CHAT_COMMANDS, ROLE } = window.VS_CONSTANTS || {};

// Apply external media setting to context menu button
function applyExternalMediaSetting(allowed) {
    const mediaBtn = document.querySelector('.context-item[data-type="media"]');
    if (mediaBtn) {
        if (allowed === false) {
            mediaBtn.style.opacity = '0.35';
            mediaBtn.style.pointerEvents = 'none';
            mediaBtn.title = 'External media disabled in settings';
        } else {
            mediaBtn.style.opacity = '';
            mediaBtn.style.pointerEvents = '';
            mediaBtn.title = '';
        }
    }
}
// Apply on load
const _uiInit = (window.VS_CONSTANTS || {}).UI || {};
applyExternalMediaSetting(_uiInit.allowExternalMedia);

/**
 * Sends a message to the VS Code extension.
 * @param {string} command - The command to execute.
 * @param {any} [data] - Optional data to send.
 */
function sendMessage(command, data = '') {
    vscode.postMessage({
        command: command,
        data: data
    });
}

// --- GLOBALS ---
const chatbox = document.getElementById("chatMessages");
const chatLog = document.getElementById("chatLog");

const chatWelcomeMessage = document.getElementById("chatWelcomeMessage");
const sendButton = document.getElementById('sendButton');
const chatMessage = document.getElementById('messageInput');
const attachmentsPreviewContainer = document.getElementById('attachments-preview-container');
const imageUploadInput = document.getElementById('image-upload-input');
const chatView = document.getElementById('chat-view');
const historyView = document.getElementById('history-view');
const historyListContainer = document.getElementById('history-list-container');
const copyCodeBtnHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg> Copy`;
const aiIconBtnHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="url(#spesGradBubble)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="ai-premium-logo">
  <defs>
    <linearGradient id="spesGradBubble" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00f2fe" />
      <stop offset="100%" stop-color="#4facfe" />
    </linearGradient>
  </defs>
  <path d="M12 2L2 7v10l10 5 10-5V7L12 2z"/>
  <path d="M12 22V12"/>
  <path d="M12 12L2 7"/>
  <path d="M12 12l10-5"/>
</svg>`;
const contextMenu = document.getElementById('context-menu');
const attachBtn = document.getElementById('atch-ctx-button');




/**
 * Stores attached images as objects
 * @type {Array<{dataUrl: string, name: string}>}
 */

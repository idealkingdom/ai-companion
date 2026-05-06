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
let attachedImages = [];
let attachedFiles = [];

// --- AUTOCOMPLETE STATE ---
const { COMMANDS = [], WORKFLOWS = [], AGENTS = [] } = window.VS_CONSTANTS || {};
const autocompleteMenu = document.getElementById('autocomplete-menu');

// --- MODE SWITCHER INITIALIZATION ---
const modeDropdown = document.getElementById('modeDropdown');
const modeSelected = document.getElementById('modeSelected');
const modeOptions = document.getElementById('modeOptions');

let activeAgentId = 'default';

function renderAgentDropdown(agents) {
    if (!modeDropdown || !modeOptions) { return; }
    // Remove all dynamically added agent options (keep the first "Chat" option)
    const existingAgentOpts = modeOptions.querySelectorAll('.mode-option:not([data-value="default"])');
    existingAgentOpts.forEach(opt => opt.remove());

    (agents || []).forEach(agent => {
        if (!agent.isActive) { return; }
        const opt = document.createElement('div');
        opt.className = 'mode-option';
        opt.dataset.value = agent.id;
        const agentIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
        opt.innerHTML = `<span class="mode-icon">${agentIcon}</span> ${escapeHtml(agent.name)}`;
        modeOptions.appendChild(opt);
    });
}

// Initial render
renderAgentDropdown(AGENTS);

// Dropdown Interactions
if (modeDropdown) {
    // Open/Close
    modeSelected.addEventListener('click', (e) => {
        e.stopPropagation();
        modeOptions.classList.toggle('hidden');
        modeDropdown.classList.toggle('open');
    });

    // Select Option
    modeOptions.addEventListener('click', (e) => {
        const option = e.target.closest('.mode-option');
        if (!option) { return; }

        updateActiveAgentUI(option.dataset.value);

        // Hide
        modeOptions.classList.add('hidden');
        modeDropdown.classList.remove('open');
    });

    // Close on outside click
    document.addEventListener('click', () => {
        if (modeOptions && !modeOptions.classList.contains('hidden')) {
            modeOptions.classList.add('hidden');
            modeDropdown.classList.remove('open');
        }
    });
}

// --- PREMIUM HEADER WIRING ---
function updateContextCountPill() {
    const pill = document.getElementById('count-context');
    if (!pill) return;

    const attachedCount = (attachedFiles ? attachedFiles.length : 0) + (attachedImages ? attachedImages.length : 0);
    const inlinePills = document.querySelectorAll('.inline-attachment-pill').length;
    pill.textContent = attachedCount + inlinePills;
}

// Observe context changes to update pill
const observer = new MutationObserver(() => updateContextCountPill());
const previewContainer = document.getElementById('attachments-preview-container');
const messageBox = document.getElementById('messageInput');

if (previewContainer) observer.observe(previewContainer, { childList: true });
if (messageBox) observer.observe(messageBox, { childList: true, subtree: true });

// Initial count
updateContextCountPill();

// --- TOOLBAR DROPDOWNS INITIALIZATION ---
let { MODELS, PERMISSIONS, UI } = window.VS_CONSTANTS || {};

let uiStyleNode = null;

function applyUISettings(uiData) {
    if (!uiData) return;

    if (!uiStyleNode) {
        uiStyleNode = document.createElement('style');
        document.head.appendChild(uiStyleNode);
    }

    let styleRules = uiData.customCss || '';

    uiStyleNode.innerHTML = styleRules;
}

if (UI) {
    applyUISettings(UI);
}

const toolbarModelBtn = document.getElementById('toolbar-model-btn');
const modelOptionsMenu = document.getElementById('model-options-menu');
const currentModelLabel = document.getElementById('current-model-label');

const toolbarPermsBtn = document.getElementById('toolbar-perms-btn');
const permsOptionsMenu = document.getElementById('perms-options-menu');

const tbReadPerm = document.getElementById('tb-read-perm');
const tbWritePerm = document.getElementById('tb-write-perm');
const tbCmdPerm = document.getElementById('tb-cmd-perm');

function initModelDropdown() {
    if (!MODELS || !currentModelLabel || !modelOptionsMenu) return;

    modelOptionsMenu.innerHTML = ''; // clear previous options

    const providerSettings = MODELS.providerSettings?.[MODELS.provider] || {};
    let initialModel = providerSettings.textModel || MODELS.textModel;

    const customModels = window.VS_CONSTANTS.CUSTOM_MODELS || [];
    const inactiveModels = MODELS.inactiveModels || [];

    let availableModels = []; // Array of { name, provider }
    let isValidModel = false;

    // Add built-in models from all providers
    const availableProviders = window.VS_CONSTANTS.AVAILABLE_MODELS || {};
    for (const [prov, data] of Object.entries(availableProviders)) {
        if (data && data.models && data.models.text) {
            data.models.text.forEach(m => {
                if (!inactiveModels.includes(m)) {
                    availableModels.push({ name: m, provider: prov });
                }
            });
        }
    }

    // Add active custom models
    customModels.forEach(cm => {
        if (cm.isActive !== false) {
            if (!availableModels.find(m => m.name === cm.name)) {
                availableModels.push({ name: cm.name, provider: cm.provider });
            }
        }
    });

    availableModels.forEach(modelObj => {
        const m = modelObj.name;

        // Ensure initialModel is valid
        if (m === initialModel) {
            isValidModel = true;
        }

        const btn = document.createElement('button');
        btn.className = 'context-item';
        btn.innerHTML = `<span>${m}</span>`;
        btn.addEventListener('click', () => {
            currentModelLabel.textContent = m;

            // Update providerSettings
            MODELS.provider = modelObj.provider;
            MODELS.textModel = m;
            const pSettings = MODELS.providerSettings || {};
            if (!pSettings[modelObj.provider]) pSettings[modelObj.provider] = {};
            pSettings[modelObj.provider].textModel = m;

            sendMessage('updateCategorySettings', {
                category: 'models',
                settings: {
                    provider: modelObj.provider,
                    textModel: m,
                    providerSettings: pSettings
                }
            });

            modelOptionsMenu.classList.add('hidden');
        });
        modelOptionsMenu.appendChild(btn);
    });

    if (!isValidModel && availableModels.length > 0) {
        initialModel = availableModels[0].name;
        MODELS.provider = availableModels[0].provider;
        const pSettings = MODELS.providerSettings || {};
        if (!pSettings[MODELS.provider]) pSettings[MODELS.provider] = {};
        pSettings[MODELS.provider].textModel = initialModel;

        sendMessage('updateCategorySettings', {
            category: 'models',
            settings: {
                provider: MODELS.provider,
                textModel: initialModel,
                providerSettings: pSettings
            }
        });
    }
    currentModelLabel.textContent = initialModel || 'Unknown';
}

if (MODELS && currentModelLabel && modelOptionsMenu) {
    initModelDropdown();

    toolbarModelBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        // Request fresh model data from backend every time the dropdown is opened
        sendMessage('requestModels', {});

        modelOptionsMenu.classList.toggle('hidden');
        if (permsOptionsMenu) permsOptionsMenu.classList.add('hidden');
        contextMenu.classList.add('hidden');
    });
}

if (PERMISSIONS && toolbarPermsBtn && permsOptionsMenu) {
    tbReadPerm.value = PERMISSIONS.readFilesConfirmation ? 'ask' : 'auto';
    tbWritePerm.value = PERMISSIONS.writeFilesConfirmation ? 'ask' : 'auto';
    tbCmdPerm.value = PERMISSIONS.runCommandsConfirmation ? 'ask' : 'auto';

    tbWritePerm.addEventListener('change', (e) => {
        const isAuto = e.target.value === 'auto';
        sendMessage('updateNestedSetting', { category: 'permissions', key: 'writeFilesConfirmation', value: !isAuto });
        // If file writing and edits is enabled (auto mode), auto file reading is enabled
        if (isAuto) {
            tbReadPerm.value = 'auto';
            sendMessage('updateNestedSetting', { category: 'permissions', key: 'readFilesConfirmation', value: false });
        }
    });

    tbReadPerm.addEventListener('change', (e) => {
        const isAuto = e.target.value === 'auto';
        sendMessage('updateNestedSetting', { category: 'permissions', key: 'readFilesConfirmation', value: !isAuto });
    });

    tbCmdPerm.addEventListener('change', (e) => {
        const isAuto = e.target.value === 'auto';
        sendMessage('updateNestedSetting', { category: 'permissions', key: 'runCommandsConfirmation', value: !isAuto });
    });

    toolbarPermsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        permsOptionsMenu.classList.toggle('hidden');
        if (modelOptionsMenu) modelOptionsMenu.classList.add('hidden');
        contextMenu.classList.add('hidden');
    });
}

document.addEventListener('click', (e) => {
    if (modelOptionsMenu && !modelOptionsMenu.contains(e.target) && !toolbarModelBtn.contains(e.target)) {
        modelOptionsMenu.classList.add('hidden');
    }
    if (permsOptionsMenu && !permsOptionsMenu.contains(e.target) && !toolbarPermsBtn.contains(e.target)) {
        permsOptionsMenu.classList.add('hidden');
    }
});
let autocompleteActive = false;
let autocompleteType = null; // '@' or '/'
let selectedIndex = 0;
let filteredItems = [];
let triggerQuery = '';

// --- HELPER FUNCTIONS ---

function updateAutocompleteItems(text) {
    const query = text.toLowerCase();

    if (autocompleteType === '@') {
        if (query.length > 0) {
            // Request files from backend dynamically
            vscode.postMessage({
                command: 'searchWorkspaceFiles',
                data: { query: text }
            });
            return;
        } else {
            filteredItems = COMMANDS;
        }
    } else {
        filteredItems = WORKFLOWS.filter(item =>
            item.label.toLowerCase().includes(query) ||
            item.description.toLowerCase().includes(query)
        );
    }

    if (filteredItems.length === 0) {
        hideAutocomplete();
        return;
    }

    selectedIndex = Math.min(selectedIndex, filteredItems.length - 1);
    renderAutocomplete();
}

function renderAutocomplete() {
    autocompleteMenu.innerHTML = '';
    filteredItems.forEach((item, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = `autocomplete-item ${index === selectedIndex ? 'selected' : ''}`;
        itemEl.innerHTML = `
            <span class="autocomplete-label">${escapeHtml(item.label)}</span>
            <span class="autocomplete-description">${escapeHtml(item.description)}</span>
        `;
        itemEl.addEventListener('click', () => {
            selectedIndex = index;
            confirmAutocompleteSelection();
        });
        autocompleteMenu.appendChild(itemEl);
    });

    autocompleteMenu.classList.remove('hidden');
    autocompleteActive = true;

    // Ensure selected item is visible if scrolling is needed
    const selectedEl = autocompleteMenu.children[selectedIndex];
    if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
    }
}

function hideAutocomplete() {
    autocompleteMenu.classList.add('hidden');
    autocompleteMenu.innerHTML = '';
    autocompleteActive = false;
    autocompleteType = null;
    triggerQuery = '';
    selectedIndex = 0;
}

function confirmAutocompleteSelection() {
    const item = filteredItems[selectedIndex];
    if (!item) { return; }

    const text = chatMessage.innerText;
    const cursorPosition = getCaretPosition(chatMessage);

    // Find the trigger position (backwards from cursor)
    const textBeforeCursor = text.substring(0, cursorPosition);
    const triggerIndex = textBeforeCursor.lastIndexOf(autocompleteType);

    if (triggerIndex !== -1) {
        // Special Handling for @file and @workspace
        // Safe removal of trigger token without destroying other HTML elements (pills)
        const deleteLength = 1 + (triggerQuery ? triggerQuery.length : 0);
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (range.startContainer.nodeType === Node.TEXT_NODE) {
                const startOffset = Math.max(0, range.startOffset - deleteLength);
                range.setStart(range.startContainer, startOffset);
                range.deleteContents();
            } else {
                for (let i = 0; i < deleteLength; i++) {
                    document.execCommand('delete', false, null);
                }
            }
        }

        if (item.label === '@file') {
            sendMessage(CHAT_COMMANDS.ADD_CONTEXT, { type: 'pickFile' });
        } else if (item.label === '@workspace') {
            sendMessage(CHAT_COMMANDS.ADD_CONTEXT, { type: 'workspace' });
        } else if (item.path) {
            // User selected a specific file from search results
            vscode.postMessage({
                command: 'addFileByPath',
                data: { path: item.path }
            });
        } else {
            // Normal insertion for workflows and other commands
            document.execCommand('insertHTML', false, item.label + '&nbsp;');
        }
    }

    hideAutocomplete();
}

/**
 * Gets the current caret position in a contenteditable element.
 */
function getCaretPosition(element) {
    let position = 0;
    const isSupported = typeof window.getSelection !== "undefined";
    if (isSupported) {
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const preCaretRange = range.cloneRange();
            preCaretRange.selectNodeContents(element);
            preCaretRange.setEnd(range.endContainer, range.endOffset);
            position = preCaretRange.toString().length;
        }
    }
    return position;
}

/**
 * Sets the caret position in a contenteditable element.
 */
function setCaretPosition(element, offset) {
    const range = document.createRange();
    const sel = window.getSelection();

    // This is a simplified version for plain text contenteditables
    let currentOffset = 0;
    let node = element.firstChild || element;

    // If no text node yet, we can't set offset
    if (node.nodeType !== 3) {
        element.focus();
        return;
    }

    range.setStart(node, Math.min(offset, node.textContent.length));
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    element.focus();
}


// --- VIEW SWITCHING FUNCTIONS (Global) ---

/**
 * Hides the history view and shows the main chat view.
 */
function showChatView() {
    historyView.classList.remove('active-view');
    chatView.classList.add('active-view');
    chatMessage.focus(); // Focus the input
}


/**
 * Hides the chat view and shows the history view, populating it with data.
 * @param {Array<Object>} historyGroups - Data from the extension
 */
function showHistoryView(historyGroups) {
    historyListContainer.innerHTML = ''; // Clear old history


    try {
        if (!historyGroups || historyGroups.length === 0) {
            historyListContainer.innerHTML = '<div class="empty-message">No chat history found.</div>';
        } else {
            for (const group of historyGroups) {
                const groupEl = document.createElement('div');
                groupEl.className = 'history-group';
                const titleEl = document.createElement('h3');
                titleEl.className = 'history-group-title';
                titleEl.textContent = group.title;
                groupEl.appendChild(titleEl);

                for (const item of group.chats) {
                    const itemEl = document.createElement('div');
                    itemEl.className = 'history-item';
                    itemEl.dataset.chatId = item.id;
                    const safeTitle = escapeHtml(item.title);
                    itemEl.innerHTML = `
        <div class="history-info">
            <span class="history-item-title" title="${safeTitle}">${safeTitle}</span>
            <span class="history-item-time">${item.time}</span>
        </div>
        <button class="delete-item-btn" title="Delete conversation">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      `;
                    groupEl.appendChild(itemEl);
                }
                historyListContainer.appendChild(groupEl);
            }
        }
    } catch (error) {
        console.error('Error rendering chat history:', error);
        historyListContainer.innerHTML = '<div class="empty-message">Error loading chat history.</div>';
    }
    // Show the view
    chatView.classList.remove('active-view');
    historyView.classList.add('active-view');
}
// --- END VIEW SWITCHING ---

// ─── #48: AGENT QUESTION STICKY BANNER ─────────────────────────────
const questionBanner = document.getElementById('agent-question-banner');
const questionText = document.getElementById('agent-question-text');
const dismissQuestionBtn = document.getElementById('dismiss-question-btn');

function showQuestionBanner(agentName) {
    if (!questionBanner) return;
    const name = agentName || 'Agent';
    questionText.textContent = `${name} is asking a question — answer to proceed`;
    questionBanner.classList.remove('hidden');
}

function hideQuestionBanner() {
    if (!questionBanner) return;
    questionBanner.classList.add('hidden');
}

/**
 * Heuristic: check if the AI's last response ends with a question.
 * Looks at the last 200 chars of the accumulated response.
 */
function detectsQuestion(text) {
    if (!text || text.length < 5) return false;
    const tail = text.trim().slice(-200);
    // Check if it ends with a question mark (ignore trailing whitespace/markdown)
    const cleaned = tail.replace(/[\s*_`#>]+$/, '');
    return cleaned.endsWith('?');
}

if (dismissQuestionBtn) {
    dismissQuestionBtn.addEventListener('click', hideQuestionBanner);
}


let isGenerating = false;

function toggleSendButton(mode = "off") {
    if (mode === "disabled") {
        sendButton.classList.add("disabled");
        sendButton.classList.remove("generating");
        sendButton.title = "Send";
        sendButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
  <path stroke-linecap="round" stroke-linejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
</svg>`;
    } else if (mode === "generating") {
        sendButton.classList.remove("disabled");
        sendButton.classList.add("generating");
        sendButton.title = "Stop Request";
        sendButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
  <path stroke-linecap="round" stroke-linejoin="round" d="M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z" />
</svg>`;
    } else {
        sendButton.classList.remove("disabled");
        sendButton.classList.remove("generating");
        sendButton.title = "Send";
        sendButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
  <path stroke-linecap="round" stroke-linejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
</svg>`;
    }
}


function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getCurrentDate() {
    const now = new Date();
    const options = {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    };
    return now.toLocaleString('en-US', options);
}

function scrollToBottom() {
    // Use rAF to ensure DOM has been painted before scrolling
    requestAnimationFrame(() => {
        chatLog.scrollTop = chatLog.scrollHeight;
        // Double-tap: after sticky elements may have resized
        setTimeout(() => {
            chatLog.scrollTop = chatLog.scrollHeight;
            // Also scroll the last element into view as a fallback
            const lastChild = chatbox.lastElementChild;
            if (lastChild) {
                lastChild.scrollIntoView({ block: 'end', behavior: 'instant' });
            }
        }, 60);
    });
}


function copyCodeToClipboard(e) {

    const button = e.currentTarget;

    const code = button.nextElementSibling.innerText;
    if (!code) {
        console.error('Could not find code element to copy.');
        return;
    }
    navigator.clipboard.writeText(code).then(() => {
        button.innerHTML = 'Copied!';
        setTimeout(() => {
            button.innerHTML = copyCodeBtnHTML;
        }, 2000);

    });


}

// Add copy buttons to all code blocks
function addAllCopyButtons() {
    const pres = document.querySelectorAll('.message-text pre');
    pres.forEach(pre => {
        if (pre.querySelector('.copy-code-btn')) { return; }

        // on click assign copyCodeToClipboard as html element
        const copyButton = document.createElement('button');
        copyButton.addEventListener('click', copyCodeToClipboard);

        copyButton.className = 'copy-code-btn';
        copyButton.innerHTML = copyCodeBtnHTML;
        copyButton.title = 'Copy code';

        copyButton.addEventListener('click', copyCodeToClipboard);

        pre.prepend(copyButton);
    });
}

// --- ATTACHMENTS HANDLING ---
function renderAttachments() {
    attachmentsPreviewContainer.innerHTML = '';

    // 1. Render Images
    attachedImages.forEach((image, index) => {
        const pill = document.createElement('div');
        pill.className = 'attachment-pill';
        pill.innerHTML = `
            <img src="${image.dataUrl}" class="attachment-image" alt="img" onclick="requestOpenImage('${image.dataUrl}')" title="Click to open">
            <span class="attachment-name">${image.name}</span>
            <button class="remove-attachment" onclick="removeImage(${index})">&times;</button>
        `;
        attachmentsPreviewContainer.appendChild(pill);
    });

    // 2. Render Files
    attachedFiles.forEach((file, index) => {
        const pill = document.createElement('div');
        pill.className = 'attachment-pill file-pill'; // Add file-pill class for styling
        pill.innerHTML = `
            <svg class="attachment-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span class="attachment-name" title="${file.name}">${file.name}</span>
            <span class="attachment-lines">${file.lines} lines</span>
            <button class="remove-attachment" onclick="removeFile(${index})">&times;</button>
        `;
        attachmentsPreviewContainer.appendChild(pill);
    });

    // Helper functions need to be global for onclick to work, 
    // OR add event listeners properly
    addRemoveListeners();

    attachmentsPreviewContainer.style.display = (attachedImages.length > 0 || attachedFiles.length > 0) ? 'flex' : 'none';
}

function addRemoveListeners() {
    // Re-attach listeners dynamically since we rebuilt HTML
    const buttons = attachmentsPreviewContainer.querySelectorAll('.remove-attachment');
    buttons.forEach((btn, i) => {
        // Simple logic: first N buttons are images, rest are files
        btn.addEventListener('click', () => {
            if (i < attachedImages.length) {
                attachedImages.splice(i, 1);
            } else {
                attachedFiles.splice(i - attachedImages.length, 1);
            }
            renderAttachments();
        });
    });
}

let pastedImageCounter = 0;
// Handle image files from input or paste
function handleImageFiles(fileList, source) {
    const files = Array.from(fileList);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));

    if (imageFiles.length > 0) {
        imageFiles.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                let name = file.name;
                if (source !== 'upload') {
                    pastedImageCounter++;
                    name = `Pasted Image ${pastedImageCounter}`;
                }
                insertInlineImage(e.target.result, name);
            };
            reader.readAsDataURL(file);
        });
    }
}

function insertInlineImage(dataUrl, name) {
    chatMessage.focus();

    // ensure cursor is inside chatMessage
    const selection = window.getSelection();
    let isInside = false;
    if (selection.rangeCount > 0) {
        let node = selection.getRangeAt(0).commonAncestorContainer;
        while (node) {
            if (node === chatMessage) { isInside = true; break; }
            node = node.parentNode;
        }
    }
    if (!isInside && typeof document.createRange !== 'undefined') {
        const range = document.createRange();
        range.selectNodeContents(chatMessage);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    const id = "pill-" + Date.now() + Math.floor(Math.random() * 1000);
    const html = `<span id="${id}" class="inline-attachment-pill" contenteditable="false" data-image="true" data-name="${escapeHtml(name)}" data-url="${dataUrl}" onclick="requestOpenImage(this.dataset.url)" title="Click to view image">[${escapeHtml(name)}]</span>&nbsp;`;

    document.execCommand('insertHTML', false, html);

    const insertedNode = document.getElementById(id);
    if (insertedNode && window.getSelection) {
        const range = document.createRange();
        if (insertedNode.nextSibling) {
            range.setStart(insertedNode.nextSibling, insertedNode.nextSibling.textContent.length);
        } else {
            range.setStartAfter(insertedNode);
        }
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        insertedNode.removeAttribute("id");
    }

    chatMessage.dispatchEvent(new Event('input', { bubbles: true }));
}

// Map to store file contents attached inline to avoid large data attributes
window.inlineFilesMap = window.inlineFilesMap || {};

function insertInlineFile(name, text, language, path) {
    chatMessage.focus();

    // ensure cursor is inside chatMessage
    const selection = window.getSelection();
    let isInside = false;
    if (selection.rangeCount > 0) {
        let node = selection.getRangeAt(0).commonAncestorContainer;
        while (node) {
            if (node === chatMessage) { isInside = true; break; }
            node = node.parentNode;
        }
    }
    if (!isInside && typeof document.createRange !== 'undefined') {
        const range = document.createRange();
        range.selectNodeContents(chatMessage);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    const id = "file-pill-" + Date.now() + Math.floor(Math.random() * 1000);
    // Store content in map
    window.inlineFilesMap[id] = { name, content: text, language, path, lines: text.split('\n').length };

    const html = `<span id="${id}" class="inline-attachment-pill file-pill" contenteditable="false" data-file-id="${id}" data-file="true" data-name="${escapeHtml(name)}" title="Attached file: ${escapeHtml(name)}" onclick="requestOpenFile(this.dataset.fileId)">[📄 ${escapeHtml(name)}]</span>&nbsp;`;

    document.execCommand('insertHTML', false, html);

    const insertedNode = document.getElementById(id);
    if (insertedNode && window.getSelection) {
        const range = document.createRange();
        if (insertedNode.nextSibling) {
            range.setStart(insertedNode.nextSibling, insertedNode.nextSibling.textContent.length);
        } else {
            range.setStartAfter(insertedNode);
        }
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        insertedNode.removeAttribute("id"); // Remove temporary ID
    }

    chatMessage.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * #46: Handle URL pill click — scrape the URL and add as context.
 * The scrape_url tool is already available to the agent, but this
 * lets users manually trigger scraping from the chat input.
 */
window.handleUrlScrape = function(pill) {
    const url = pill.dataset.url;
    if (!url) return;

    // Visual feedback
    pill.style.opacity = '0.6';
    pill.textContent = '⏳ Scraping...';

    // Ask the backend to scrape and return content
    vscode.postMessage({ command: 'scrapeUrl', url: url });

    // Listen for the result once
    const handler = (event) => {
        const msg = event.data;
        if (msg.command === 'scrapeResult' && msg.url === url) {
            window.removeEventListener('message', handler);
            if (msg.success) {
                pill.textContent = `🔗 ${msg.title || new URL(url).hostname}`;
                pill.style.opacity = '1';
                pill.classList.add('scraped');
                pill.title = `Scraped: ${msg.title} (${msg.wordCount} words)`;
                
                // Store scraped content as a file context
                const id = pill.dataset.urlId || 'url-' + Date.now();
                window.inlineFilesMap = window.inlineFilesMap || {};
                window.inlineFilesMap[id] = {
                    name: msg.title || url,
                    content: msg.content,
                    language: 'text',
                    path: url,
                    lines: msg.content.split('\n').length
                };
                pill.dataset.fileId = id;
                pill.dataset.file = 'true';
            } else {
                pill.textContent = `❌ ${new URL(url).hostname}`;
                pill.style.opacity = '0.5';
                pill.title = `Failed: ${msg.error}`;
            }
        }
    };
    window.addEventListener('message', handler);
};

function showLoadingIndicator() {
    hideLoadingIndicator();

    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading-indicator';
    loadingDiv.id = 'loading-indicator';

    loadingDiv.innerHTML = `
        <div class="message-content">
            <span class="ai-icon">${aiIconBtnHTML}</span>
            <div class="loading-dots">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;

    chatbox.appendChild(loadingDiv);
    scrollToBottom();
}

function hideLoadingIndicator() {
    const indicator = document.getElementById('loading-indicator');
    if (indicator) {
        indicator.remove();
    }
}


// --- MESSAGE HANDLING ---

function appendUserMessage(message, images = [], files = []) {

    let finalHTML = processMessageContent(message);

    if (files && files.length > 0) {
        files.forEach(file => {
            const id = "file-pill-hist-" + Date.now() + Math.floor(Math.random() * 1000);
            window.inlineFilesMap[id] = file;
            const marker = `[📄 ${escapeHtml(file.name)}]`;
            const pillHTML = `<span class="inline-attachment-pill file-pill" contenteditable="false" data-file-id="${id}" onclick="requestOpenFile(this.dataset.fileId)" title="Attached file: ${escapeHtml(file.name)}">${marker}</span>`;
            if (finalHTML.includes(marker)) {
                finalHTML = finalHTML.replace(marker, pillHTML);
            } else {
                finalHTML += ` ${pillHTML}`;
            }
        });
    }

    if (images && images.length > 0) {
        images.forEach(image => {
            const openPath = image.path || image.dataUrl;
            const marker = `[${escapeHtml(image.name)}]`;
            // Link UI logic
            const pillHTML = `<span class="inline-attachment-pill" contenteditable="false" onclick="requestOpenImage('${openPath.replace(/\\/g, '\\\\')}')" title="Click to view image">[${escapeHtml(image.name)}]</span>`;

            if (finalHTML.includes(marker)) {
                finalHTML = finalHTML.replace(marker, pillHTML);
            } else {
                finalHTML += ` ${pillHTML}`;
            }
        });
    }

    const userResponseHTML = `<div class="user-message" data-raw-text="${encodeURIComponent(message)}">
          <div class="message-content">
            <span class="message-text">${finalHTML}</span>
            <div class="message-footer">
              <div class="message-time">${getCurrentDate()}</div>
              <div class="user-message-actions">
                <button class="msg-action-btn retry-btn" title="Retry" onclick="retryLastMessage(this)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.51"/></svg>
                  Retry
                </button>
                <button class="msg-action-btn edit-btn" title="Edit & Send" onclick="editUserMessage(this)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit
                </button>
              </div>
            </div>
          </div>
        </div>`;

    if (!chatWelcomeMessage.classList.contains('hidden')) {
        chatWelcomeMessage.classList.add('hidden');
        document.querySelector('.chat-container').classList.remove('new-chat');
    }

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = userResponseHTML;

    const newMessageElement = tempDiv.firstElementChild;

    // #42: Remove sticky from previous user message, add to new one
    const prevSticky = chatbox.querySelector('.user-message.sticky-user-msg');
    if (prevSticky) {
        prevSticky.classList.remove('sticky-user-msg');
    }
    newMessageElement.classList.add('sticky-user-msg');

    chatbox.appendChild(newMessageElement);

    // Important: Since we injected new <pre> blocks inside the details, 
    // we might want to re-run syntax highlighting or copy buttons
    if (message.includes("--- ATTACHED CONTEXT ---")) {
        setTimeout(() => {
            hljs.highlightAll();
            addAllCopyButtons();
        }, 0);
    }

    scrollToBottom();
}


/**
 * Renders an Agent tool step card in the chat log.
 * Shows what the agent is doing (reading, editing, searching, etc.)
 */
function renderAgentStep(step) {
    if (!step) { return; }

    if (step.type === 'thinking') {
        // Differentiate between status messages and actual reasoning tokens
        const isStatusMessage = step.text && (
            step.text.startsWith('Agent completed') ||
            step.text.startsWith('🛑') ||
            step.text.startsWith('❌')
        );

        if (isStatusMessage) {
            // Status messages render as simple inline cards (existing behavior)
            const activeGroup = chatbox.querySelector('details.agent-steps-group:not([data-finalized="true"])');
            if (activeGroup) {
                const stepsContainer = activeGroup.querySelector('.agent-steps-container');
                if (stepsContainer && stepsContainer.children.length === 0) {
                    if (activeGroup.dataset.timer) {
                        clearInterval(parseInt(activeGroup.dataset.timer));
                    }
                    activeGroup.remove();
                }
            }

            const thinkingEl = document.createElement('div');
            thinkingEl.className = 'agent-step-card thinking';
            thinkingEl.innerHTML = `
                <div class="step-header">
                    <span class="step-icon">✦</span>
                    <span class="step-tool-name">${step.text}</span>
                </div>
            `;
            chatbox.appendChild(thinkingEl);
            scrollToBottom();
            return;
        }

        // #44: Handle __TOKENS__ sentinel (token count only, no text)
        const tokenMatch = step.text && step.text.match(/^__TOKENS__(\d+)$/);
        if (tokenMatch) {
            const tokenCount = parseInt(tokenMatch[1], 10);
            let thinkingBlock = chatbox.querySelector('.agent-thinking-block:not([data-finalized="true"])');
            if (thinkingBlock) {
                const prev = parseInt(thinkingBlock.dataset.tokens || '0', 10);
                thinkingBlock.dataset.tokens = String(prev + tokenCount);
            }
            scrollToBottom();
            return;
        }

        // SVG icon for reasoning (sparkle/brain style — matches design system)
        const thinkingIconSVG = `<span class="thinking-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v1m0 16v1m-8-9H3m18 0h-1m-2.636-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707.707"/><circle cx="12" cy="12" r="4"/></svg></span>`;

        // #44: Actual reasoning text — stream into a collapsible block
        let thinkingBlock = chatbox.querySelector('.agent-thinking-block:not([data-finalized="true"])');
        if (!thinkingBlock) {
            thinkingBlock = document.createElement('details');
            thinkingBlock.className = 'agent-thinking-block streaming';
            thinkingBlock.open = true; // auto-open during streaming
            thinkingBlock.dataset.tokens = '0';
            thinkingBlock.dataset.stepCount = '0';

            const summary = document.createElement('summary');
            summary.className = 'thinking-summary';
            summary.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="chevron"><polyline points="9 18 15 12 9 6"></polyline></svg>
                ${thinkingIconSVG}
                <span class="thinking-label">Thinking...</span>
            `;
            thinkingBlock.appendChild(summary);

            const content = document.createElement('div');
            content.className = 'thinking-content';
            thinkingBlock.appendChild(content);

            chatbox.appendChild(thinkingBlock);
        }

        // Append the reasoning text (if any — empty string for reasoning-start)
        if (step.text) {
            const contentEl = thinkingBlock.querySelector('.thinking-content');
            if (contentEl) {
                // Add step separator for multi-step reasoning
                const stepNum = parseInt(thinkingBlock.dataset.stepCount || '0', 10) + 1;
                thinkingBlock.dataset.stepCount = String(stepNum);
                if (stepNum > 1) {
                    contentEl.textContent += '\n───\n';
                }
                contentEl.textContent += step.text;
            }
            // Update label to show it's working
            const label = thinkingBlock.querySelector('.thinking-label');
            if (label) {
                label.textContent = 'Thinking...';
            }
        }
        scrollToBottom();
        return;
    }

    // Finalize any open thinking block when a non-thinking step arrives
    const openThinking = chatbox.querySelector('.agent-thinking-block:not([data-finalized="true"])');
    if (openThinking) {
        openThinking.dataset.finalized = 'true';
        openThinking.classList.remove('streaming');
        openThinking.open = false; // auto-collapse when done
        
        const label = openThinking.querySelector('.thinking-label');
        const tokens = parseInt(openThinking.dataset.tokens || '0', 10);
        const contentEl = openThinking.querySelector('.thinking-content');
        const hasText = contentEl && contentEl.textContent.trim();
        
        if (label) {
            if (hasText && tokens > 0) {
                label.textContent = `Thought for ${tokens} tokens`;
            } else if (hasText) {
                label.textContent = 'Thought process';
            } else if (tokens > 0) {
                label.textContent = `Thought for ${tokens} tokens`;
            } else {
                label.textContent = 'Thought process';
            }
        }
    }

    // Find or create the active agent steps container wrapper
    let detailsEl = chatbox.querySelector('details.agent-steps-group:not([data-finalized="true"])');
    let stepsContainer;
    if (!detailsEl) {
        hideLoadingIndicator();

        detailsEl = document.createElement('details');
        detailsEl.className = 'agent-steps-group';
        detailsEl.open = true;
        detailsEl.dataset.startTime = Date.now();

        const summary = document.createElement('summary');
        summary.className = 'agent-steps-summary';
        summary.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="chevron"><polyline points="9 18 15 12 9 6"></polyline></svg> <span class="summary-text">Working...</span>`;
        detailsEl.appendChild(summary);

        stepsContainer = document.createElement('div');
        stepsContainer.className = 'agent-steps-container';
        detailsEl.appendChild(stepsContainer);

        chatbox.appendChild(detailsEl);

        detailsEl.dataset.timer = setInterval(() => {
            const ms = Date.now() - parseInt(detailsEl.dataset.startTime);
            const secs = Math.floor(ms / 1000);
            const summaryText = summary.querySelector('.summary-text');
            if (summaryText) {
                summaryText.textContent = `Worked for ${secs}s`;
            }
        }, 1000);
    } else {
        stepsContainer = detailsEl.querySelector('.agent-steps-container');
    }

    const stepEl = (step.toolCallId && stepsContainer.querySelector(`[data-tool-call-id="${step.toolCallId}"]`)) ||
        document.createElement('div');

    if (!stepEl.parentNode) {
        stepEl.className = 'agent-step-card';
    }

    if (step.type === 'tool_call') {
        const icons = {
            'list_workspace': '○',
            'read_file_skeleton': '▢',
            'read_line_range': '▤',
            'chunk_replace': '◇',
            'create_file': '▷',
            'find_symbol': '◎',
            'run_command': '⚡',
            'search_workspace': '◈'
        };
        const icon = icons[step.toolName] || '🛠️';
        const argsPreview = step.args ? JSON.stringify(step.args).substring(0, 120) : '';

        // All tools now show as "Running" initially. 
        // Write tools will quickly flip to "Done" (Staged) when the result arrives.
        stepEl.innerHTML = `
            <div class="step-header">
                <span class="step-icon">${icon}</span>
                <span class="step-tool-name">${step.toolName}</span>
                <span class="step-status running">Running</span>
            </div>
            <div class="step-args">${argsPreview}</div>
        `;

        if (step.toolCallId) {
            stepEl.dataset.toolCallId = step.toolCallId;
            // Store args for later review
            window.pendingToolArgs = window.pendingToolArgs || {};
            window.pendingToolArgs[step.toolCallId] = step.args;

            if (step.approvalRequired && !step.diffReviewRequired) {
                stepEl.classList.add('approval-pending');
                const actionsEl = document.createElement('div');
                actionsEl.className = 'step-actions';
                actionsEl.innerHTML = `
                    <button class="approve-btn staging-btn primary" style="padding: 2px 8px; font-size: 11px;" onclick="approveTool('${step.toolCallId}', true)">Approve</button>
                    <button class="deny-btn staging-btn danger" style="padding: 2px 8px; font-size: 11px;" onclick="approveTool('${step.toolCallId}', false)">Deny</button>
                `;
                stepEl.appendChild(actionsEl);

                const statusEl = stepEl.querySelector('.step-status');
                if (statusEl) {
                    statusEl.textContent = 'Waiting for Approval';
                    statusEl.classList.remove('running');
                    statusEl.classList.add('pending');
                }
            }
        }

    } else if (step.type === 'tool_result') {
        // Find the specific card by toolCallId or fallback to last running
        let targetCard = null;
        if (step.toolCallId) {
            targetCard = stepsContainer.querySelector(`[data-tool-call-id="${step.toolCallId}"]`);
        }

        const statusEl = (targetCard || stepsContainer).querySelector('.step-status.running');
        if (statusEl) {
            const isStaged = step.result && (typeof step.result.message === 'string' && step.result.message.includes('staged'));
            statusEl.textContent = isStaged ? 'Staged' : 'Done';
            statusEl.classList.remove('running');
            statusEl.classList.add('done');
        }
        scrollToBottom();
        return;
    }

    stepsContainer.appendChild(stepEl);
    scrollToBottom();
}

/** ─── STAGING BAR LOGIC ─── **/
function updateStagingBar(count) {
    const stagingBar = document.getElementById('staging-bar');
    const stagingCount = document.getElementById('staging-count');
    const pillReviews = document.getElementById('pill-reviews');

    if (!stagingBar || !stagingCount) {
        return;
    }

    if (count > 0) {
        stagingBar.classList.remove('hidden');
        stagingCount.textContent = `${count} File${count > 1 ? 's' : ''} With Changes`;
        if (pillReviews) pillReviews.classList.add('glow');
    } else {
        stagingBar.classList.remove('hidden');
        stagingCount.textContent = `0 Files With Changes`;
        if (pillReviews) pillReviews.classList.remove('glow');
    }
}

// Global button listeners (can stay at top level but wrapped in check)
document.addEventListener('DOMContentLoaded', () => {
    const stagingReviewBtn = document.getElementById('staging-review-btn');
    const stagingApproveBtn = document.getElementById('staging-approve-btn');
    const stagingDiscardBtn = document.getElementById('staging-discard-btn');

    if (stagingReviewBtn) {
        stagingReviewBtn.onclick = () => sendMessage('chatReviewDiff', { isGlobalReview: true });
    }
    if (stagingApproveBtn) {
        stagingApproveBtn.onclick = () => sendMessage('chatToolApproval', { approved: true });
    }
    if (stagingDiscardBtn) {
        stagingDiscardBtn.onclick = () => sendMessage('chatToolApproval', { approved: false });
    }
});


window.approveTool = (toolCallId, approved) => {
    sendMessage('chatToolApproval', { toolCallId, approved });
    // Local update for immediate feedback
    updateCardApproval(toolCallId, approved);
};

function updateCardApproval(toolCallId, approved) {
    // Find the button or use direct lookup for the card
    // We look for common elements that contain the toolCallId
    const btn = document.querySelector(`.approve-btn[onclick*="${toolCallId}"], .deny-btn[onclick*="${toolCallId}"], .review-btn[onclick*="${toolCallId}"]`);
    if (btn) {
        const card = btn.closest('.agent-step-card');
        if (card) {
            card.classList.remove('approval-pending');
            const status = card.querySelector('.step-status');
            if (status) {
                status.textContent = approved ? 'Approved' : 'Denied';
                status.className = `step-status ${approved ? 'approved' : 'denied'}`;
            }
            const actions = card.querySelector('.step-actions');
            if (actions) { actions.remove(); }
        }
    }
}

window.reviewDiff = (toolCallId, toolName) => {
    try {
        console.log('Initiating ReviewDiff for:', toolCallId, toolName);
        const args = window.pendingToolArgs ? window.pendingToolArgs[toolCallId] : null;
        if (args) {
            sendMessage('chatReviewDiff', { toolCallId, toolName, args });
        } else {
            console.error('No pending args found for toolCallId:', toolCallId);
        }
    } catch (e) {
        console.error('Failed to initiate diff review', e);
    }
};

// ─── HUNK REVIEW PANEL ───────────────────────────────────────────────
let hunkReviewState = null; // { files: [...], undoStack: [] }

function openHunkReviewPanel(filesData) {
    if (!filesData || filesData.length === 0) {
        closeHunkReviewPanel();
        return;
    }

    // Initialize state
    hunkReviewState = {
        files: filesData.map(f => ({
            ...f,
            hunks: f.hunks.map(h => ({ ...h, accepted: true }))
        })),
        undoStack: [] // Stack of { fileIdx, hunkIdx, prevState }
    };

    renderHunkReviewPanel();
}

function closeHunkReviewPanel() {
    hunkReviewState = null;
    const overlay = document.getElementById('hunk-review-overlay');
    if (overlay) { overlay.remove(); }
}

function renderHunkReviewPanel() {
    if (!hunkReviewState) { return; }

    // Remove existing if present
    let overlay = document.getElementById('hunk-review-overlay');
    if (overlay) { overlay.remove(); }

    overlay = document.createElement('div');
    overlay.id = 'hunk-review-overlay';
    overlay.className = 'hunk-review-overlay';

    // Compute summary
    let totalHunks = 0;
    let acceptedHunks = 0;
    hunkReviewState.files.forEach(f => {
        f.hunks.forEach(h => {
            totalHunks++;
            if (h.accepted) { acceptedHunks++; }
        });
    });

    overlay.innerHTML = `
        <div class="hunk-review-header">
            <button class="back-btn" onclick="closeHunkReviewPanel()" title="Back to Chat">←</button>
            <h2>Review Changes (${hunkReviewState.files.length} file${hunkReviewState.files.length > 1 ? 's' : ''})</h2>
        </div>
        <div class="hunk-review-body" id="hunk-review-body">
            ${hunkReviewState.files.map((file, fileIdx) => renderFileSection(file, fileIdx)).join('')}
        </div>
        <div class="hunk-review-actions">
            <div class="hunk-action-info">
                ${acceptedHunks}/${totalHunks} changes selected
            </div>
            <div class="hunk-action-buttons">
                <button class="hunk-action-btn undo" onclick="undoHunkToggle()" title="Undo last toggle (Ctrl+Z)" ${hunkReviewState.undoStack.length === 0 ? 'disabled style="opacity:0.3;pointer-events:none"' : ''}>
                    ↶ Undo
                </button>
                <button class="hunk-action-btn discard" onclick="discardAllHunks()">
                    ✕ Reject All
                </button>
                <button class="hunk-action-btn commit" onclick="commitSelectedHunks()">
                    ✓ Save Changes (${acceptedHunks})
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
}

function renderFileSection(file, fileIdx) {
    const badge = file.isNewFile
        ? '<span class="hunk-file-badge new-file">NEW</span>'
        : '<span class="hunk-file-badge modified">MODIFIED</span>';

    const hunksHtml = file.hunks.map((hunk, hunkIdx) => renderHunkCard(hunk, fileIdx, hunkIdx)).join('');

    return `
        <div class="hunk-file-section" data-file-idx="${fileIdx}">
            <div class="hunk-file-header">
                <div class="hunk-file-name" onclick="toggleFileSection(${fileIdx})">
                    ${badge}
                    ${escapeHtml(file.fileName)}
                    <span style="opacity:0.4; font-weight:400">(${file.hunks.length} hunk${file.hunks.length > 1 ? 's' : ''})</span>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button class="hunk-toggle-btn" style="border:none; padding:2px 6px; font-size:0.7rem; opacity:0.7" onclick="event.stopPropagation(); sendMessage('chatOpenFile', { uri: '${file.uri}' })" title="Open File for Direct Review">📂 Open File</button>
                    <span class="hunk-file-toggle" onclick="toggleFileSection(${fileIdx})">▼</span>
                </div>
            </div>
            <div class="hunk-file-body">
                ${hunksHtml}
            </div>
        </div>
    `;
}

function renderHunkCard(hunk, fileIdx, hunkIdx) {
    const isAccepted = hunk.accepted;
    const cardClass = isAccepted ? '' : 'rejected';
    const location = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;

    const linesHtml = hunk.lines.map(line => {
        const prefix = line.charAt(0);
        let lineClass = 'context';
        if (prefix === '+') { lineClass = 'added'; }
        else if (prefix === '-') { lineClass = 'removed'; }
        return `<div class="hunk-diff-line ${lineClass}">${escapeHtml(line)}</div>`;
    }).join('');

    return `
        <div class="hunk-card ${cardClass}" data-file-idx="${fileIdx}" data-hunk-idx="${hunkIdx}">
            <div class="hunk-card-header">
                <span>${location}</span>
                <div class="hunk-card-actions">
                    <button class="hunk-toggle-btn accept-btn ${isAccepted ? 'active' : ''}" onclick="toggleHunk(${fileIdx}, ${hunkIdx}, true)">✓ Keep</button>
                    <button class="hunk-toggle-btn reject-btn ${!isAccepted ? 'active' : ''}" onclick="toggleHunk(${fileIdx}, ${hunkIdx}, false)">✕ Skip</button>
                </div>
            </div>
            <div class="hunk-diff-lines">
                ${linesHtml}
            </div>
        </div>
    `;
}

function toggleFileSection(fileIdx) {
    const section = document.querySelector(`.hunk-file-section[data-file-idx="${fileIdx}"]`);
    if (section) {
        section.classList.toggle('collapsed');
    }
}

function toggleHunk(fileIdx, hunkIdx, accepted) {
    if (!hunkReviewState) { return; }

    const file = hunkReviewState.files[fileIdx];
    if (!file) { return; }
    const hunk = file.hunks[hunkIdx];
    if (!hunk) { return; }

    // Save to undo stack
    hunkReviewState.undoStack.push({
        fileIdx,
        hunkIdx,
        prevState: hunk.accepted
    });

    hunk.accepted = accepted;

    // Sync with backend
    sendMessage('chatToggleHunk', { uri: file.uri, index: hunk.index, accepted });

    // Re-render efficiently (just update the card + footer)
    renderHunkReviewPanel();
}

function undoHunkToggle() {
    if (!hunkReviewState || hunkReviewState.undoStack.length === 0) { return; }

    const last = hunkReviewState.undoStack.pop();
    const file = hunkReviewState.files[last.fileIdx];
    if (file) {
        const hunk = file.hunks[last.hunkIdx];
        if (hunk) {
            hunk.accepted = last.prevState;
        }
    }

    renderHunkReviewPanel();
}

function commitSelectedHunks() {
    if (!hunkReviewState) { return; }

    const selections = hunkReviewState.files.map(file => ({
        uri: file.uri,
        acceptedIndices: file.hunks
            .filter(h => h.accepted)
            .map(h => h.index)
    }));

    sendMessage('commitSelectedHunks', { selections, action: 'commit' });
    closeHunkReviewPanel();
}

function discardAllHunks() {
    sendMessage('commitSelectedHunks', { selections: [], action: 'discard' });
    closeHunkReviewPanel();
}

// Keyboard shortcuts for hunk review panel
document.addEventListener('keydown', (e) => {
    if (!hunkReviewState) { return; }

    // Ctrl+Z / Cmd+Z = Undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undoHunkToggle();
    }

    // Escape = Close panel
    if (e.key === 'Escape') {
        e.preventDefault();
        closeHunkReviewPanel();
    }
});

function appendAIMessage(response) {
    const parsedResponse = marked.parse(response);
    const systemResponseHTML = `<div class="system-message">
            <div class="message-content">
                <div class="message-header"><span class="ai-icon">${aiIconBtnHTML}</span> Companion</div>
                <span class="message-text">${parsedResponse}</span>
                <div class="message-time">${getCurrentDate()}</div>
            </div>
            </div>`;


    if (!chatWelcomeMessage.classList.contains('hidden')) {
        chatWelcomeMessage.classList.add('hidden');
        document.querySelector('.chat-container').classList.remove('new-chat');
    }


    const tempDiv = document.createElement('div');


    tempDiv.innerHTML = systemResponseHTML;

    const newMessageElement = tempDiv.firstElementChild;

    chatbox.appendChild(newMessageElement);

    hljs.highlightAll();
    addAllCopyButtons();
    scrollToBottom();
}


function chatRequest(content) {
    sendMessage('chatRequest', content);
    appendUserMessage(content.message, content.images);
}

function updateActiveAgentUI(agentId, agentsList) {
    activeAgentId = agentId || 'default';

    const chatIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
    const agentIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
    const arrowIcon = `<svg class="dropdown-arrow" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>`;

    if (activeAgentId === 'default') {
        if (modeSelected) {
            modeSelected.innerHTML = `<span class="mode-icon">${chatIcon}</span> Chat ${arrowIcon}`;
        }
    } else {
        const agents = agentsList || (window.VS_CONSTANTS ? window.VS_CONSTANTS.AGENTS : []);
        const agent = (agents || []).find(a => a.id === activeAgentId);
        if (agent && modeSelected) {
            modeSelected.innerHTML = `<span class="mode-icon">${agentIcon}</span> ${escapeHtml(agent.name)} ${arrowIcon}`;
        } else {
            // Fallback to default if agent not found
            activeAgentId = 'default';
            if (modeSelected) {
                modeSelected.innerHTML = `<span class="mode-icon">${chatIcon}</span> Chat ${arrowIcon}`;
            }
        }
    }

    // Update selected class in dropdown
    if (modeOptions) {
        modeOptions.querySelectorAll('.mode-option').forEach(o => {
            if (o.dataset.value === activeAgentId) {
                o.classList.add('selected');
            } else {
                o.classList.remove('selected');
            }
        });
    }
}

function resetChat(content) {
    chatMessages.innerHTML = '';
    chatLog.dataset.chatId = content.uid;
    attachedImages = [];
    attachedFiles = [];
    renderAttachments();
    chatWelcomeMessage.classList.remove('hidden');
    document.querySelector('.chat-container').classList.add('new-chat');
    showChatView(); // Make sure we're on the chat view
    chatMessage.focus();

    // Reset or set agent
    updateActiveAgentUI(content.agentId);
}



/**
 * Retry: keep the user message, remove only all AI messages following it.
 */
function retryLastMessage(btn) {
    const userMsgEl = btn ? btn.closest('.user-message') : null;
    const allMessages = Array.from(chatbox.querySelectorAll('.user-message, .system-message'));
    // Start removing from the message AFTER the user message
    const startIdx = userMsgEl ? allMessages.indexOf(userMsgEl) + 1 : allMessages.length - 1;
    if (startIdx <= 0 || startIdx > allMessages.length) { return; }

    const removedCount = allMessages.length - startIdx;
    for (let i = startIdx; i < allMessages.length; i++) {
        allMessages[i].remove();
    }

    showLoadingIndicator();
    toggleSendButton('disabled');
    // removedCount messages removed, plus the user message itself needs to be re-sent = +1
    sendMessage(CHAT_COMMANDS.CHAT_RETRY, { chat_id: chatLog.dataset.chatId, count: removedCount + 1 });
}

/**
 * Edit: swap user message bubble with an inline editable textarea.
 * On cancel, restore the original bubble.
 */
function editUserMessage(btn) {
    const userMsgEl = btn.closest('.user-message');
    const rawText = decodeURIComponent(userMsgEl.dataset.rawText || '');

    // Only remove AI messages AFTER this user message (user bubble stays)
    const allMessages = Array.from(chatbox.querySelectorAll('.user-message, .system-message'));
    const startIdx = allMessages.indexOf(userMsgEl);
    const messagesAfter = allMessages.slice(startIdx + 1);
    messagesAfter.forEach(el => el.remove());
    const removedCount = messagesAfter.length + 1; // +1 = the user msg itself for history delete

    // Swap the text span for a textarea, IN-PLACE inside the existing bubble
    const textSpan = userMsgEl.querySelector('.message-text');
    const footer = userMsgEl.querySelector('.message-footer');
    const actionsDiv = userMsgEl.querySelector('.user-message-actions');

    // Build textarea to replace text span
    const ta = document.createElement('textarea');
    ta.className = 'edit-textarea';
    ta.value = rawText;
    ta.rows = Math.max(2, rawText.split('\n').length);
    textSpan.replaceWith(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    // Auto-grow helper (fallback for browsers without field-sizing support)
    function autoGrow() {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
    }
    ta.addEventListener('input', () => {
        autoGrow();
        sendBtn.disabled = !ta.value.trim();
    });
    autoGrow(); // run once on init

    // Swap action buttons to Cancel/Send
    const originalActionsHTML = actionsDiv.innerHTML;
    actionsDiv.innerHTML = `
        <button class="edit-cancel-btn">Cancel</button>
        <button class="edit-send-btn" ${!rawText.trim() ? 'disabled' : ''}>Send</button>`;

    const sendBtn = actionsDiv.querySelector('.edit-send-btn');

    // Cancel: restore everything, put back AI messages
    actionsDiv.querySelector('.edit-cancel-btn').addEventListener('click', () => {
        ta.replaceWith(textSpan);
        actionsDiv.innerHTML = originalActionsHTML;
        // Re-attach action button listeners (onclick attributes are restored via innerHTML)
        messagesAfter.forEach(el => chatbox.appendChild(el));
    });

    // Send: update bubble text, remove AI history, re-submit
    sendBtn.addEventListener('click', () => {
        const newText = ta.value.trim();
        if (!newText) { return; }

        // Restore bubble to display mode with updated text
        textSpan.innerHTML = escapeHtml(newText).replace(/\n/g, '<br>');
        ta.replaceWith(textSpan);
        userMsgEl.dataset.rawText = encodeURIComponent(newText);
        actionsDiv.innerHTML = originalActionsHTML;

        showLoadingIndicator();
        toggleSendButton('disabled');
        sendMessage(CHAT_COMMANDS.CHAT_RETRY, {
            chat_id: chatLog.dataset.chatId,
            count: removedCount,
            overrideMessage: newText
        });
    });

    scrollToBottom();
}




// 1. Send Button Click
sendButton.addEventListener("click", event => {
    if (isGenerating) {
        // Cancel ongoing request
        vscode.postMessage({
            command: 'cancelChatRequest',
            data: { chat_id: chatLog.dataset.chatId }
        });
        isGenerating = false;
        toggleSendButton("off");
        hideLoadingIndicator();

        // Immediate visual feedback: append a stopped badge
        if (activeStreamNode) {
            const stopBadge = document.createElement('div');
            stopBadge.className = 'status-badge status-stopped';
            stopBadge.style.marginTop = '8px';
            stopBadge.innerHTML = `🛑 Generation stopped by user`;
            activeStreamNode.parentElement.appendChild(stopBadge);
        }
        return;
    }
    const imagePills = chatMessage.querySelectorAll('.inline-attachment-pill[data-image="true"]');
    const dynamicAttachedImages = [];
    const usedNames = new Set();

    imagePills.forEach(pill => {
        let name = pill.dataset.name;
        let originalName = name;
        let counter = 1;
        while (usedNames.has(name)) {
            const dotRegex = /(.*)(\.[a-zA-Z0-9]+)$/;
            const match = originalName.match(dotRegex);
            if (match) {
                name = `${match[1]}_${counter}${match[2]}`;
            } else {
                name = `${originalName}_${counter}`;
            }
            counter++;
        }
        usedNames.add(name);

        if (pill.dataset.name !== name) {
            pill.dataset.name = name;
            pill.innerHTML = `[${escapeHtml(name)}]`;
        }

        dynamicAttachedImages.push({
            name: name,
            dataUrl: pill.dataset.url
        });
    });

    const filePills = chatMessage.querySelectorAll('.inline-attachment-pill[data-file="true"]');
    const dynamicAttachedFiles = [];
    filePills.forEach(pill => {
        const fileId = pill.dataset.fileId;
        const fileData = window.inlineFilesMap && window.inlineFilesMap[fileId];
        if (fileData) {
            dynamicAttachedFiles.push(fileData);
        }
    });

    const messageText = chatMessage.innerText.trim();

    // Combine inline files and externally attached files (if any still use the old method)
    const allFiles = attachedFiles.concat(dynamicAttachedFiles);

    // Update Condition: Check for files too
    if (messageText || dynamicAttachedImages.length > 0 || allFiles.length > 0) {

        // --- PREPARE PAYLOAD ---
        const payload = {
            message: messageText,
            images: dynamicAttachedImages,

            // CRITICAL: Send the attached files to the backend
            files: allFiles,

            agentId: activeAgentId,

            chat_id: chatLog.dataset.chatId,
            timestamp: new Date().toISOString()
        };

        // --- SEND ---
        sendMessage(CHAT_COMMANDS.CHAT_REQUEST, payload);

        // --- UI CLEANUP ---
        hideQuestionBanner(); // #48: Dismiss question banner on reply
        showLoadingIndicator(); // Show dots while waiting for backend echo
        toggleSendButton("disabled");

        chatMessage.innerHTML = "";

        // Clear files array
        attachedFiles = [];
        // No need to clear attachedImages since they are dynamically populated

        renderAttachments(); // Removes the file pills from the screen
    }
});

/**
 * Parses raw message text to separate user message from file attachments.
 * Returns HTML string with collapsible details.
 */
function processMessageContent(rawText) {
    const splitMarker = "--- ATTACHED CONTEXT ---";

    // 1. If no attachments, just return formatted text
    if (!rawText.includes(splitMarker)) {
        return escapeHtml(rawText).replace(/\n/g, "<br>");
    }

    // 2. Split: [User Text, The Big Code Block]
    const parts = rawText.split(splitMarker);
    const userMessage = parts[0].trim();
    const contextBlock = parts[1];

    // 3. Format User Message
    let html = escapeHtml(userMessage).replace(/\n/g, "<br>");

    // 4. Return just the user message
    return html;
}


window.addEventListener('DOMContentLoaded', () => {
    sendMessage("ChatWebviewReady");

    const input = document.getElementById("messageInput");

    input.addEventListener("keydown", (event) => {
        if (autocompleteActive) {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                selectedIndex = (selectedIndex + 1) % filteredItems.length;
                renderAutocomplete();
                return;
            }
            if (event.key === "ArrowUp") {
                event.preventDefault();
                selectedIndex = (selectedIndex - 1 + filteredItems.length) % filteredItems.length;
                renderAutocomplete();
                return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                confirmAutocompleteSelection();
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                hideAutocomplete();
                return;
            }
        }

        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendButton.click();
        }
    });

    input.addEventListener("input", (event) => {
        const text = input.innerText;
        const cursorPosition = getCaretPosition(input);
        const textBeforeCursor = text.substring(0, cursorPosition);

        // Find the last trigger character before the cursor
        const lastAt = textBeforeCursor.lastIndexOf('@');
        const lastSlash = textBeforeCursor.lastIndexOf('/');
        const lastTriggerIdx = Math.max(lastAt, lastSlash);

        if (lastTriggerIdx !== -1) {
            const potentialTrigger = textBeforeCursor[lastTriggerIdx];
            // Check if trigger is at start or preceded by whitespace
            const charBeforeTrigger = textBeforeCursor[lastTriggerIdx - 1];
            if (!charBeforeTrigger || /\s/.test(charBeforeTrigger)) {
                autocompleteType = potentialTrigger;
                triggerQuery = textBeforeCursor.substring(lastTriggerIdx + 1);

                // Query shouldn't contain spaces (if it does, user moved past the command)
                if (!/\s/.test(triggerQuery)) {
                    updateAutocompleteItems(triggerQuery);
                    return;
                }
            }
        }

        if (autocompleteActive) {
            hideAutocomplete();
        }
    });

    input.addEventListener("focusout", () => {
        if (!input.textContent.trim().length) {
            input.textContent = "";
        }
    });


    input.addEventListener("paste", (event) => {
        // 1. Stop all native pasting
        event.preventDefault();
        const clipboardData = event.clipboardData || window.clipboardData;

        // 2. Handle images
        if (clipboardData.files && clipboardData.files.length > 0) {
            if (Array.from(clipboardData.files).some(file => file.type.startsWith('image/'))) {
                handleImageFiles(clipboardData.files, 'paste');
                return;
            }
        }

        // 3. Handle Text
        const text = clipboardData.getData('text/plain');
        if (!text) { return; };

        // #46: Detect if the pasted text is a URL
        const urlPattern = /^https?:\/\/[^\s]+$/i;
        if (urlPattern.test(text.trim())) {
            const url = text.trim();
            const urlId = 'url-' + Date.now();
            const pill = `<span class="inline-attachment-pill url-pill" contenteditable="false" data-url="${url}" data-url-id="${urlId}" title="Click to scrape: ${url}" onclick="handleUrlScrape(this)">🔗 ${new URL(url).hostname}${new URL(url).pathname.substring(0, 30)}</span>&nbsp;`;
            document.execCommand('insertHTML', false, pill);
            return;
        }

        // 4. Escape the text for HTML
        const escapedText = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        // Note: We don't replace \n with <br> because our CSS
        // 'white-space: pre-wrap' already handles newlines correctly.

        // 5. Use 'insertHTML'. This command inserts our plain, escaped text
        //    and correctly adds the action to the undo/redo stack.
        setTimeout(() => {
            document.execCommand('insertHTML', false, escapedText);
        }, 50);

    });


    imageUploadInput.addEventListener('change', (e) => {
        if (e.target.files) {
            handleImageFiles(e.target.files, 'upload');
            e.target.value = null;
        }
    });


    // --- End of Listeners ---

    renderAttachments();
    input.focus();

    // Configure marked
    marked.setOptions({
        highlight: function (code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        },
        langPrefix: 'hljs language-',
        gfm: true,
        breaks: true
    });


    // Toggle Menu
    attachBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent immediate closing
        contextMenu.classList.toggle('hidden');
        if (modelOptionsMenu) modelOptionsMenu.classList.add('hidden');
        if (permsOptionsMenu) permsOptionsMenu.classList.add('hidden');
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target) && e.target !== attachBtn) {
            contextMenu.classList.add('hidden');
        }

        // Hide autocomplete if clicking outside
        if (autocompleteActive && !autocompleteMenu.contains(e.target) && e.target !== input) {
            hideAutocomplete();
        }
    });

    // Handle Item Clicks
    contextMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.context-item');
        if (!item) {
            return;
        }

        const type = item.dataset.type;

        // 1. Current File
        if (type === 'current-file') {
            sendMessage(CHAT_COMMANDS.ADD_CONTEXT, { type: 'currentFile' });
        }
        // 2. Active Selection
        else if (type === 'selection') {
            sendMessage(CHAT_COMMANDS.ADD_CONTEXT, { type: 'selection' });
        }
        // 3. Pick File
        else if (type === 'search-files') {
            sendMessage(CHAT_COMMANDS.ADD_CONTEXT, { type: 'pickFile' });
        }
        // 4. Problems
        else if (type === 'problems') {
            sendMessage(CHAT_COMMANDS.ADD_CONTEXT, { type: 'problems' });
        }

        // Close menu
        contextMenu.classList.add('hidden');
    });
});

/**
 * Request the extension to open the image.
 * @param {string} dateUrlOrPath 
 */
function requestOpenImage(dateUrlOrPath) {
    // If it's base64, we CAN now send it. The backend will save it to temp.
    // if (dateUrlOrPath.startsWith('data:')) { ... }

    sendMessage(CHAT_COMMANDS.OPEN_IMAGE, { path: dateUrlOrPath });
}

function requestOpenFile(fileId) {
    const fileData = window.inlineFilesMap && window.inlineFilesMap[fileId];
    if (fileData) {
        if (fileData.path) {
            sendMessage('openFile', { path: fileData.path });
        } else {
            sendMessage('openVirtualFile', {
                name: fileData.name,
                text: fileData.content,
                language: fileData.language
            });
        }
    }
}


let activeStreamAccumulator = "";
let activeStreamNode = null;

// --- EVENT LISTENERS ---
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'searchFilesResult':
            {
                if (autocompleteType !== '@') { break; }
                filteredItems = message.results || [];
                if (filteredItems.length === 0) {
                    hideAutocomplete();
                    break;
                }
                selectedIndex = 0;
                renderAutocomplete();
                break;
            }
        case CHAT_COMMANDS.CHAT_REQUEST:
            hideLoadingIndicator();
            if (message.role === ROLE.USER) {
                appendUserMessage(message.content, message.images, message.files);
                if (!message.isHistory) {
                    showLoadingIndicator();
                }
            } else {
                appendAIMessage(message.content);
            }
            // Re-enable send button
            toggleSendButton("off");
            break;

        case CHAT_COMMANDS.CHAT_STREAM_START:
            isGenerating = true;
            toggleSendButton("generating");
            activeStreamAccumulator = "";
            activeStreamNode = null;
            break;

        case CHAT_COMMANDS.CHAT_STREAM_CHUNK:
            if (!activeStreamNode) {
                hideLoadingIndicator();
                appendAIMessage(""); // Create empty blank message

                // Get reference to the newly created blank message
                const aiMessages = chatbox.querySelectorAll('.system-message .message-text');
                if (aiMessages.length > 0) {
                    activeStreamNode = aiMessages[aiMessages.length - 1];
                }
            }

            if (activeStreamNode) {
                activeStreamAccumulator += message.content;
                activeStreamNode.innerHTML = marked.parse(activeStreamAccumulator);
                scrollToBottom();

                // Send ACK back to extension so it can send the next chunk
                if (message.seq) {
                    sendMessage(CHAT_COMMANDS.CHAT_CHUNK_ACK, { seq: message.seq });
                }
            }
            break;

        case CHAT_COMMANDS.CHAT_STREAM_END:
            hideLoadingIndicator(); // Always hide loading, even if no chunks arrived

            // Finalize open agent groups
            document.querySelectorAll('details.agent-steps-group').forEach(group => {
                const stepsContainer = group.querySelector('.agent-steps-container');
                if (stepsContainer && stepsContainer.children.length === 0) {
                    if (group.dataset.timer) {
                        clearInterval(parseInt(group.dataset.timer));
                    }
                    group.remove();
                } else {
                    if (group.dataset.timer) {
                        clearInterval(parseInt(group.dataset.timer));
                        delete group.dataset.timer;

                        const ms = Date.now() - parseInt(group.dataset.startTime);
                        const secs = Math.floor(ms / 1000);
                        const summaryText = group.querySelector('.summary-text');
                        if (summaryText) {
                            summaryText.textContent = `Worked for ${secs}s`;
                        }
                        group.open = false; // Close it to keep UI clean
                    }
                    group.dataset.finalized = "true";
                }
            });

            if (activeStreamNode) {
                setTimeout(() => {
                    hljs.highlightAll();
                    addAllCopyButtons();
                }, 0);
            }
            
            // #48: Check if AI ended with a question
            if (activeStreamAccumulator && detectsQuestion(activeStreamAccumulator)) {
                // Find active agent name
                const agentLabel = document.querySelector('.agent-selector-label');
                const agentName = agentLabel ? agentLabel.textContent.trim() : 'Agent';
                showQuestionBanner(agentName);
            }
            
            activeStreamNode = null;
            activeStreamAccumulator = "";
            isGenerating = false;
            toggleSendButton("off");
            break;

        // Case: Resetting the view / New Chat
        case CHAT_COMMANDS.CHAT_RESET:
            resetChat(message.content);
            break;

        case CHAT_COMMANDS.HISTORY_LOAD:
            showHistoryView(message.content); // Call the global function
            break;

        // TODO: Implement file context handling
        case CHAT_COMMANDS.FILE_CONTEXT_ADDED:
            const fileData = message.content;
            insertInlineFile(fileData.name, fileData.text, fileData.language, fileData.path);
            break;

        case CHAT_COMMANDS.IMAGE_CONTEXT_ADDED:
            const imgData = message.content;
            insertInlineImage(imgData.dataUrl, imgData.name);
            break;

        case CHAT_COMMANDS.PROBLEM_CONTEXT_ADDED:
            const problemData = message.content;
            insertInlineFile(problemData.name, problemData.text, problemData.language, problemData.path);
            break;

        case CHAT_COMMANDS.CHAT_AGENT_STEP:
            renderAgentStep(message.content);
            break;

        case CHAT_COMMANDS.CHAT_APPROVAL_UPDATE:
            {
                const { toolCallId, approved } = message.data;
                updateCardApproval(toolCallId, approved);
                break;
            }

        case 'chatStagingUpdate':
            updateStagingBar(message.content.stagedFilesCount);
            // Update header pill
            const reviewPill = document.getElementById('count-reviews');
            if (reviewPill) {
                reviewPill.textContent = message.content.stagedFilesCount;
            }
            break;

        case 'chatUsageUpdate':
            const tokenPill = document.getElementById('count-tokens');
            if (tokenPill && message.usage) {
                const total = message.usage.totalTokens || 0;
                tokenPill.textContent = total > 1000 ? (total / 1000).toFixed(1) + 'k' : total;
            }
            break;

        case 'reviewHunksData':
            openHunkReviewPanel(message.content);
            break;

        case 'uiSettingsUpdate':
            applyUISettings(message.ui);
            break;

        case 'agentsUpdate':
            if (window.VS_CONSTANTS) {
                window.VS_CONSTANTS.AGENTS = message.agents;
            }
            renderAgentDropdown(message.agents);
            // If the active agent was removed or disabled, updateActiveAgentUI will handle the fallback
            updateActiveAgentUI(activeAgentId, message.agents);
            break;

        case 'modelsUpdate':
            if (message.models) {
                if (window.VS_CONSTANTS) {
                    window.VS_CONSTANTS.MODELS = message.models;
                    if (message.customModels) {
                        window.VS_CONSTANTS.CUSTOM_MODELS = message.customModels;
                    }
                    if (message.availableModels) {
                        window.VS_CONSTANTS.AVAILABLE_MODELS = message.availableModels;
                    }
                }
                MODELS = message.models;
                initModelDropdown();
            }
            break;

        case CHAT_COMMANDS.CHAT_STATE_REHYDRATE:
            rehydrateState(message.content);
            break;

        default:
            console.error('Unknown command:', message.command);
    }
});

function rehydrateState(data) {
    const { chatId, messages, stagedFilesCount, agentId } = data;

    // 1. Reset the UI for the chat ID
    resetChat({ uid: chatId, agentId: agentId });

    // 2. Add all messages
    if (messages && Array.isArray(messages)) {
        messages.forEach(msg => {
            if (msg.role === ROLE.USER) {
                appendUserMessage(msg.message, msg.images || [], []);
            } else {
                appendAIMessage(msg.message);
            }
        });
    }

    // 3. Update staging bar
    updateStagingBar(stagedFilesCount);

    // 4. Highlight code
    setTimeout(() => {
        if (typeof hljs !== 'undefined') hljs.highlightAll();
        addAllCopyButtons();
        scrollToBottom();
    }, 100);
}
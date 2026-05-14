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
let attachedImages = [];
let attachedFiles = [];

// --- AUTOCOMPLETE STATE ---
const { COMMANDS = [], WORKFLOWS = [], AGENTS = [] } = window.VS_CONSTANTS || {};
const autocompleteMenu = document.getElementById('autocomplete-menu');

// --- MODE SWITCHER INITIALIZATION ---
const modeDropdown = document.getElementById('modeDropdown');
const modeSelected = document.getElementById('modeSelected');
const modeOptions = document.getElementById('modeOptions');

// Restore persisted agent selection, or default to first active agent
const _savedState = vscode.getState() || {};
let activeAgentId = _savedState.activeAgentId || 'default';

function persistAgentSelection() {
    vscode.setState({ ...(vscode.getState() || {}), activeAgentId });
}

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

// Initial render — auto-select first active agent if no saved/explicit selection
renderAgentDropdown(AGENTS);
if (activeAgentId === 'default' && AGENTS && AGENTS.length > 0) {
    const firstActive = AGENTS.find(a => a.isActive);
    if (firstActive) {
        activeAgentId = firstActive.id;
        persistAgentSelection();
    }
}
updateActiveAgentUI(activeAgentId, AGENTS);

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
        persistAgentSelection();

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
const tbAlwaysProceed = document.getElementById('tb-always-proceed');

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
    // Initialize Always Proceed toggle
    const isAlwaysProceed = PERMISSIONS.alwaysProceed === true;
    if (tbAlwaysProceed) {
        tbAlwaysProceed.checked = isAlwaysProceed;
    }

    // Apply initial state
    function applyAlwaysProceedState(enabled) {
        tbReadPerm.value = enabled ? 'auto' : (PERMISSIONS.readFilesConfirmation ? 'ask' : 'auto');
        tbWritePerm.value = enabled ? 'auto' : (PERMISSIONS.writeFilesConfirmation ? 'ask' : 'auto');
        tbCmdPerm.value = enabled ? 'auto' : (PERMISSIONS.runCommandsConfirmation ? 'ask' : 'auto');
        tbReadPerm.disabled = enabled;
        tbWritePerm.disabled = enabled;
        tbCmdPerm.disabled = enabled;
        if (enabled) {
            tbReadPerm.style.opacity = '0.4';
            tbWritePerm.style.opacity = '0.4';
            tbCmdPerm.style.opacity = '0.4';
        } else {
            tbReadPerm.style.opacity = '1';
            tbWritePerm.style.opacity = '1';
            tbCmdPerm.style.opacity = '1';
        }
    }
    applyAlwaysProceedState(isAlwaysProceed);

    if (tbAlwaysProceed) {
        tbAlwaysProceed.addEventListener('change', (e) => {
            const on = e.target.checked;
            sendMessage('updateNestedSetting', { category: 'permissions', key: 'alwaysProceed', value: on });
            if (on) {
                sendMessage('updateNestedSetting', { category: 'permissions', key: 'readFilesConfirmation', value: false });
                sendMessage('updateNestedSetting', { category: 'permissions', key: 'writeFilesConfirmation', value: false });
                sendMessage('updateNestedSetting', { category: 'permissions', key: 'runCommandsConfirmation', value: false });
            }
            applyAlwaysProceedState(on);
        });
    }

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
        // Always filter commands first (e.g. @workspace, @problems, @selection, @terminal)
        const matchedCommands = COMMANDS.filter(item =>
            item.label.toLowerCase().includes(query)
        );

        if (query.length > 0) {
            // Also request files from backend dynamically
            vscode.postMessage({
                command: 'searchWorkspaceFiles',
                data: { query: text }
            });
        }

        // Show matched commands immediately (file results will merge in via searchFilesResult)
        filteredItems = query.length === 0 ? COMMANDS : matchedCommands;
    } else {
        filteredItems = WORKFLOWS.filter(item =>
            item.label.toLowerCase().includes(query) ||
            item.description.toLowerCase().includes(query)
        );
    }

    if (filteredItems.length === 0 && autocompleteType !== '@') {
        // Don't hide for @ — file results may arrive async
        hideAutocomplete();
        return;
    }

    if (filteredItems.length > 0) {
        selectedIndex = Math.min(selectedIndex, filteredItems.length - 1);
        renderAutocomplete();
    }
}

function renderAutocomplete() {
    autocompleteMenu.innerHTML = '';

    // Add hint row when showing @ commands (not file search results)
    if (autocompleteType === '@' && filteredItems.length > 0 && filteredItems[0].label) {
        const isFileSearch = filteredItems[0].path;
        const hintEl = document.createElement('div');
        hintEl.className = 'autocomplete-hint';
        hintEl.textContent = isFileSearch ? 'FILES' : 'Type a filename to search...';
        autocompleteMenu.appendChild(hintEl);
    }

    filteredItems.forEach((item, index) => {
        const itemEl = document.createElement('div');
        itemEl.className = `autocomplete-item ${index === selectedIndex ? 'selected' : ''}`;

        // Determine icon based on label
        let iconSvg = '';
        if (item.path) {
            iconSvg = '<svg class="ac-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>';
        } else if (item.label === '@workspace') {
            iconSvg = '<svg class="ac-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>';
        } else if (item.label === '@problems') {
            iconSvg = '<svg class="ac-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z M12 15.75h.007v.008H12v-.008z" /></svg>';
        } else if (item.label === '@selection') {
            iconSvg = '<svg class="ac-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" /></svg>';
        } else if (item.label === '@terminal') {
            iconSvg = '<svg class="ac-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>';
        } else {
            iconSvg = '<svg class="ac-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>';
        }

        itemEl.innerHTML = `
            ${iconSvg}
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
    const selectedEl = autocompleteMenu.querySelector('.autocomplete-item.selected');
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
        // Safe removal of trigger token without destroying other HTML elements (pills)
        const deleteLength = 1 + (triggerQuery ? triggerQuery.length : 0);
        const selection = window.getSelection();
        let deleted = false;
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset >= deleteLength) {
                const startOffset = range.startOffset - deleteLength;
                range.setStart(range.startContainer, startOffset);
                range.deleteContents();
                deleted = true;
            } else {
                // Fallback: use execCommand delete
                for (let i = 0; i < deleteLength; i++) {
                    document.execCommand('delete', false, null);
                }
                deleted = true;
            }
        }
        // Final fallback: scan text nodes for orphaned trigger char
        if (!deleted) {
            const walker = document.createTreeWalker(chatMessage, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const node = walker.currentNode;
                const idx = node.textContent.lastIndexOf(autocompleteType);
                if (idx !== -1) {
                    node.textContent = node.textContent.substring(0, idx) + node.textContent.substring(idx + deleteLength);
                    break;
                }
            }
        }

        if (item.label === '@workspace') {
            sendMessage(CHAT_COMMANDS.ADD_CONTEXT, { type: 'workspace' });
        } else if (item.label === '@problems') {
            sendMessage(CHAT_COMMANDS.ADD_CONTEXT, { type: 'problems' });
        } else if (item.label === '@selection') {
            sendMessage(CHAT_COMMANDS.ADD_CONTEXT, { type: 'selection' });
        } else if (item.label === '@terminal') {
            sendMessage(CHAT_COMMANDS.ADD_CONTEXT, { type: 'terminal' });
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
                    const safeTitle = escapeHtml(item.title || 'Untitled');
                    const msgCount = item.messageCount || '';
                    const countBadge = msgCount ? `<span class="history-item-count">${msgCount} msg${msgCount > 1 ? 's' : ''}</span>` : '';
                    itemEl.innerHTML = `
        <div class="history-info">
            <span class="history-item-title" title="${safeTitle}">${safeTitle}</span>
            <div class="history-item-meta">
                <span class="history-item-time">${item.time}</span>
                ${countBadge}
            </div>
        </div>
        <button class="delete-item-btn" title="Delete conversation">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
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
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    };
    return now.toLocaleString('en-US', options);
}

let _scrollTimeout = null;
let _isUserScrolledUp = false;
let _isProgrammaticScroll = false;

chatLog.addEventListener('scroll', () => {
    if (_isProgrammaticScroll) return; // Ignore programmatic scrolls
    // If user is within 100px of the bottom, we consider them "at the bottom"
    const distanceToBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight;
    _isUserScrolledUp = distanceToBottom > 100;
});

function scrollToBottom(force = false) {
    if (!force && _isUserScrolledUp) {
        return;
    }
    // Throttle to one scroll per animation frame — prevents layout thrashing
    if (_scrollTimeout) return;
    _scrollTimeout = requestAnimationFrame(() => {
        _scrollTimeout = null;
        _isProgrammaticScroll = true;
        chatLog.scrollTop = chatLog.scrollHeight;
        // Allow time for the scroll event to fire before clearing the flag
        setTimeout(() => _isProgrammaticScroll = false, 50);
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

    const html = `<span id="${id}" class="inline-attachment-pill file-pill" contenteditable="false" data-file-id="${id}" data-file="true" data-name="${escapeHtml(name)}" title="Attached file: ${escapeHtml(name)}" onclick="requestOpenFile(this.dataset.fileId)">[▪ ${escapeHtml(name)}]</span>&nbsp;`;

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
window.handleUrlScrape = function (pill) {
    const url = pill.dataset.url;
    if (!url) return;

    // If already scraped, just show the content
    if (pill.classList.contains('scraped')) {
        const fileId = pill.dataset.fileId;
        if (fileId) {
            requestOpenFile(fileId);
            return;
        }
    }

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
                pill.textContent = `◆ ${msg.title || new URL(url).hostname}`;
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
                pill.textContent = `✕ ${new URL(url).hostname}`;
                pill.style.opacity = '0.5';
                pill.title = `Failed: ${msg.error}`;
            }
        }
    };
    window.addEventListener('message', handler);
};

function getActiveTurn() {
    let lastTurn = chatbox.lastElementChild;
    if (!lastTurn || !lastTurn.classList.contains('chat-turn')) {
        lastTurn = document.createElement('div');
        lastTurn.className = 'chat-turn';
        chatbox.appendChild(lastTurn);
    }
    return lastTurn;
}

function hideLoadingIndicator() {
    document.querySelectorAll('.loading-indicator').forEach(el => el.remove());
}

function showLoadingIndicator() {
    hideLoadingIndicator();
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'loading-indicator';
    loadingDiv.innerHTML = `<div class="generating-text" style="opacity: 0.5; font-size: 0.9em; margin-bottom: 8px;">Generating...</div>`;
    chatLog.appendChild(loadingDiv);
    scrollToBottom();
}


// --- MESSAGE HANDLING ---

function appendUserMessage(message, images = [], files = []) {
    // Force scroll lock when user sends a new message
    _isUserScrolledUp = false;

    let finalHTML = processMessageContent(message);

    if (files && files.length > 0) {
        files.forEach(file => {
            const id = "file-pill-hist-" + Date.now() + Math.floor(Math.random() * 1000);
            window.inlineFilesMap[id] = file;

            // #46: Match the marker with the pill text. URL pills use ◆, local files use [▪ ]
            const isUrl = file.path && (file.path.startsWith('http://') || file.path.startsWith('https://'));
            const marker = isUrl ? `◆ ${escapeHtml(file.name)}` : `[▪ ${escapeHtml(file.name)}]`;

            const pillHTML = `<span class="inline-attachment-pill file-pill ${isUrl ? 'url-pill scraped' : ''}" contenteditable="false" data-file-id="${id}" onclick="requestOpenFile(this.dataset.fileId)" title="Attached file: ${escapeHtml(file.name)}">${marker}</span>`;

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

    const userResponseHTML = `<div class="user-message-wrapper">
        <div class="user-message" data-raw-text="${encodeURIComponent(message)}">
          <div class="user-prompt-header">
            <span class="user-prompt-date">${getCurrentDate()}</span>
            <div class="user-message-actions" style="margin-left: auto;">
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
          <div class="message-content">
            <span class="message-text">${finalHTML}</span>
          </div>
        </div>
      </div>`;

    if (!chatWelcomeMessage.classList.contains('hidden')) {
        chatWelcomeMessage.classList.add('hidden');
        document.querySelector('.chat-container').classList.remove('new-chat');
    }

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = userResponseHTML;
    const turnDiv = document.createElement('div');
    turnDiv.className = 'chat-turn';
    chatbox.appendChild(turnDiv);

    turnDiv.appendChild(tempDiv.firstElementChild);

    // Important: Since we injected new <pre> blocks inside the details, 
    // we might want to re-run syntax highlighting or copy buttons
    if (message.includes("--- ATTACHED CONTEXT ---")) {
        setTimeout(() => {
            hljs.highlightAll();
            addAllCopyButtons();
        }, 0);
    }

    _isUserScrolledUp = false;
    scrollToBottom(true);
}

function getOrCreateAgentStepsGroup(isHistory) {
    let detailsEl = chatbox.querySelector('details.agent-steps-group:not([data-finalized="true"])');
    if (!detailsEl) {
        detailsEl = document.createElement('details');
        detailsEl.className = 'agent-steps-group';
        detailsEl.open = !isHistory; // History groups start collapsed
        detailsEl.dataset.startTime = Date.now();
        if (isHistory) { detailsEl.dataset.history = 'true'; }

        const summary = document.createElement('summary');
        summary.className = 'agent-steps-summary';

        if (isHistory) {
            // History: show static text, no live timer
            summary.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="chevron"><polyline points="9 18 15 12 9 6"></polyline></svg> <span class="summary-text">Completed steps</span>`;
        } else {
            summary.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="chevron"><polyline points="9 18 15 12 9 6"></polyline></svg> <span class="summary-text">Working...</span>`;
        }
        detailsEl.appendChild(summary);

        const stepsContainer = document.createElement('div');
        stepsContainer.className = 'agent-steps-container';
        detailsEl.appendChild(stepsContainer);

        const activeTurn = getActiveTurn();
        const loadingIndicator = activeTurn.querySelector('.loading-indicator');
        if (loadingIndicator) {
            activeTurn.insertBefore(detailsEl, loadingIndicator);
        } else {
            activeTurn.appendChild(detailsEl);
        }

        if (!isHistory) {
            // Only start the live timer for real-time requests
            detailsEl.dataset.timer = setInterval(() => {
                const ms = Date.now() - parseInt(detailsEl.dataset.startTime);
                const secs = Math.floor(ms / 1000);
                const summaryText = summary.querySelector('.summary-text');
                if (summaryText) {
                    summaryText.textContent = `Worked for ${secs}s`;
                }
            }, 1000);
        }

        return stepsContainer;
    }
    return detailsEl.querySelector('.agent-steps-container');
}


// ─── WAITING INDICATOR ──────────────────────────────────────────────────────
// Shows a pulsing "Analyzing..." between tool completions and the model's
// next action. Fills the visual dead zone so the user never sees a frozen UI.
let _waitingIndicatorTimer = null;

function clearWaitingIndicator() {
    if (_waitingIndicatorTimer) {
        clearTimeout(_waitingIndicatorTimer);
        _waitingIndicatorTimer = null;
    }
    const existing = document.querySelector('.agent-waiting-indicator');
    if (existing) { existing.remove(); }
}

function scheduleWaitingIndicator() {
    clearWaitingIndicator();
    _waitingIndicatorTimer = setTimeout(() => {
        // Only show if there isn't already a streaming thinking block
        if (document.querySelector('.agent-thinking-block:not([data-finalized="true"])')) { return; }

        const indicator = document.createElement('div');
        indicator.className = 'agent-waiting-indicator';
        indicator.innerHTML = `
            <div class="waiting-dots">
                <span></span><span></span><span></span>
            </div>
            <span class="waiting-label">Analyzing...</span>
        `;
        const group = getOrCreateAgentStepsGroup();
        group.appendChild(indicator);
        scrollToBottom();
    }, 1000); // 1s delay — short enough to feel responsive, long enough to avoid flicker
}

const AGENT_ICONS = {
    'list_workspace': '○',
    'read_file_skeleton': '▢',
    'read_line_range': '▤',
    'chunk_replace': '◇',
    'create_file': '▷',
    'find_symbol': '◎',
    'run_command': '▸',
    'search_workspace': '◈',
    'scrape_url': '◉',
    'web_search': '⌕',
    'manage_artifact': '🗄',
    'read_artifact': '🗎'
};

const AGENT_TOOL_LABELS = {
    'list_workspace': { running: 'Listing Workspace', done: 'Listed Workspace' },
    'read_file_skeleton': { running: 'Reading File Skeleton', done: 'Read File Skeleton' },
    'read_line_range': { running: 'Reading Lines', done: 'Read Lines' },
    'chunk_replace': { running: 'Editing File', done: 'Edited File' },
    'create_file': { running: 'Creating File', done: 'Created File' },
    'find_symbol': { running: 'Finding Symbol', done: 'Found Symbol' },
    'run_command': { running: 'Running Command', done: 'Ran Command' },
    'search_workspace': { running: 'Searching Workspace', done: 'Searched Workspace' },
    'scrape_url': { running: 'Scraping URL', done: 'Scraped URL' },
    'web_search': { running: 'Searching Web', done: 'Searched Web' },
    'manage_artifact': { running: 'Managing Artifact', done: 'Managed Artifact' },
    'read_artifact': { running: 'Reading Artifact', done: 'Read Artifact' }
};

/**
 * Renders an Agent tool step card in the chat log.
 * Shows what the agent is doing (reading, editing, searching, etc.)
 */
function renderAgentStep(step) {
    if (!step) { return; }

    // Always clear the waiting indicator when any new step arrives
    clearWaitingIndicator();

    if (step.type === 'thinking') {
        // Differentiate between status messages and actual reasoning tokens
        const isStatusMessage = step.text && (
            step.text.startsWith('Agent completed') ||
            step.text.startsWith('■') ||
            step.text.startsWith('✕')
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
            // Find ANY thinking block (non-finalized first, then most recent finalized)
            let thinkingBlock = chatbox.querySelector('.agent-thinking-block:not([data-finalized="true"])');
            if (!thinkingBlock) {
                // Post-stream token count — find the most recent finalized block
                const all = chatbox.querySelectorAll('.agent-thinking-block');
                thinkingBlock = all.length > 0 ? all[all.length - 1] : null;
            }
            if (thinkingBlock) {
                const prev = parseInt(thinkingBlock.dataset.tokens || '0', 10);
                const total = prev + tokenCount;
                thinkingBlock.dataset.tokens = String(total);
                // Update label with token count
                const label = thinkingBlock.querySelector('.thinking-label');
                if (label) {
                    label.textContent = `Thought for ${total} tokens`;
                }
            }
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
            thinkingBlock.dataset.thinkStart = String(Date.now());

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

            // Live elapsed time timer
            const timerId = setInterval(() => {
                const elapsed = Math.floor((Date.now() - parseInt(thinkingBlock.dataset.thinkStart)) / 1000);
                const label = thinkingBlock.querySelector('.thinking-label');
                if (label && !thinkingBlock.dataset.finalized) {
                    label.textContent = `Thinking for ${elapsed}s`;
                }
            }, 1000);
            thinkingBlock.dataset.thinkTimer = String(timerId);

            getOrCreateAgentStepsGroup(step._isHistory).appendChild(thinkingBlock);
        }

        // Append the reasoning text (if any — empty string for reasoning-start)
        if (step.text) {
            const contentEl = thinkingBlock.querySelector('.thinking-content');
            if (contentEl) {
                contentEl.textContent += step.text;
                // Auto-scroll thinking content to show latest text
                contentEl.scrollTop = contentEl.scrollHeight;
            }
            // Update label to show it's working
            const label = thinkingBlock.querySelector('.thinking-label');
            if (label) {
                label.textContent = 'Thinking...';
            }
        }
        return;
    }

    // Finalize any open thinking block when a non-thinking step arrives
    const openThinking = chatbox.querySelector('.agent-thinking-block:not([data-finalized="true"])');
    if (openThinking) {
        openThinking.dataset.finalized = 'true';
        openThinking.classList.remove('streaming');
        openThinking.open = false; // auto-collapse when done

        // Stop the elapsed time timer
        if (openThinking.dataset.thinkTimer) {
            clearInterval(parseInt(openThinking.dataset.thinkTimer));
        }

        const label = openThinking.querySelector('.thinking-label');
        const tokens = parseInt(openThinking.dataset.tokens || '0', 10);
        const startTime = parseInt(openThinking.dataset.thinkStart || '0', 10);
        const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
        const contentEl = openThinking.querySelector('.thinking-content');
        const hasText = contentEl && contentEl.textContent.trim();

        if (label) {
            let labelText = elapsed > 0 ? `Thought for ${elapsed}s` : 'Thought process';
            if (tokens > 0) {
                labelText += ` · ${tokens} tokens`;
            }
            label.textContent = labelText;
        }
    }

    // Helper is defined below
    const stepsContainer = getOrCreateAgentStepsGroup(step._isHistory);

    // Tools that go inside category groups don't need expand/collapse — use a simple div
    const groupedTools = ['list_workspace', 'read_file_skeleton', 'read_line_range', 'find_symbol',
        'search_workspace', 'get_workspace_problems', 'read_artifact', 'chunk_replace',
        'create_file', 'manage_artifact', 'scrape_url', 'web_search'];
    const isGroupedTool = groupedTools.includes(step.toolName);

    let stepEl = null;
    if (step.toolCallId) {
        stepEl = stepsContainer.querySelector(`[data-tool-call-id="${step.toolCallId}"]`);
    }
    if (!stepEl && step.toolName) {
        const candidates = stepsContainer.querySelectorAll(`[data-tool-name="${step.toolName}"] .step-status.running`);
        if (candidates.length > 0) {
            stepEl = candidates[candidates.length - 1].closest('.agent-step-card');
        }
    }
    if (!stepEl) {
        stepEl = document.createElement(isGroupedTool ? 'div' : 'details');
    }

    if (!stepEl.parentNode) {
        stepEl.className = 'agent-step-card';
    }

    if (step.type === 'tool_call') {
        const icon = AGENT_ICONS[step.toolName] || '◆';
        const labelObj = AGENT_TOOL_LABELS[step.toolName];
        let displayName = labelObj ? labelObj.running : step.toolName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        
        let argsPreview = step.args ? JSON.stringify(step.args).substring(0, 120) : '';
        if (step.args) {
            // Attempt to extract a target name to append to the display name for transparency
            let targetName = null;
            const pathArg = step.args.filePath || step.args.directory || step.args.TargetFile || step.args.AbsolutePath || step.args.SearchPath || step.args.DirectoryPath;
            
            if (typeof pathArg === 'string' && pathArg.trim() !== '') {
                targetName = pathArg.split(/[\\/]/).pop();
                if (!targetName || targetName === '.' || targetName === '..') {
                    targetName = 'Root';
                }
            } else if (step.toolName === 'list_workspace') {
                targetName = 'Root';
            }

            if (targetName) {
                if (step.toolName === 'list_workspace') {
                    displayName += ` (${targetName})`;
                } else {
                    displayName += ` - ${targetName}`;
                }
            }
            if (step.toolName === 'web_search' && step.args.query) {
                argsPreview = `<span style="opacity: 0.8;">Query:</span> <strong style="color: var(--vscode-textLink-foreground);">${step.args.query}</strong>`;
            } else if (step.toolName === 'scrape_url' && step.args.url) {
                argsPreview = `<span style="opacity: 0.8;">URL:</span> <a href="${step.args.url}" target="_blank" style="color: var(--vscode-textLink-foreground); text-decoration: none;">${step.args.url}</a>`;
            } else if (step.toolName === 'run_command' && step.args.command) {
                argsPreview = `<code style="background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; font-size: 0.9em;">$ ${step.args.command}</code>`;
            } else if (step.toolName === 'read_artifact' && step.args.name) {
                argsPreview = `<span style="opacity: 0.8;">${step.args.scope || 'session'}:</span> <strong style="color: var(--vscode-textLink-foreground);">${step.args.name}</strong>`;
            }
        }

        // All tools now show as "Running" initially. 
        // Write tools will quickly flip to "Done" (Staged) when the result arrives.
        // History steps render directly as "done" — no pulse animation needed.
        const initialStatus = step._isHistory ? 'done' : 'running';
        if (isGroupedTool) {
            // Grouped tools: simple inline header, no expand/collapse needed
            stepEl.innerHTML = `
                <div class="step-header">
                    <span class="step-icon">${icon}</span>
                    <span class="step-tool-name">${displayName}</span>
                    <span class="step-status ${initialStatus}"></span>
                </div>
            `;
        } else {
            // Ungrouped tools (run_command, plan_task, etc): expandable with content area
            stepEl.innerHTML = `
                <summary class="step-header">
                    <span class="step-icon">${icon}</span>
                    <span class="step-tool-name">${displayName}</span>
                    <span class="step-status ${initialStatus}"></span>
                    <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </summary>
                <div class="step-content">
                    <div class="step-args">${argsPreview}</div>
                </div>
            `;
            // Auto-open if there is something to show
            if (argsPreview) {
                stepEl.open = true;
            }
        }

        if (step.toolCallId) {
            stepEl.dataset.toolCallId = step.toolCallId;
            stepEl.dataset.toolName = step.toolName;
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
                    statusEl.classList.remove('running');
                    statusEl.classList.add('pending');
                }
            }
        }

    } else if (step.type === 'tool_result') {
        // Find the specific card by toolCallId, then try toolName fallback
        let targetCard = null;
        if (step.toolCallId) {
            targetCard = stepsContainer.querySelector(`[data-tool-call-id="${step.toolCallId}"]`);
        }
        // Fallback: if toolCallId didn't match (e.g. streaming used a temp ID),
        // find the last card with this toolName that's still "running"
        if (!targetCard && step.toolName) {
            const candidates = stepsContainer.querySelectorAll(`[data-tool-name="${step.toolName}"] .step-status.running`);
            if (candidates.length > 0) {
                targetCard = candidates[candidates.length - 1].closest('.agent-step-card');
            }
        }

        const statusEl = (targetCard || stepsContainer).querySelector('.step-status.running');
        if (statusEl) {
            const isStaged = step.result && (typeof step.result.message === 'string' && step.result.message.includes('staged'));
            if (isStaged) statusEl.textContent = 'Staged';
            statusEl.classList.remove('running');
            statusEl.classList.add('done');

            // The user requested to keep the present tense verb (e.g., "Running Command") 
            // permanently, so we no longer flip it to past tense here.

            // Special styling for manage_artifact result
            if (targetCard && step.toolName === 'manage_artifact' && step.result && step.result._artifactManaged) {
                targetCard.style.borderLeft = '3px solid #8e44ad';
                targetCard.style.background = 'rgba(142, 68, 173, 0.05)';
                const header = targetCard.querySelector('.step-header');
                if (header) {
                    header.style.color = '#9b59b6';
                }
                const argsPreview = targetCard.querySelector('.step-args');
                if (argsPreview) {
                    const am = step.result._artifactManaged;
                    argsPreview.innerHTML = `<strong>${am.action.toUpperCase()}</strong>: <code>${am.scope}/${am.name}</code>`;
                }
            }

            // run_command: render terminal snippet in the step-content div
            if (targetCard && step.toolName === 'run_command' && step.result && typeof step.result.output === 'string') {
                const commandArgs = window.pendingToolArgs && window.pendingToolArgs[step.toolCallId];
                const commandExecuted = commandArgs ? commandArgs.command : 'command';

                const terminalSnippet = document.createElement('div');
                terminalSnippet.className = 'terminal-snippet';

                let outputText = step.result.output.trim();
                if (outputText.length > 2000) {
                    outputText = outputText.substring(0, 2000) + '\n... (output truncated)';
                }
                if (!outputText) {
                    outputText = '(no output)';
                }

                const escapedOutput = outputText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const cwdText = '~/.../workspace';

                terminalSnippet.innerHTML = `
                    <div class="terminal-prompt"><span class="terminal-cwd">${cwdText}</span> $ ${commandExecuted}</div>
                    <div class="terminal-output">${escapedOutput}</div>
                `;
                // Ensure the card is open so the terminal snippet is visible
                targetCard.open = true;
                const contentDiv = targetCard.querySelector('.step-content') || targetCard;
                contentDiv.appendChild(terminalSnippet);
            }
        }

        // Schedule the waiting indicator — will show "Analyzing..." if
        // the model takes >1s to decide its next action.
        // Skip during history replay — all results are already present.
        if (!step._isHistory) { scheduleWaitingIndicator(); }
        return;
    }

        if (!stepEl.parentNode) {
            const categories = {
                'list_workspace': 'explore',
                'read_file_skeleton': 'explore',
                'read_line_range': 'explore',
                'find_symbol': 'explore',
                'search_workspace': 'explore',
                'get_workspace_problems': 'explore',
                'read_artifact': 'explore',
                'chunk_replace': 'edit',
                'create_file': 'edit',
                'manage_artifact': 'edit',
                'scrape_url': 'web',
                'web_search': 'web'
            };
            const categoryLabels = {
                'explore': 'Explored',
                'edit': 'Edited',
                'web': 'Searched'
            };

            const cat = categories[step.toolName];

            if (cat) {
                // Find the last actual group in stepsContainer
                let lastChild = stepsContainer.lastElementChild;
                if (lastChild && lastChild.classList.contains('agent-waiting-indicator')) {
                    lastChild = lastChild.previousElementSibling;
                }

                if (lastChild && lastChild.tagName === 'DETAILS' && lastChild.dataset.category === cat) {
                    // Append to existing group
                    const count = parseInt(lastChild.dataset.count || '0') + 1;
                    lastChild.dataset.count = String(count);
                    const labelEl = lastChild.querySelector('.group-label');
                    if (labelEl) {
                        labelEl.textContent = `${categoryLabels[cat]} ${count} items`;
                    }
                    const groupContent = lastChild.querySelector('.group-content');
                    if (groupContent) {
                        groupContent.appendChild(stepEl);
                    } else {
                        lastChild.appendChild(stepEl);
                    }
                } else {
                    // Create new group
                    const groupEl = document.createElement('details');
                    groupEl.className = 'agent-step-group-sub agent-step-card';
                    groupEl.dataset.category = cat;
                    groupEl.dataset.count = "1";
                    groupEl.open = true;
                    groupEl.innerHTML = `
                    <summary class="step-header">
                        <span class="step-icon">◂</span>
                        <span class="group-label step-tool-name">${categoryLabels[cat]} 1 item</span>
                        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    </summary>
                    <div class="group-content step-content" style="padding-left: 12px; border-left: 1px solid rgba(255, 255, 255, 0.1);"></div>
                `;
                    groupEl.querySelector('.group-content').appendChild(stepEl);
                    stepsContainer.appendChild(groupEl);
                }
            } else {
                // Un-grouped items (e.g. run_command)
                stepsContainer.appendChild(stepEl);
            }
        }

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

        // Initialize Generate Button
        initGenerateButton();
    });

    function initGenerateButton() {
        const generateBtn = document.getElementById('generateButton');
        if (generateBtn) {
            generateBtn.onclick = () => {
                const input = document.getElementById('messageInput');
                if (!input) {
                    console.error('messageInput not found');
                    return;
                }
                const prompt = input.innerText.trim();

                generateBtn.classList.add('loading');

                if (!prompt) {
                    // Empty input — suggest prompt ideas
                    console.log('Sending suggestPrompts request...');
                    sendMessage('suggestPrompts', {});
                } else {
                    // Has text — improve the existing prompt
                    console.log('Sending improvePrompt request...');
                    sendMessage('improvePrompt', { prompt });
                }
            };
        } else {
            console.warn('generateButton not found in DOM during init');
        }
    }


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
    let hunkReviewState = null; // { files: [...], undoStack: [], currentNavIndex: 0 }

    function openHunkReviewPanel(filesData) {
        // Initialize state (allow empty filesData for forced open)
        hunkReviewState = {
            files: (filesData || []).map(f => ({
                ...f,
                hunks: (f.hunks || []).map(h => ({ ...h, accepted: true }))
            })),
            undoStack: [], // Stack of { fileIdx, hunkIdx, prevState }
            currentNavIndex: 0
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
        const wasOpen = !!overlay;
        const scrollPos = wasOpen ? overlay.querySelector('.hunk-review-body').scrollTop : 0;

        if (overlay) { overlay.remove(); }

        overlay = document.createElement('div');
        overlay.id = 'hunk-review-overlay';
        overlay.className = 'hunk-review-overlay';

        const bodyContent = hunkReviewState.files.length === 0
            ? `<div class="hunk-empty-state" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; opacity:0.6; padding-top: 40px;">
             <div class="empty-icon" style="font-size: 48px; margin-bottom: 16px;">✓</div>
             <div class="empty-text" style="font-size: 1.1rem; font-weight: 600;">No pending changes</div>
             <div class="empty-subtext" style="font-size: 0.85rem;">All changes have been accepted or reverted.</div>
           </div>`
            : hunkReviewState.files.map((file, fileIdx) => renderFileSection(file, fileIdx)).join('');

        overlay.innerHTML = `
        <div class="hunk-review-header">
            <button class="back-btn" onclick="closeHunkReviewPanel()" title="Back to Chat">←</button>
            <h2>Review Changes (${hunkReviewState.files.length} file${hunkReviewState.files.length !== 1 ? 's' : ''})</h2>
            ${hunkReviewState.files.length > 0 ? renderNavigator() : ''}
        </div>
        <div class="hunk-review-body" id="hunk-review-body">
            ${bodyContent}
        </div>
        <div class="hunk-review-actions">
            <div class="hunk-action-info">
                ${hunkReviewState.files.length} file(s) with pending changes
            </div>
            <div class="hunk-action-buttons">
                <button class="hunk-action-btn discard" onclick="discardAllHunks()" ${hunkReviewState.files.length === 0 ? 'disabled' : ''}>
                    ✕ Reject All Files
                </button>
                <button class="hunk-action-btn commit" onclick="commitSelectedHunks()" ${hunkReviewState.files.length === 0 ? 'disabled' : ''}>
                    ✓ Accept All Files
                </button>
            </div>
        </div>
    `;

        document.body.appendChild(overlay);
        if (wasOpen) {
            overlay.querySelector('.hunk-review-body').scrollTop = scrollPos;
        }
    }

    function renderNavigator() {
        const total = hunkReviewState.files.length;
        const current = hunkReviewState.currentNavIndex || 0;

        return `
        <div class="hunk-navigator" style="display:flex; align-items:center; gap:10px; background: rgba(255,255,255,0.06); padding: 4px 10px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1);">
            <button class="nav-btn" onclick="navigateHunk(-1)" ${current <= 0 ? 'disabled' : ''} style="background:none; border:none; color:inherit; cursor:pointer; font-size:11px; opacity:${current <= 0 ? '0.3' : '1'};">
                ↑ Prev
            </button>
            <span class="nav-counter" style="font-size:11px; font-weight:600; font-family:var(--font-mono); opacity:0.8;">${current + 1} / ${total}</span>
            <button class="nav-btn" onclick="navigateHunk(1)" ${current >= total - 1 ? 'disabled' : ''} style="background:none; border:none; color:inherit; cursor:pointer; font-size:11px; opacity:${current >= total - 1 ? '0.3' : '1'};">
                ↓ Next
            </button>
        </div>
    `;
    }

    function navigateHunk(direction) {
        if (!hunkReviewState) return;
        const total = hunkReviewState.files.length;
        let idx = (hunkReviewState.currentNavIndex || 0) + direction;
        idx = Math.max(0, Math.min(idx, total - 1));
        hunkReviewState.currentNavIndex = idx;

        const section = document.querySelector(`.hunk-file-section[data-file-idx="${idx}"]`);
        if (section) {
            section.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // Update counter & button states in-place (no full re-render = no flicker)
        const counter = document.querySelector('.nav-counter');
        if (counter) { counter.textContent = `${idx + 1} / ${total}`; }
        const prevBtn = document.querySelector('.nav-btn[onclick="navigateHunk(-1)"]');
        const nextBtn = document.querySelector('.nav-btn[onclick="navigateHunk(1)"]');
        if (prevBtn) { prevBtn.disabled = idx <= 0; prevBtn.style.opacity = idx <= 0 ? '0.3' : '1'; }
        if (nextBtn) { nextBtn.disabled = idx >= total - 1; nextBtn.style.opacity = idx >= total - 1 ? '0.3' : '1'; }

        // Update current section highlights
        document.querySelectorAll('.hunk-file-section').forEach((s, i) => {
            const isCurrent = i === idx;
            s.style.borderColor = isCurrent ? 'rgba(79, 172, 254, 0.4)' : 'rgba(255, 255, 255, 0.06)';
            s.querySelector('.hunk-file-header').style.background = isCurrent ? 'rgba(79, 172, 254, 0.05)' : 'rgba(255, 255, 255, 0.03)';
        });
    }

    function renderFileSection(file, fileIdx) {
        const badge = file.isNewFile
            ? '<span class="hunk-file-badge new-file">NEW</span>'
            : '<span class="hunk-file-badge modified">MODIFIED</span>';

        const isCurrent = hunkReviewState.currentNavIndex === fileIdx;

        return `
        <div class="hunk-file-section ${isCurrent ? 'current' : ''}" data-file-idx="${fileIdx}" style="margin-bottom:16px; border:1px solid ${isCurrent ? 'rgba(79, 172, 254, 0.4)' : 'rgba(255, 255, 255, 0.06)'}; border-radius:8px; overflow:hidden;">
            <div class="hunk-file-header" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background: ${isCurrent ? 'rgba(79, 172, 254, 0.05)' : 'rgba(255, 255, 255, 0.03)'};">
                <div class="hunk-file-name" onclick="sendMessage('chatOpenFile', { uri: '${file.uri}' })" style="cursor: pointer; display:flex; align-items:center; gap:8px; font-family:var(--font-editor); font-size:0.82rem; font-weight:600;" title="Open File for Direct Review">
                    ${badge}
                    <span style="text-decoration: underline;">${escapeHtml(file.fileName)}</span>
                    <span style="opacity:0.4; font-weight:400; text-decoration: none;">(${file.hunks.length} hunk${file.hunks.length !== 1 ? 's' : ''})</span>
                    ${file.savedByUser ? '<span style="font-size: 0.65rem; color: #4CAF50; font-weight: 500; background: rgba(76, 175, 80, 0.1); padding: 1px 6px; border-radius: 4px;">SAVED</span>' : ''}
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button class="hunk-toggle-btn" style="border:none; padding:4px 10px; font-size:0.75rem; background: rgba(76, 175, 80, 0.2); color: #66bb6a; cursor: pointer; border-radius: 4px; font-weight:600;" onclick="sendMessage('acceptFile', { uri: '${file.uri}' })" title="Accept all changes in this file">✓ Accept All</button>
                    <button class="hunk-toggle-btn" style="border:none; padding:4px 10px; font-size:0.75rem; background: rgba(244, 67, 54, 0.2); color: #ef5350; cursor: pointer; border-radius: 4px; font-weight:600;" onclick="sendMessage('rejectFile', { uri: '${file.uri}' })" title="Reject all changes in this file">✕ Reject All</button>
                </div>
            </div>
            <div class="hunk-file-content" style="padding: 10px;">
                ${(file.hunks || []).map((hunk, hunkIdx) => renderHunkCard(hunk, fileIdx, hunkIdx)).join('')}
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
            closeIndexViewer();
        }
    });

    // ─── WORKSPACE INDEX VIEWER ──────────────────────────────────────────

    function openIndexViewer(fileList, fileCount, lastUpdated) {
        // Remove existing if present
        let overlay = document.getElementById('index-viewer-overlay');
        if (overlay) { overlay.remove(); }

        overlay = document.createElement('div');
        overlay.id = 'index-viewer-overlay';
        overlay.className = 'index-viewer-overlay';

        // Group files by top-level directory
        const groups = groupFilesByDir(fileList);
        const groupKeys = Object.keys(groups).sort();

        const timeStr = lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—';

        overlay.innerHTML = `
        <div class="index-viewer-header">
            <button class="back-btn" onclick="closeIndexViewer()" title="Back to Chat">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m15 18-6-6 6-6"/></svg>
            </button>
            <h2>Workspace Index <span class="index-count">${fileCount} files</span></h2>
            <button class="refresh-btn" onclick="sendMessage('refreshIndex', { chatId: chatLog.dataset.chatId }); closeIndexViewer();">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                Refresh
            </button>
        </div>
        <div class="index-viewer-search">
            <input type="text" id="index-search-input" placeholder="Search indexed files..." oninput="filterIndexViewer(this.value)" />
        </div>
        <div class="index-viewer-body" id="index-viewer-body">
            ${groupKeys.map(dir => renderIndexDirGroup(dir, groups[dir])).join('')}
        </div>
        <div class="index-viewer-footer">
            Last indexed: ${timeStr} — Only source code, config, and docs are indexed.
        </div>
    `;

        document.body.appendChild(overlay);

        // Focus the search input
        setTimeout(() => {
            const searchInput = document.getElementById('index-search-input');
            if (searchInput) { searchInput.focus(); }
        }, 100);
    }

    function closeIndexViewer() {
        const overlay = document.getElementById('index-viewer-overlay');
        if (overlay) { overlay.remove(); }
    }

    function groupFilesByDir(fileList) {
        const groups = {};
        for (const filePath of fileList) {
            const parts = filePath.split(/[\\/]/);
            const dir = parts.length > 1 ? parts[0] : '(root)';
            if (!groups[dir]) { groups[dir] = []; }
            groups[dir].push(filePath);
        }
        return groups;
    }

    function renderIndexDirGroup(dir, files) {
        let headerText = dir;
        if (dir === '.ai-companion') {
            headerText = '.ai-companion (Artifacts)';
        }

        const fileItems = files.map(f => {
            let fileName = f.split(/[\\/]/).pop();
            if (dir === '.ai-companion' && f.includes('sessions')) {
                const parts = f.split(/[\\/]/);
                if (parts.length >= 3) {
                    fileName = `${parts[parts.length - 2]}/${fileName}`;
                }
            }

            const ext = fileName.split('.').pop();
            const extBadge = ext && ext !== fileName ? `<span class="index-file-ext">.${ext}</span>` : '';
            return `<div class="index-file-item" data-filepath="${escapeHtml(f)}" onclick="sendMessage('chatOpenFile', { uri: '${escapeHtml(f)}' })" title="${escapeHtml(f)}"><svg class="index-file-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>${escapeHtml(fileName)} ${extBadge}</div>`;
        }).join('');

        return `
        <div class="index-dir-group" data-dir="${escapeHtml(dir)}">
            <div class="index-dir-header" onclick="toggleIndexDir(this)">
                <span class="dir-chevron">▼</span>
                <svg class="index-dir-icon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
                ${escapeHtml(headerText)}
                <span class="index-dir-count">(${files.length})</span>
            </div>
            <div class="index-file-list">
                ${fileItems}
            </div>
        </div>
    `;
    }

    function toggleIndexDir(headerEl) {
        headerEl.classList.toggle('collapsed');
        const fileList = headerEl.nextElementSibling;
        if (fileList) {
            fileList.classList.toggle('hidden');
        }
    }

    function filterIndexViewer(query) {
        const body = document.getElementById('index-viewer-body');
        if (!body) { return; }

        const queryLower = query.toLowerCase().trim();
        const groups = body.querySelectorAll('.index-dir-group');

        for (const group of groups) {
            const items = group.querySelectorAll('.index-file-item');
            let visibleCount = 0;

            for (const item of items) {
                const filePath = (item.dataset.filepath || '').toLowerCase();
                const match = !queryLower || filePath.includes(queryLower);
                item.style.display = match ? '' : 'none';
                if (match) { visibleCount++; }
            }

            // Hide entire directory group if no matches
            group.style.display = visibleCount > 0 ? '' : 'none';

            // Expand matching directories when searching
            if (queryLower && visibleCount > 0) {
                const header = group.querySelector('.index-dir-header');
                const fileList = group.querySelector('.index-file-list');
                if (header) { header.classList.remove('collapsed'); }
                if (fileList) { fileList.classList.remove('hidden'); }
            }

            // Update count
            const countEl = group.querySelector('.index-dir-count');
            if (countEl) {
                countEl.textContent = `(${visibleCount})`;
            }
        }
    }

    function appendAIMessage(response) {
        const parsedResponse = marked.parse(response);
        const systemResponseHTML = `<div class="system-message">
            <div class="message-content">
                <span class="message-text">${parsedResponse}</span>
                <div class="message-footer">
                    <div class="message-time">${getCurrentDate()}</div>
                </div>
            </div>
            </div>`;


        if (!chatWelcomeMessage.classList.contains('hidden')) {
            chatWelcomeMessage.classList.add('hidden');
            document.querySelector('.chat-container').classList.remove('new-chat');
        }


        const tempDiv = document.createElement('div');


        tempDiv.innerHTML = systemResponseHTML;

        const newMessageElement = tempDiv.firstElementChild;

        getActiveTurn().appendChild(newMessageElement);

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
        // Clear any outstanding group timers before wiping the DOM
        // to prevent leaked setInterval callbacks referencing detached nodes
        document.querySelectorAll('details.agent-steps-group').forEach(group => {
            if (group.dataset.timer) {
                clearInterval(parseInt(group.dataset.timer));
            }
        });
        clearWaitingIndicator();
        chatMessages.innerHTML = '';
        chatLog.dataset.chatId = content.uid;
        isGenerating = false;
        toggleSendButton("off");
        attachedImages = [];
        attachedFiles = [];
        renderAttachments();
        chatWelcomeMessage.classList.remove('hidden');
        document.querySelector('.chat-container').classList.add('new-chat');
        showChatView(); // Make sure we're on the chat view
        chatMessage.focus();

        // Only reset agent if the content explicitly provides one (e.g. loading from history)
        // New chat should preserve whatever agent the user currently has selected
        if (content.agentId !== undefined) {
            updateActiveAgentUI(content.agentId);
        }
    }



    /**
     * Retry: keep the user message, remove only all AI messages following it.
     */
    function retryLastMessage(btn) {
        const userMsgEl = btn ? btn.closest('.user-message') : null;
        const allMessages = Array.from(chatbox.querySelectorAll('.user-message, .system-message'));

        // Determine where to start removing AI messages
        let startIdx = -1;
        let targetUserMsg = userMsgEl;
        if (targetUserMsg) {
            startIdx = allMessages.indexOf(targetUserMsg) + 1;
        } else {
            // Fallback for non-button invocation (e.g. command palette)
            // Find the LAST user message in the chat
            const reversed = [...allMessages].reverse();
            targetUserMsg = reversed.find(el => el.classList.contains('user-message'));
            startIdx = targetUserMsg ? allMessages.indexOf(targetUserMsg) + 1 : allMessages.length - 1;
        }

        // Calculate precise userMsgIdx for robust backend deletion
        const allUserMessages = Array.from(chatbox.querySelectorAll('.user-message'));
        const userMsgIdx = targetUserMsg ? allUserMessages.indexOf(targetUserMsg) : allUserMessages.length - 1;

        if (startIdx <= 0 || startIdx > allMessages.length) { return; }

        // Count system-messages (AI responses) after this user message
        const messagesAfter = allMessages.length - startIdx;
        // Minimum count is 2: the user message itself + at least 1 bot response (even if empty/error)
        const removedCount = Math.max(2, messagesAfter + 1);

        // Blast away all DOM nodes that come after targetUserMsg
        if (targetUserMsg) {
            let wrapper = targetUserMsg.closest('.user-message-wrapper') || targetUserMsg;
            let turnDiv = wrapper.closest('.chat-turn') || wrapper;
            
            // 1. Remove all siblings after the user message inside the turnDiv
            let nextNode = wrapper.nextSibling;
            while (nextNode) {
                const toRemove = nextNode;
                nextNode = nextNode.nextSibling;
                toRemove.remove();
            }
            
            // 2. Remove all subsequent turnDivs
            let nextTurn = turnDiv.nextSibling;
            while (nextTurn) {
                const toRemove = nextTurn;
                nextTurn = nextTurn.nextSibling;
                toRemove.remove();
            }
        } else {
            for (let i = startIdx; i < allMessages.length; i++) {
                allMessages[i].remove();
            }
        }

        showLoadingIndicator();
        toggleSendButton('disabled');
        sendMessage(CHAT_COMMANDS.CHAT_RETRY, {
            chat_id: chatLog.dataset.chatId,
            count: removedCount,
            userMsgIdx: userMsgIdx >= 0 ? userMsgIdx : undefined,
            agentId: activeAgentId
        });
    }

    /**
     * Edit: swap user message bubble with an inline editable textarea.
     * On cancel, restore the original bubble.
     */
    function editUserMessage(btn) {
        const userMsgEl = btn.closest('.user-message');
        const rawText = decodeURIComponent(userMsgEl.dataset.rawText || '');

        // Find exact user message index for robust backend deletion
        const allUserMessages = Array.from(chatbox.querySelectorAll('.user-message'));
        const userMsgIdx = allUserMessages.indexOf(userMsgEl);

        // Count formal AI/user messages for the legacy backend history trim
        const allMessages = Array.from(chatbox.querySelectorAll('.user-message, .system-message'));
        const startIdx = allMessages.indexOf(userMsgEl);
        const messagesAfter = allMessages.slice(startIdx + 1);
        const removedCount = messagesAfter.length + 1; // +1 = the user msg itself for history delete

        // Blast away all DOM nodes that come after userMsgEl
        let wrapper = userMsgEl.closest('.user-message-wrapper') || userMsgEl;
        let turnDiv = wrapper.closest('.chat-turn') || wrapper;
        
        let removedNodes = [];
        
        // 1. Remove siblings inside the turn
        let nextNode = wrapper.nextSibling;
        while (nextNode) {
            const toRemove = nextNode;
            nextNode = nextNode.nextSibling;
            removedNodes.push({ parent: turnDiv, node: toRemove });
            toRemove.remove();
        }
        
        // 2. Remove subsequent turns
        let nextTurn = turnDiv.nextSibling;
        while (nextTurn) {
            const toRemove = nextTurn;
            nextTurn = nextTurn.nextSibling;
            removedNodes.push({ parent: chatbox, node: toRemove });
            toRemove.remove();
        }

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
            removedNodes.forEach(item => item.parent.appendChild(item.node));
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
                userMsgIdx: userMsgIdx >= 0 ? userMsgIdx : undefined,
                overrideMessage: newText,
                agentId: activeAgentId
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
                stopBadge.innerHTML = `■ Generation stopped by user`;
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
        initGenerateButton();

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
                const pill = `<span class="inline-attachment-pill url-pill" contenteditable="false" data-url="${url}" data-url-id="${urlId}" title="Click to scrape: ${url}" onclick="handleUrlScrape(this)">◆ ${new URL(url).hostname}${new URL(url).pathname.substring(0, 30)}</span>&nbsp;`;

                // Wrap in setTimeout to avoid "execCommand() ... called recursively" error
                setTimeout(() => {
                    document.execCommand('insertHTML', false, pill);
                    // URL stays as a clickable pill — user can click to scrape manually
                }, 0);
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

            // 1. Media — open file picker (browser input)
            if (type === 'media') {
                imageUploadInput.click();
            }
            // 2. Mentions — insert @ into input to trigger autocomplete
            else if (type === 'mentions') {
                // Defer to avoid race with document click handler that closes autocomplete
                setTimeout(() => {
                    chatMessage.focus();
                    document.execCommand('insertText', false, '@');
                    // Directly trigger autocomplete logic
                    autocompleteType = '@';
                    triggerQuery = '';
                    updateAutocompleteItems('');
                }, 50);
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
            const isUrl = fileData.path && (fileData.path.startsWith('http://') || fileData.path.startsWith('https://'));
            if (fileData.path && !isUrl) {
                // Local file — open directly
                sendMessage('openFile', { path: fileData.path });
            } else if (isUrl && !fileData.content) {
                // URL without content (old history) — open URL externally
                sendMessage('openExternal', { url: fileData.path });
            } else {
                // URL with content or virtual file — show in editor
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
            case 'focus':
                // Only autofocus if the user isn't using another input (like search)
                if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
                    if (chatMessage && !chatMessage.disabled) {
                        chatMessage.focus();
                    }
                    setTimeout(() => {
                        if (chatMessage && !chatMessage.disabled) {
                            chatMessage.focus();
                        }
                    }, 100);
                }
                break;
            case 'searchFilesResult':
                {
                    if (autocompleteType !== '@') { break; }
                    const fileResults = message.results || [];
                    // Merge: keep any matched commands at the top, then add file results
                    const commandMatches = filteredItems.filter(item => item.label && !item.path);
                    filteredItems = [...commandMatches, ...fileResults];
                    if (filteredItems.length === 0) {
                        hideAutocomplete();
                        break;
                    }
                    selectedIndex = 0;
                    renderAutocomplete();
                    break;
                }
            case CHAT_COMMANDS.CHAT_ID_UPDATE:
                // When a new chat is started, backend replies with the assigned UUID
                // We MUST set this immediately so if the user clicks "Stop Request"
                // during the first turn, the abort command sends the correct ID.
                chatLog.dataset.chatId = message.content.uid;
                break;
            case CHAT_COMMANDS.CHAT_REQUEST:
                hideLoadingIndicator();
                if (message.role === ROLE.USER) {
                    appendUserMessage(message.content, message.images, message.files);
                    if (!message.isHistory) {
                        showLoadingIndicator();
                    }
                } else {
                    if (message.agentSteps && message.agentSteps.length > 0) {
                        for (const step of message.agentSteps) {
                            // Tag steps so renderAgentStep knows to skip the live timer
                            if (message.isHistory) { step._isHistory = true; }
                            renderAgentStep(step);
                        }

                        // Finalize thinking blocks and groups
                        document.querySelectorAll('.agent-thinking-block:not([data-finalized="true"])').forEach(thinkingBlock => {
                            thinkingBlock.dataset.finalized = 'true';
                            thinkingBlock.classList.remove('streaming');
                            thinkingBlock.open = false;
                            const label = thinkingBlock.querySelector('.thinking-label');
                            if (label && !label.textContent.includes('Thought for')) {
                                label.textContent = 'Thought process';
                            }
                        });

                        document.querySelectorAll('details.agent-steps-group:not([data-finalized="true"])').forEach(group => {
                            if (group.dataset.timer) {
                                clearInterval(parseInt(group.dataset.timer));
                                delete group.dataset.timer;
                            }
                            const summaryText = group.querySelector('.summary-text');
                            if (summaryText) {
                                if (group.dataset.history) {
                                    summaryText.textContent = 'Completed steps';
                                } else {
                                    const ms = Date.now() - parseInt(group.dataset.startTime);
                                    const secs = Math.floor(ms / 1000);
                                    summaryText.textContent = secs === 0 ? 'Completed steps' : `Worked for ${secs}s`;
                                }
                            }
                            group.open = false;
                            group.dataset.finalized = "true";
                        });
                    }
                    if (message.content) {
                        appendAIMessage(message.content);
                    }
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
                    appendAIMessage(""); // Create empty blank message

                    // Get reference to the newly created blank message
                    const aiMessages = chatbox.querySelectorAll('.system-message .message-text');
                    if (aiMessages.length > 0) {
                        activeStreamNode = aiMessages[aiMessages.length - 1];
                    }
                }

                if (activeStreamNode) {
                    activeStreamAccumulator += message.content;

                    // Batch markdown re-parse: only once per animation frame
                    if (!activeStreamNode._renderPending) {
                        activeStreamNode._renderPending = true;
                        requestAnimationFrame(() => {
                            if (activeStreamNode) {
                                activeStreamNode.innerHTML = marked.parse(activeStreamAccumulator);
                                activeStreamNode._renderPending = false;
                                scrollToBottom();
                            }
                        });
                    }
                }

                // ALWAYS send ACK back — even if rendering failed
                // Without this, the backend hangs forever waiting for the ACK → deadlock
                if (message.seq) {
                    sendMessage(CHAT_COMMANDS.CHAT_CHUNK_ACK, { seq: message.seq });
                }
                break;

            case CHAT_COMMANDS.CHAT_STREAM_END:
                hideLoadingIndicator(); // Always hide loading, even if no chunks arrived
                clearWaitingIndicator(); // Remove any between-step indicator

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
                                if (secs === 0) {
                                    summaryText.textContent = `Completed steps`;
                                } else {
                                    summaryText.textContent = `Worked for ${secs}s`;
                                }
                            }
                            group.open = false; // Close it to keep UI clean
                        }
                        group.dataset.finalized = "true";
                    }
                });

                // #44: Finalize any open thinking blocks
                document.querySelectorAll('.agent-thinking-block:not([data-finalized="true"])').forEach(thinkingBlock => {
                    thinkingBlock.dataset.finalized = 'true';
                    thinkingBlock.classList.remove('streaming');
                    thinkingBlock.open = false;

                    // Stop elapsed timer
                    if (thinkingBlock.dataset.thinkTimer) {
                        clearInterval(parseInt(thinkingBlock.dataset.thinkTimer));
                    }

                    const label = thinkingBlock.querySelector('.thinking-label');
                    const tokens = parseInt(thinkingBlock.dataset.tokens || '0', 10);
                    const startTime = parseInt(thinkingBlock.dataset.thinkStart || '0', 10);
                    const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;

                    if (label) {
                        let labelText = elapsed > 0 ? `Thought for ${elapsed}s` : 'Thought process';
                        if (tokens > 0) {
                            labelText += ` · ${tokens} tokens`;
                        }
                        label.textContent = labelText;
                    }
                });

                if (activeStreamNode) {
                    if (!activeStreamAccumulator) {
                        const parentBubble = activeStreamNode.closest('.system-message');
                        if (parentBubble) {
                            parentBubble.remove();
                        }
                    } else {
                        // Force a final synchronous render before clearing references
                        activeStreamNode.innerHTML = marked.parse(activeStreamAccumulator);
                        activeStreamNode._renderPending = false;
                        setTimeout(() => {
                            hljs.highlightAll();
                            addAllCopyButtons();
                            scrollToBottom(true);
                        }, 0);
                    }
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

            case CHAT_COMMANDS.CHAT_CONTINUE_PROMPT:
                {
                    const { chatId, agentId, extraSteps, stepsUsed } = message.data;
                    // Remove any existing continue banner
                    document.querySelectorAll('.continue-banner').forEach(b => b.remove());

                    const banner = document.createElement('div');
                    banner.className = 'continue-banner';
                    banner.innerHTML = `
                    <div class="continue-banner-content">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
                        <span>Agent reached the step limit (${stepsUsed} steps). There may be more work to do.</span>
                        <button class="continue-btn" id="continueAgentBtn">Continue</button>
                        <button class="continue-dismiss-btn" id="dismissContinueBtn">Dismiss</button>
                    </div>
                `;
                    document.getElementById('chatLog').appendChild(banner);
                    scrollToBottom();

                    document.getElementById('continueAgentBtn').addEventListener('click', () => {
                        banner.remove();
                        showLoadingIndicator();
                        isGenerating = true;
                        toggleSendButton("on");
                        sendMessage(CHAT_COMMANDS.CHAT_CONTINUE, {
                            chatId,
                            agentId
                        });
                    });

                    document.getElementById('dismissContinueBtn').addEventListener('click', () => {
                        banner.remove();
                    });
                    break;
                }

            // Case: Resetting the view / New Chat
            case CHAT_COMMANDS.CHAT_RESET:
                resetChat(message.content);
                break;

            // Backend asks frontend to initiate detach (from VS Code header button)
            case 'requestDetach':
                if (isGenerating) {
                    // Show inline warning — can't detach during active generation
                    const warnEl = document.createElement('div');
                    warnEl.className = 'detach-warning';
                    warnEl.textContent = 'Cannot detach while a request is in progress. Please wait or stop the request first.';
                    warnEl.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);background:rgba(220,38,38,0.9);color:#fff;padding:8px 16px;border-radius:8px;font-size:0.82rem;z-index:9999;animation:fadeOut 3s forwards;';
                    document.body.appendChild(warnEl);
                    setTimeout(() => warnEl.remove(), 3000);
                    break;
                }
                {
                    const chatId = chatLog?.dataset?.chatId || '';
                    // Only detach if there's an actual conversation
                    if (chatId && chatMessages.children.length > 0) {
                        sendMessage('detachChat', { chatId });
                    } else {
                        // Nothing to detach — just open a blank popup
                        sendMessage('detachChat', {});
                    }
                }
                break;

            // Popup: load a conversation by emulating history click
            case 'loadChatInPopup':
                if (message.chatId) {
                    sendMessage(CHAT_COMMANDS.CHAT_LOAD, { chatId: message.chatId });
                }
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
                if (hunkReviewState) {
                    // Update state in place for real-time refresh
                    hunkReviewState.files = (message.content || []).map(f => ({
                        ...f,
                        hunks: (f.hunks || []).map(h => ({ ...h, accepted: true }))
                    }));
                    renderHunkReviewPanel();
                } else if (message.openPanel && message.content && message.content.length > 0) {
                    // Explicit user request to open the panel
                    openHunkReviewPanel(message.content);
                }
                break;

            case 'uiSettingsUpdate':
                applyUISettings(message.ui);
                break;

            case 'improvedPrompt':
                {
                    const generateBtn = document.getElementById('generateButton');
                    if (generateBtn) generateBtn.classList.remove('loading');

                    const input = document.getElementById('messageInput');
                    if (input && message.content) {
                        input.focus();
                        document.execCommand('selectAll', false, null);
                        document.execCommand('insertText', false, message.content);
                    }
                }
                break;

            case 'suggestPromptsResult':
                {
                    const generateBtn = document.getElementById('generateButton');
                    if (generateBtn) generateBtn.classList.remove('loading');

                    const suggestions = message.suggestions || [];
                    if (suggestions.length > 0) {
                        // Remove existing chips
                        const existing = document.querySelector('.prompt-suggestion-chips');
                        if (existing) existing.remove();

                        const chipsContainer = document.createElement('div');
                        chipsContainer.className = 'prompt-suggestion-chips';

                        suggestions.forEach(text => {
                            const chip = document.createElement('button');
                            chip.className = 'suggestion-chip';
                            chip.textContent = text;
                            chip.addEventListener('click', () => {
                                const input = document.getElementById('messageInput');
                                if (input) {
                                    input.innerText = text;
                                    input.focus();
                                    const range = document.createRange();
                                    const sel = window.getSelection();
                                    range.selectNodeContents(input);
                                    range.collapse(false);
                                    sel.removeAllRanges();
                                    sel.addRange(range);
                                }
                                chipsContainer.remove();
                            });
                            chipsContainer.appendChild(chip);
                        });

                        // Insert chips above the input container
                        const editorWrapper = document.querySelector('.editor-wrapper');
                        if (editorWrapper) {
                            editorWrapper.insertBefore(chipsContainer, editorWrapper.querySelector('.unified-input-container'));
                        }
                    }
                }
                break;

            case 'fileSaveStatus':
                if (hunkReviewState && message.content) {
                    const file = hunkReviewState.files.find(f => f.uri === message.content.uri);
                    if (file) {
                        file.savedByUser = true;
                        renderHunkReviewPanel();
                    }
                }
                break;

            case 'indexUpdate':
                {
                    const indexPill = document.getElementById('count-index');
                    if (indexPill && message.content) {
                        indexPill.textContent = message.content.fileCount || '0';
                        const pillEl = document.getElementById('pill-index');
                        if (pillEl) {
                            pillEl.title = `Workspace Index: ${message.content.fileCount} files — Last updated: ${new Date(message.content.lastUpdated).toLocaleTimeString()} — Click to View`;
                        }
                    }
                    // Store the file list for the viewer
                    if (message.content && message.content.fileList) {
                        window._indexedFiles = message.content.fileList;
                        window._indexLastUpdated = message.content.lastUpdated;
                    }
                    // Open the viewer if requested
                    if (message.content && message.content.showViewer) {
                        openIndexViewer(message.content.fileList || [], message.content.fileCount, message.content.lastUpdated);
                    }
                    break;
                }

            case 'agentsUpdate':
                if (window.VS_CONSTANTS) {
                    window.VS_CONSTANTS.AGENTS = message.agents;
                }
                renderAgentDropdown(message.agents);
                // On first load, auto-select the first active agent instead of "Chat"
                if (activeAgentId === 'default' && message.agents && message.agents.length > 0) {
                    const firstActive = message.agents.find(a => a.isActive);
                    if (firstActive) {
                        activeAgentId = firstActive.id;
                        persistAgentSelection();
                    }
                }
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

            // Live settings sync — apply all changes immediately from settings panel
            case 'settingsChanged':
                {
                    const s = message.settings;
                    if (!s) break;

                    // 1. Models + Custom Models
                    if (s.models) {
                        MODELS = s.models;
                        if (window.VS_CONSTANTS) {
                            window.VS_CONSTANTS.MODELS = s.models;
                        }
                    }
                    // Always sync customModels (deletions, additions, active toggles)
                    if (window.VS_CONSTANTS) {
                        window.VS_CONSTANTS.CUSTOM_MODELS = s.customModels || [];
                    }
                    // Refresh model dropdown if we have model data
                    if (s.models) {
                        initModelDropdown();
                    }

                    // 2. Permissions
                    if (s.permissions) {
                        PERMISSIONS = s.permissions;
                        if (window.VS_CONSTANTS) window.VS_CONSTANTS.PERMISSIONS = s.permissions;
                        // Refresh permission UI
                        const isAP = s.permissions.alwaysProceed === true;
                        if (tbAlwaysProceed) tbAlwaysProceed.checked = isAP;
                        if (tbReadPerm) {
                            tbReadPerm.value = isAP ? 'auto' : (s.permissions.readFilesConfirmation ? 'ask' : 'auto');
                            tbReadPerm.disabled = isAP;
                            tbReadPerm.style.opacity = isAP ? '0.4' : '1';
                        }
                        if (tbWritePerm) {
                            tbWritePerm.value = isAP ? 'auto' : (s.permissions.writeFilesConfirmation ? 'ask' : 'auto');
                            tbWritePerm.disabled = isAP;
                            tbWritePerm.style.opacity = isAP ? '0.4' : '1';
                        }
                        if (tbCmdPerm) {
                            tbCmdPerm.value = isAP ? 'auto' : (s.permissions.runCommandsConfirmation ? 'ask' : 'auto');
                            tbCmdPerm.disabled = isAP;
                            tbCmdPerm.style.opacity = isAP ? '0.4' : '1';
                        }
                    }

                    // 3. Agents
                    if (s.prompts) {
                        if (window.VS_CONSTANTS) window.VS_CONSTANTS.AGENTS = s.prompts;
                        renderAgentDropdown(s.prompts);
                        updateActiveAgentUI(activeAgentId, s.prompts);
                    }

                    // 4. UI (CSS + allowExternalMedia)
                    if (s.ui) {
                        applyUISettings(s.ui);
                        applyExternalMediaSetting(s.ui.allowExternalMedia);
                    }
                }
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
            
            // Force scroll to bottom when loading history
            _isUserScrolledUp = false;
            scrollToBottom(true);
            
            // Double-check after layout shifts (images, code blocks, mathjax)
            let scrollAttempts = 0;
            const scrollInterval = setInterval(() => {
                _isUserScrolledUp = false;
                scrollToBottom(true);
                scrollAttempts++;
                if (scrollAttempts >= 5) { // Try 5 times over 500ms
                    clearInterval(scrollInterval);
                }
            }, 100);
        }, 50);
    }
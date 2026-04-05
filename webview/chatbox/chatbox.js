// --- GLOBALS (accessible by history.js) ---
const vscode = acquireVsCodeApi();
// Injected constants from the extension, ignore the error this would be replaced by our extension.
console.log('VS_CONSTANTS:', window.VS_CONSTANTS);
// Extract the constants injected by the backend
const { CHAT_COMMANDS, ROLE } = window.VS_CONSTANTS;

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
const aiIconBtnHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bot-message-square-icon lucide-bot-message-square"><path d="M12 6V2H8"/><path d="M15 11v2"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M20 16a2 2 0 0 1-2 2H8.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 4 20.286V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/><path d="M9 11v2"/></svg>`;
const contextMenu = document.getElementById('context-menu');
const attachBtn = document.getElementById('atch-ctx-button');




/**
 * Stores attached images as objects
 * @type {Array<{dataUrl: string, name: string}>}
 */
let attachedImages = [];
let attachedFiles = [];

// --- AUTOCOMPLETE STATE ---
const { COMMANDS = [], WORKFLOWS = [], AGENTS = [] } = window.VS_CONSTANTS;
const autocompleteMenu = document.getElementById('autocomplete-menu');

// --- MODE SWITCHER INITIALIZATION ---
const modeDropdown = document.getElementById('modeDropdown');
const modeSelected = document.getElementById('modeSelected');
const modeOptions = document.getElementById('modeOptions');

let activeAgentId = 'default';

if (modeDropdown && AGENTS.length > 0) {
    AGENTS.forEach(agent => {
        if (!agent.isActive) { return; }
        const opt = document.createElement('div');
        opt.className = 'mode-option';
        opt.dataset.value = agent.id;
        opt.innerHTML = `<span class="mode-icon">🤖</span> ${escapeHtml(agent.name)}`;
        modeOptions.appendChild(opt);
    });
}

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
        
        activeAgentId = option.dataset.value;
        const icon = option.querySelector('.mode-icon').innerHTML;
        // Grab only the text content ignoring the icon span
        const text = option.innerText.replace(icon, '').trim();
        
        // Update styling
        modeOptions.querySelectorAll('.mode-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');

        // Update selected display
        modeSelected.innerHTML = `<span class="mode-icon">${icon}</span> ${text}
            <svg class="dropdown-arrow" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>`;

        // Hide
        modeOptions.classList.add('hidden');
        modeDropdown.classList.remove('open');
    });

    // Close on outside click
    document.addEventListener('click', () => {
        if (!modeOptions.classList.contains('hidden')) {
            modeOptions.classList.add('hidden');
            modeDropdown.classList.remove('open');
        }
    });
}
let autocompleteActive = false;
let autocompleteType = null; // '@' or '/'
let selectedIndex = 0;
let filteredItems = [];
let triggerQuery = '';

// --- HELPER FUNCTIONS ---

function updateAutocompleteItems(text) {
    const query = text.toLowerCase();
    const source = autocompleteType === '@' ? COMMANDS : WORKFLOWS;

    filteredItems = source.filter(item =>
        item.label.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query)
    );

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
        if (item.label === '@file') {
            // Remove the "@file" text and trigger picker
            const newText = text.substring(0, triggerIndex) + text.substring(cursorPosition);
            chatMessage.innerText = newText;
            setCaretPosition(chatMessage, triggerIndex);
            sendMessage(CHAT_COMMANDS.ADD_CONTEXT, { type: 'pickFile' });
        } else if (item.label === '@workspace') {
            // Remove the "@workspace" text and trigger workspace context
            const newText = text.substring(0, triggerIndex) + text.substring(cursorPosition);
            chatMessage.innerText = newText;
            setCaretPosition(chatMessage, triggerIndex);
            sendMessage(CHAT_COMMANDS.ADD_CONTEXT, { type: 'workspace' });
        } else {
            // Normal insertion for workflows and other commands
            const textAfterCursor = text.substring(cursorPosition);
            const newText = text.substring(0, triggerIndex) + item.label + ' ' + textAfterCursor;
            chatMessage.innerText = newText;
            setCaretPosition(chatMessage, triggerIndex + item.label.length + 1);
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



function toggleSendButton(mode = "off") {
    mode === "disabled" ? sendButton.classList.add("disabled") : sendButton.classList.remove("disabled");
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
    chatLog.scrollTop = chatLog.scrollHeight;
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

    // Find or create the agent steps container
    let stepsContainer = chatbox.querySelector('.agent-steps-container:last-child');
    if (!stepsContainer) {
        stepsContainer = document.createElement('div');
        stepsContainer.className = 'agent-steps-container';
        chatbox.appendChild(stepsContainer);
    }

    const stepEl = document.createElement('div');
    stepEl.className = 'agent-step-card';

    if (step.type === 'tool_call') {
        const icons = {
            'list_workspace': '📂',
            'read_file_skeleton': '🦴',
            'read_line_range': '📖',
            'chunk_replace': '✏️',
            'create_file': '📄',
            'find_symbol': '🔍',
            'run_command': '⚡',
            'search_workspace': '🔎'
        };
        const icon = icons[step.toolName] || '🛠️';
        const argsPreview = step.args ? JSON.stringify(step.args).substring(0, 120) : '';

        if (step.approvalRequired) {
            stepEl.classList.add('approval-pending');
            
            let reviewBtn = '';
            if (step.diffReviewRequired) {
                const escapedArgs = JSON.stringify(step.args).replace(/'/g, "\\'");
                reviewBtn = `<button class="review-btn" onclick="reviewDiff('${step.toolCallId}', '${step.toolName}', '${escapedArgs}')">Review Changes</button>`;
            }

            stepEl.innerHTML = `
                <div class="step-header">
                    <span class="step-icon">${icon}</span>
                    <span class="step-tool-name">${step.toolName}</span>
                    <span class="step-status awaiting">Awaiting Approval</span>
                </div>
                <div class="step-args">${argsPreview}</div>
                <div class="step-actions">
                    ${reviewBtn}
                    <button class="approve-btn" onclick="approveTool('${step.toolCallId}', true)">Approve</button>
                    <button class="deny-btn" onclick="approveTool('${step.toolCallId}', false)">Deny</button>
                </div>
            `;
        } else {
            stepEl.innerHTML = `
                <div class="step-header">
                    <span class="step-icon">${icon}</span>
                    <span class="step-tool-name">${step.toolName}</span>
                    <span class="step-status running">Running</span>
                </div>
                <div class="step-args">${argsPreview}</div>
            `;
        }
    } else if (step.type === 'tool_result') {
        // Find the last running step and mark it as done
        const lastRunning = stepsContainer.querySelector('.step-status.running:last-child') ||
                           stepsContainer.querySelector('.step-status.running');
        if (lastRunning) {
            lastRunning.textContent = 'Done';
            lastRunning.classList.remove('running');
            lastRunning.classList.add('done');
        }
        // Don't create a new card for results
        scrollToBottom();
        return;
    } else if (step.type === 'thinking') {
        stepEl.innerHTML = `
            <div class="step-header">
                <span class="step-icon">✅</span>
                <span class="step-tool-name">${step.text}</span>
            </div>
        `;
    }

    stepsContainer.appendChild(stepEl);
    scrollToBottom();
}

window.approveTool = (toolCallId, approved) => {
    sendMessage('chatToolApproval', { toolCallId, approved });
    
    // Find the button that was clicked to identify the card
    const btn = document.querySelector(`.approve-btn[onclick*="${toolCallId}"], .deny-btn[onclick*="${toolCallId}"]`);
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
            
            // If approved, it will soon transition to "Running" when the backend continues
        }
    }
};

window.reviewDiff = (toolCallId, toolName, argsStr) => {
    try {
        const args = JSON.parse(argsStr);
        sendMessage('chatReviewDiff', { toolCallId, toolName, args });
    } catch (e) {
        console.error('Failed to parse diff args', e);
    }
};


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
        }, 0);

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
            toggleSendButton(0);
            break;

        case CHAT_COMMANDS.CHAT_STREAM_START:
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
            }
            break;

        case CHAT_COMMANDS.CHAT_STREAM_END:
            hideLoadingIndicator(); // Always hide loading, even if no chunks arrived
            if (activeStreamNode) {
                setTimeout(() => {
                    hljs.highlightAll();
                    addAllCopyButtons();
                }, 0);
            }
            activeStreamNode = null;
            activeStreamAccumulator = "";
            toggleSendButton(0);
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

        default:
            console.error('Unknown command:', message.command);
    }
});
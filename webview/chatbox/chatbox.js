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
function sendMessage(command, data='') {
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

// --- HELPER FUNCTIONS ---


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



function toggleSendButton(mode="off"){
    mode==="disabled" ? sendButton.classList.add("disabled") : sendButton.classList.remove("disabled"); 
}


function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getCurrentDate(){
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
            <img src="${image.dataUrl}" class="attachment-image" alt="img">
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

// Handle image files from input or paste
function handleImageFiles(fileList, source) {
    const files = Array.from(fileList);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length > 0) {
        imageFiles.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const name = (source === 'upload') ? file.name : 'Pasted Image';
                
                attachedImages.push({
                    dataUrl: e.target.result,
                    name: name
                });
                renderAttachments();
            };
            reader.readAsDataURL(file);
        });
    }
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

function appendUserMessage(message, images = []){

  const finalHTML = processMessageContent(message);
    
  let imagesHTML = '';
  if (images.length > 0) {
      imagesHTML = '<div class="message-images-grid">';
      images.forEach(image => {
          // image.dataUrl is either Base64 (Live) or vscode-resource:// (History)
          // Both work automatically in the <img> tag.
          imagesHTML += `<img src="${image.dataUrl}" class="chat-bubble-image" alt="${image.name || 'Attached Image'}" title="${image.name}">`;
      });
      imagesHTML += '</div>';
  }
    
  const userResponseHTML = `<div class="message-content user-message">
          ${imagesHTML}
          <span class="message-text">${finalHTML}</span>
          <div class="message-time">${getCurrentDate()}</div>
        </div> `;

  if (!chatWelcomeMessage.classList.contains('hidden')) {
      chatWelcomeMessage.classList.add('hidden');
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
  }


  const tempDiv = document.createElement('div');
  

  tempDiv.innerHTML = systemResponseHTML;

  const newMessageElement = tempDiv.firstElementChild;
  
  chatbox.appendChild(newMessageElement);
  
  hljs.highlightAll();
  addAllCopyButtons();
  scrollToBottom();
}


function chatRequest(content){
    sendMessage('chatRequest', content);
    appendUserMessage(content.message, content.images);
}

function resetChat(content) {
    chatMessages.innerHTML = '';
    chatLog.dataset.chatId = content.uid;
    attachedImages = [];
    renderAttachments();
    chatWelcomeMessage.classList.remove('hidden');
    showChatView(); // Make sure we're on the chat view
    chatMessage.focus();
}



// 1. Send Button Click
sendButton.addEventListener("click", event => {
  const messageText = chatMessage.innerText.trim();
  
  // Update Condition: Check for files too
  if (messageText || attachedImages.length > 0 || attachedFiles.length > 0) { 
    
    // --- PREPARE PAYLOAD ---
    const payload = {
        message: messageText, 
        images: attachedImages, 
        
        // CRITICAL: Send the attached files to the backend
        files: attachedFiles, 
        
        chat_id: chatLog.dataset.chatId, 
        timestamp: new Date().toISOString()
    };

    // --- SEND ---
    sendMessage(CHAT_COMMANDS.CHAT_REQUEST, payload);
  
    // --- UI CLEANUP ---
    showLoadingIndicator(); // Show dots while waiting for backend echo
    toggleSendButton("disabled");
    
    chatMessage.innerText = "";
    
    // Clear both arrays
    attachedImages = []; 
    attachedFiles = [];
    
    renderAttachments(); // Removes the pills from the screen
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

    // 4. Parse the Context Block to find files
    // Regex looks for: File: name.ext \n ```lang ...content... ```
    const fileRegex = /File:\s*(.*?)\n```(\w*)\n([\s\S]*?)```/g;
    
    let match;
    let attachmentsHTML = '<div class="attachments-container">';
    let foundFiles = false;

    // Loop through all matches in the context block
    while ((match = fileRegex.exec(contextBlock)) !== null) {
        foundFiles = true;
        const fileName = match[1].trim();
        const language = match[2].trim();
        const codeContent = match[3];

        // Highlight the code using marked/hljs
        const highlightedCode = marked.parse(`\`\`\`${language}\n${codeContent}\`\`\``);

        attachmentsHTML += `
            <details class="file-attachment">
                <summary class="file-summary">
                    <svg class="file-arrow" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
                    <svg class="file-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    <span>${escapeHtml(fileName)}</span>
                </summary>
                <div class="file-code-block">
                    ${highlightedCode}
                </div>
            </details>
        `;
    }
    attachmentsHTML += '</div>';

    if (foundFiles) {
        html += attachmentsHTML;
    }

    return html;
}


window.addEventListener('DOMContentLoaded', ()=>{
  sendMessage("ChatWebviewReady");

  const input = document.getElementById("messageInput");
        
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendButton.click();
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
      if (!text) {return;};

      // 4. Escape the text for HTML
      const escapedText = text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
          // Note: We don't replace \n with <br> because our CSS
          // 'white-space: pre-wrap' already handles newlines correctly.

      // 5. Use 'insertHTML'. This command inserts our plain, escaped text
      //    and correctly adds the action to the undo/redo stack.
      setTimeout(() =>{
        document.execCommand('insertHTML', false, escapedText);
      },0);

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
  });

  // Handle Item Clicks
  contextMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.context-item');
      if (!item) return;

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
      
      // Close menu
      contextMenu.classList.add('hidden');
  });
});


// --- EVENT LISTENERS ---
window.addEventListener('message', event => {
  const message = event.data; 
  switch (message.command) {
    case CHAT_COMMANDS.CHAT_REQUEST:
      hideLoadingIndicator();
      if (message.role === ROLE.USER) {
          appendUserMessage(message.content, message.images);
          if (!message.isHistory) {
             showLoadingIndicator();
          }
      }else{
          appendAIMessage(message.content);
      }
      // Re-enable send button
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
        
        // Prevent duplicates
        const exists = attachedFiles.find(f => f.name === fileData.name);
        if (exists) { return; };

        attachedFiles.push({
            name: fileData.name,
            content: fileData.text,
            language: fileData.language,
            lines: fileData.text.split('\n').length
        });
        
        renderAttachments();
        break;
    default:
      console.error('Unknown command:', message.command);
  }
});
// vscode api receiver
const vscode = acquireVsCodeApi();

// --- GLOBALS ---
const chatbox = document.getElementById("chatMessages");
const chatLog = document.getElementById("chatLog");
const chatWelcomeMessage = document.getElementById("chatWelcomeMessage");  
const sendButton = document.getElementById('sendButton');
const chatMessage = document.getElementById('messageInput');
const attachmentsPreviewContainer = document.getElementById('attachments-preview-container');

// NEW: Get new button elements
const addImageBtn = document.getElementById('add-image-btn');
const addFileBtn = document.getElementById('add-file-btn');
const imageUploadInput = document.getElementById('image-upload-input');


/**
 * Stores attached images as data:URLs
 * @type {string[]}
 */
let attachedImages = [];


// --- HELPER FUNCTIONS ---

function toggleSendButton(mode="off"){
    mode==="disabled" ? sendButton.classList.add("disabled") : sendButton.classList.remove("disabled"); 
}

function sendMessage(command, data='') {
  vscode.postMessage({
    command: command,
    data: data
  });
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
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    };
    return now.toLocaleString('en-US', options);
}

function scrollToBottom() {
    chatLog.scrollTop = chatLog.scrollHeight;
}

/**
 * Finds all <pre> blocks and adds a copy button if one doesn't exist.
 */
function addAllCopyButtons() {
    const pres = document.querySelectorAll('.message-text pre');
    pres.forEach(pre => {
      if (pre.querySelector('.copy-code-btn')) {
        return; 
      }
  
      const copyButton = document.createElement('button');
      copyButton.className = 'copy-code-btn';
      copyButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg> Copy`;
      copyButton.title = 'Copy code';
  
      copyButton.addEventListener('click', () => {
        const code = pre.querySelector('code');
        if (code) {
          navigator.clipboard.writeText(code.innerText).then(() => {
              const originalHtml = copyButton.innerHTML;
              copyButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!`;
              copyButton.disabled = true;
              
              setTimeout(() => {
                copyButton.innerHTML = originalHtml;
                copyButton.disabled = false;
              }, 2000);
          });
        }
      });
  
      pre.prepend(copyButton);
    });
  }

/**
 * Renders the image attachment "pills"
 */
function renderAttachments() {
    attachmentsPreviewContainer.innerHTML = '';
    
    attachedImages.forEach((imageDataUrl, index) => {
        const pill = document.createElement('div');
        pill.className = 'attachment-pill';
        
        pill.innerHTML = `
            <img src="${imageDataUrl}" class="attachment-image" alt="Attachment thumbnail">
            <span class="attachment-name">Pasted Image</span>
            <button class="remove-attachment" data-index="${index}" title="Remove image">&times;</button>
        `;
        
        attachmentsPreviewContainer.appendChild(pill);
    });
    
    attachmentsPreviewContainer.querySelectorAll('.remove-attachment').forEach(button => {
        button.addEventListener('click', (e) => {
            const indexToRemove = parseInt(e.currentTarget.dataset.index, 10);
            attachedImages.splice(indexToRemove, 1);
            renderAttachments();
        });
    });
    
    attachmentsPreviewContainer.style.display = attachedImages.length > 0 ? 'flex' : 'none';
}

/**
 * NEW: Reusable function to process a FileList
 * @param {FileList} fileList - The list of files from an input or paste event
 */
function handleImageFiles(fileList) {
    const files = Array.from(fileList);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length > 0) {
        imageFiles.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                attachedImages.push(e.target.result);
                renderAttachments();
            };
            reader.readAsDataURL(file);
        });
    }
}


// --- MESSAGE HANDLING ---

function appendUserMessage(message, images = []){
  const escapedMessage = escapeHtml(message);
  const formattedMessage = escapedMessage.replace(/\n/g, "<br>");
    
  let imagesHTML = '';
  if (images.length > 0) {
      imagesHTML = '<div class="message-images-container">';
      images.forEach(imgDataUrl => {
          // You should add CSS for .message-images-container and .message-image-attachment
          imagesHTML += `<img src="${imgDataUrl}" style="max-width: 100%; height: auto; border-radius: 8px; margin-top: 8px;" alt="User attachment">`;
      });
      imagesHTML += '</div>';
  }
    
  const userResponseHTML = `<div class="message-content user-message">
          ${imagesHTML}
          <span class="message-text">${formattedMessage}</span>
          <div class="message-time">${getCurrentDate()}</div>
        </div> `;

  if (!chatWelcomeMessage.classList.contains('hidden')) {
      chatWelcomeMessage.classList.add('hidden');
  }

  chatbox.innerHTML += userResponseHTML;
  scrollToBottom();
}


function appendAIMessage(response) { 
  const parsedResponse = marked.parse(response);

  const systemResponseHTML = `<div class="system-message">
            <div class="message-content">
                <div class="message-header"><span class="ai-icon">🤖</span> Companion</div>
                <span class="message-text">${parsedResponse}</span>
                <div class="message-time">${getCurrentDate()}</div>
            </div>
            </div>`;
            
  if (!chatWelcomeMessage.classList.contains('hidden')) {
      chatWelcomeMessage.classList.add('hidden');
  }

  chatbox.innerHTML += systemResponseHTML;
  
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
    welComeMessage.classList.remove('hidden'); 
    chatLog.dataset.chatId = content.uid;
    attachedImages = [];
    renderAttachments();
}


function loadHistory() {
    sendMessage('openHistory', '');
}


// --- EVENT LISTENERS ---

window.addEventListener('message', event => {
  const message = event.data; 
  switch (message.command) {
    case 'chatRequest':
      appendAIMessage(message.content);
      toggleSendButton(0);
      break;
    case 'resetChat':
      resetChat(message.content);
      break;
    case 'loadHistory':
      loadHistory();
      break;
    // NEW: Listen for file context from the extension
    case 'fileContextAdded':
        // The extension would send this message *back* after
        // the user selects a file.
        // `message.content` might be the file's text content.
        console.log('File context received:', message.content);
        // You could append this to the input or just use it as context.
        // For now, let's just log it.
        break;
    default:
      console.error('Unknown command:', message.command);
  }
});


sendButton.addEventListener("click", event => {
  const messageText = chatMessage.innerText.trim();
  
  if (messageText || attachedImages.length > 0) { 
    chatRequest({
        message: messageText, 
        images: attachedImages,
        chat_id: chatLog.dataset.chatId, 
        timestamp: new Date().toISOString()
    });
    
    toggleSendButton("disabled");
    chatMessage.innerText = "";
    attachedImages = []; 
    renderAttachments(); 
  }
});


window.addEventListener('DOMContentLoaded', ()=>{
  sendMessage('webviewReady');

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
      event.preventDefault();
      const clipboardData = event.clipboardData || window.clipboardData;
      
      // Check for image files
      if (clipboardData.files && clipboardData.files.length > 0) {
          // Use the new reusable function
          handleImageFiles(clipboardData.files);
          return;
      }

      // --- Fallback to plain text pasting ---
      const text = clipboardData.getData('text/plain');
      const selection = window.getSelection();
      if (!selection.rangeCount) {return;}; 

      const range = selection.getRangeAt(0);
      range.deleteContents(); 
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);

      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection.removeAllRanges();
      selection.addRange(range);
  });

  // --- NEW: Button Listeners ---

  // "Add Image" button clicks the hidden input
  addImageBtn.addEventListener('click', () => {
      imageUploadInput.click();
  });

  // Listen for when files are selected via the hidden input
  imageUploadInput.addEventListener('change', (e) => {
      if (e.target.files) {
          // Use the new reusable function
          handleImageFiles(e.target.files);
          // Clear the input value so the same file can be selected again
          e.target.value = null;
      }
  });

  // "Add File" button sends a message to the extension
  addFileBtn.addEventListener('click', () => {
      console.log('Requesting file context from extension...');
      // This message must be handled by your extension's backend
      // (e.g., in chat-message-listener.ts)
      sendMessage('addFileContext');
  });


  // --- End of New Listeners ---

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
});
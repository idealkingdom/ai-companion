// vscode api receiver
const vscode = acquireVsCodeApi();

// --- GLOBALS ---
const chatbox = document.getElementById("chatMessages");
const chatLog = document.getElementById("chatLog");
const chatWelcomeMessage = document.getElementById("chatWelcomeMessage");  
const sendButton = document.getElementById('sendButton');
const chatMessage = document.getElementById('messageInput');
const attachmentsPreviewContainer = document.getElementById('attachments-preview-container');
const addImageBtn = document.getElementById('add-image-btn');
const addFileBtn = document.getElementById('add-file-btn');
const imageUploadInput = document.getElementById('image-upload-input');

/**
 * Stores attached images as objects
 * @type {Array<{dataUrl: string, name: string}>}
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

function addAllCopyButtons() {
    const pres = document.querySelectorAll('.message-text pre');
    pres.forEach(pre => {
      if (pre.querySelector('.copy-code-btn')) { return; }
  
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

function renderAttachments() {
    attachmentsPreviewContainer.innerHTML = '';
    
    attachedImages.forEach((image, index) => {
        const pill = document.createElement('div');
        pill.className = 'attachment-pill';
        
        pill.innerHTML = `
            <img src="${image.dataUrl}" class="attachment-image" alt="Attachment thumbnail">
            <span class="attachment-name" title="${image.name}">${image.name}</span>
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
            <span class="ai-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bot-message-square-icon lucide-bot-message-square"><path d="M12 6V2H8"/><path d="M15 11v2"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M20 16a2 2 0 0 1-2 2H8.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 4 20.286V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/><path d="M9 11v2"/></svg></span>
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
  const escapedMessage = escapeHtml(message);
  const formattedMessage = escapedMessage.replace(/\n/g, "<br>");
    
  let imagesHTML = '';
  if (images.length > 0) {
      imagesHTML = '<div class="message-images-container" style="display: flex; flex-wrap: wrap; gap: 8px;">';
      images.forEach(image => {
          imagesHTML += `<img src="${image.dataUrl}" style="max-width: 150px; height: auto; border-radius: 8px; margin-top: 8px;" alt="${image.name}">`;
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
                <div class="message-header"><span class="ai-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bot-message-square-icon lucide-bot-message-square"><path d="M12 6V2H8"/><path d="M15 11v2"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M20 16a2 2 0 0 1-2 2H8.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 4 20.286V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/><path d="M9 11v2"/></svg></span> Companion</div>
                <span class="message-text">${parsedResponse}</span>
                <div class="message-time">${getCurrentDate()}</div>
            </div>
            </div>`;
            
  // *** BUGFIX: Changed .contents (which doesn't exist) to .contains ***
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
    console.error(content.uid);
    chatLog.dataset.chatId = content.uid;
    attachedImages = [];
    renderAttachments();
    chatWelcomeMessage.classList.remove('hidden');
    chatMessage.focus();
}


function loadHistory() {
    sendMessage('openHistory', '');
}


// --- EVENT LISTENERS ---

window.addEventListener('message', event => {
  const message = event.data; 
  switch (message.command) {
    case 'chatRequest':
      hideLoadingIndicator();
      appendAIMessage(message.content);
      toggleSendButton(0);
      break;
    case 'resetChat':
      resetChat(message.content);
      break;
    case 'loadHistory':
      loadHistory();
      break;
    case 'fileContextAdded':
        console.log('File context received:', message.content);
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
    
    showLoadingIndicator();

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
  
// ----------------------------------------------------
  // DELETE your old "paste" event listener
  // ----------------------------------------------------

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
      if (!text) return;

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
  // --- Button Listeners ---
  addImageBtn.addEventListener('click', () => {
      imageUploadInput.click();
  });

  imageUploadInput.addEventListener('change', (e) => {
      if (e.target.files) {
          handleImageFiles(e.target.files, 'upload');
          e.target.value = null;
      }
  });

  addFileBtn.addEventListener('click', () => {
      sendMessage('addFileContext');
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
});
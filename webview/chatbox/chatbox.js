// vscode api receiver
const vscode = acquireVsCodeApi();
// send message to extension

// chatbox elements

const chatbox = document.getElementById("chatMessages");
const chatWelcomeMessage = document.getElementById("chatWelcomeMessage");  
// send button element
const sendButton = document.getElementById('sendButton');
const chatMessage = document.getElementById('messageInput');


function toggleSendButton(mode="off"){
    mode==="disabled" ? sendButton.classList.add("disabled") : sendButton.classList.remove("disabled"); 
}


function sendMessage(command, data='') {
  vscode.postMessage({
    command: command,
    data: data
  });
}

//escapeHTML
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "<br>");
}

//get current date
function getCurrentDate(){
    const now = new Date();

    const options = {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false, // set to true for AM/PM
    };

    const formatted = now.toLocaleString('en-US', options);

    return formatted;
}


// append user message
function appendUserMessage(message){
  
  // Add message with placeholder div for Ace editor
  const userResponseHTML = `<div class="message-content user-message">
          <span class="message-text">${escapeHtml(message)}</span>
          <div class="message-time">${getCurrentDate()}</div>
        </div> `;

  // hide welcome message
  chatWelcomeMessage.classList.add('hidden');
  chatbox.innerHTML += userResponseHTML;
  console.log(chatbox);
  
}


// chat Request
function chatRequest(content){
    sendMessage('chatRequest', content);
    appendUserMessage(content.message);
}

// handle when new chat is triggered
function resetChat(content) {
  // clear the UI chat
    const chatLog = document.getElementById('chatLog');
    const chatMessages = document.getElementById('chatMessages');
    const welComeMessage = document.getElementById('chatWelcomeMessage');
    chatMessages.innerHTML = '';
    welComeMessage.classList.remove('hidden');
    chatLog.dataset.chatId = content.uid;
    
}

//handle when open history is triggered
function loadHistory() {
    // send a message to the extension to open the history
    sendMessage('openHistory', '');
}



function appendAIMessage(response, lang = 'html', comment = '') { 
  // Add message with placeholder div for Ace editor
  parsedResponse = marked.parse(response);

  const systemResponseHTML = `<div class="system-message">
            <div class="message-header"><span class="ai-icon">🤖</span></div>
            <div class="message-content">
                <span class="message-text"><p></p>${parsedResponse}</span>
                <div class="message-time">${getCurrentDate()}</div>
            </div>
            </div>`;
            
  // hide welcome message
  chatWelcomeMessage.classList.add('hidden');
  chatbox.innerHTML +=systemResponseHTML;
  // Activate highlight.js after rendering
  hljs.highlightAll();
  console.log(chatbox);

}




// handle incoming messages
window.addEventListener('message', event => {
  const message = event.data; // The JSON data that the extension sent
  switch (message.command) {
    case 'chatRequest':
      console.log('got a response');
      // update the chat messages
      appendAIMessage(message.content);
      toggleSendButton(0);
      break;
    case 'resetChat':
      // reset the chat messages
      resetChat(message.content);
      break;
    case 'loadHistory':
      // load the history
      loadHistory();
      break;
    default:
      console.error('Unknown command:', message.command);
  }
});



sendButton.addEventListener("click", event=>{
  const chatLog = document.getElementById('chatLog');
    chatRequest({message: chatMessage.innerText, chat_id: chatLog.dataset.chatId, timestamp: new Date().toISOString()});
    toggleSendButton("disabled");
    // clear message input
      chatMessage.innerText = "";
});


 
//when DOM is loaded
window.addEventListener('DOMContentLoaded', ()=>{
  // fire to know the webview is loaded
  sendMessage('webviewReady');


  const input = document.getElementById("messageInput");
        // Resize on input change
    input.addEventListener("focusout", () => {
            if (!input.textContent.trim().length) {
                // empty using vanilla js
                input.textContent = "";
            }
        });
    // trigger once loaded to make sure behavior is corrected
    input.focus();

  // highlight all code markdowns
  // Configure marked to use highlight.js
  marked.setOptions({
    highlight: function (code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    },
    langPrefix: 'hljs language-', // for highlight.js styling
    gfm: true,
    breaks: true
  });

});
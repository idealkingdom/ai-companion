// VARIABLES


export const HISTORY_FILENAME = 'chat_history.json';

export const LIBRARY_FOLDER = 'libraries';
export const CHATBOX_FOLDER = 'chatbox';
export const INDEX_HTML = 'chatbox.html';

export const FILES_TO_LOAD = [
  { name: 'chatbox.js', placeholder: '{{scriptPath}}' },
  { name: 'chatbox.css', placeholder: '{{stylePath}}' },
  { name: 'history.js', placeholder: '{{scriptHistoryPath}}' },
  { name: 'history.css', placeholder: '{{styleHistoryPath}}' },
];

export const LIBRARIES_TO_LOAD = [
  { name: 'htmx.min.js', folderName: 'htmx', placeholder: '{{htmxSriptPath}}' },
  { name: 'ace.min.js', folderName: 'ace', placeholder: '{{aceScriptPath}}' },
  { name: 'ace.min.css', folderName: 'ace', placeholder: '{{aceStylePath}}' },
  { name: 'marked.umd.js', folderName: 'marked', placeholder: '{{markedScriptPath}}' },
  { name: 'default.min.css', folderName: 'highlight', placeholder: '{{highlightStylePath}}' },
  { name: 'highlight.min.js', folderName: 'highlight', placeholder: '{{highlightScriptPath}}' },
  { name: 'go.min.js', folderName: 'highlight', placeholder: '{{highlightGoScriptPath}}' },
  { name: 'python.min.js', folderName: 'highlight', placeholder: '{{highlightPythonScriptPath}}' },
  { name: 'javascript.min.js', folderName: 'highlight', placeholder: '{{highlightJsScriptPath}}' },
  { name: 'typescript.min.js', folderName: 'highlight', placeholder: '{{highlightTsScriptPath}}' },
  { name: 'cpp.min.js', folderName: 'highlight', placeholder: '{{highlightCppScriptPath}}' },
  { name: 'rust.min.js', folderName: 'highlight', placeholder: '{{highlightRustScriptPath}}' },
  { name: 'ruby.min.js', folderName: 'highlight', placeholder: '{{highlightRubyScriptPath}}' },
  { name: 'java.min.js', folderName: 'highlight', placeholder: '{{highlightJavaScriptPath}}' },
];


// ENUMS
export enum ROLE {
  USER = 'user',
  BOT = 'bot',
}


// commands messages for chat webview and extension
export enum CHAT_COMMANDS {
  CHAT_WEBVIEW_READY = 'ChatWebviewReady',
  CHAT_RESET = 'resetChat',
  CHAT_REQUEST = 'chatRequest',
  CHAT_LOAD = 'loadChat',
  HISTORY_LOAD = 'loadHistory',
  HISTORY_CLEAR = 'clearHistory',
  CONVERSATION_DELETE = 'deleteHistoryItem',
  HISTORY_SEARCH = 'searchHistory',
  ADD_CONTEXT = 'addContext',
  FILE_CONTEXT_ADDED = 'fileContextAdded',
  PROBLEM_CONTEXT_ADDED = 'problemContextAdded'
}



export interface StoredMessage {
  message_id: string;       // Unique ID for every message
  role: ROLE;
  message: string;
  timestamp: string;
  images?: string[];
  imageDescriptions?: string[]; // Cached descriptions for fallback/memory
}


export interface Conversation {
  chat_id: string;       // The chat_id
  title: string;    // Title (e.g. "How to use React")
  timestamp: string; // Last modified time
  messages: StoredMessage[];
}

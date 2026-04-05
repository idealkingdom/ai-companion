import { ProviderRegistry } from './providers/index.js';

const vscode = acquireVsCodeApi();

// --- STATE ---
let currentSettings = {
    general: { temperature: 0.7, maxContextMessages: 10 },
    models: {
        textModel: 'gpt-4o', imageModel: 'gpt-4o-mini', baseUrl: '', apiKey: '', provider: 'OpenAI',
        providerSettings: {}
    },
    prompts: [],
    permissions: {
        readFilesConfirmation: false,
        writeFilesConfirmation: true,
        runCommandsConfirmation: true
    }
};

// Default lists to show before fetching
// Models injected from backend
let DEFAULT_MODELS = window.VS_MODELS || {
};

// --- DOM ELEMENTS ---
const tabs = document.querySelectorAll('.nav-item');
const contents = document.querySelectorAll('.tab-view');
const saveBtn = document.getElementById('saveBtn');
const addPromptBtn = document.getElementById('addPromptBtn');
const promptsList = document.getElementById('promptsList');

// Inputs
const providerSelect = document.getElementById('providerSelect');
const apiKeyInput = document.getElementById('apiKeyInput');
const baseUrlInput = document.getElementById('baseUrlInput');
const textModelInput = document.getElementById('textModelInput');
const imageModelInput = document.getElementById('imageModelInput');
const tempInput = document.getElementById('tempInput');
const tempValue = document.getElementById('tempValue');
const contextInput = document.getElementById('contextInput');
const readFilesConfirmationToggle = document.getElementById('readFilesConfirmationToggle');
const writeFilesConfirmationToggle = document.getElementById('writeFilesConfirmationToggle');
const runCommandsConfirmationToggle = document.getElementById('runCommandsConfirmationToggle');
const showKeyToggleBtn = document.getElementById('showKeyToggleBtn');
let isKeyVisible = false;
// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
    // Request settings from extension
    vscode.postMessage({ command: 'requestSettings' });
    populateModelDropdowns(currentSettings.models.provider);
});

// Listener for Provider Change (Switching contexts)
providerSelect.addEventListener('change', (e) => {
    const newProvider = e.target.value;

    // 2. Update current active provider
    currentSettings.models.provider = newProvider;

    // Ensure providerSettings exists
    if (!currentSettings.models.providerSettings) {
        currentSettings.models.providerSettings = {};
    }

    // 3. Load values for new Provider
    const providerInstance = ProviderRegistry.get(newProvider);
    const providerDefaults = providerInstance.getDefaults();

    let defaults = currentSettings.models.providerSettings[newProvider] || { ...providerDefaults };

    // PRESET BASE URL if empty
    if (!defaults.baseUrl && (!defaults.apiKey || defaults.apiKey === '')) {
        defaults.baseUrl = providerDefaults.baseUrl;
    }

    // Determine target values
    const defaultText = providerDefaults.textModel;
    const defaultImage = providerDefaults.imageModel;

    const targetText = defaults.textModel || defaultText;
    const targetImage = defaults.imageModel || defaultImage;

    // Repopulate Dropdowns (Pass target values to ensure they are added if missing)
    populateModelDropdowns(newProvider, targetText, targetImage);

    // Update inputs
    apiKeyInput.value = defaults.apiKey || '';
    baseUrlInput.value = defaults.baseUrl || '';
    textModelInput.value = targetText;
    imageModelInput.value = targetImage;

    // Update active state
    currentSettings.models.apiKey = defaults.apiKey;
    currentSettings.models.baseUrl = defaults.baseUrl;
    currentSettings.models.textModel = textModelInput.value;
    currentSettings.models.imageModel = imageModelInput.value;
});

// Real-time updates for Model Inputs to persist to providerSettings
const modelInputs = [apiKeyInput, baseUrlInput, textModelInput, imageModelInput];
modelInputs.forEach(input => {
    input.addEventListener('input', () => {
        const provider = currentSettings.models.provider;

        // Ensure structure
        if (!currentSettings.models.providerSettings) {
             currentSettings.models.providerSettings = {};
        }
        if (!currentSettings.models.providerSettings[provider]) {
            currentSettings.models.providerSettings[provider] = {};
        }

        // Update specific field
        if (input === apiKeyInput) { currentSettings.models.providerSettings[provider].apiKey = input.value; }
        if (input === baseUrlInput) { currentSettings.models.providerSettings[provider].baseUrl = input.value; }
        if (input === textModelInput) { currentSettings.models.providerSettings[provider].textModel = input.value; }
        if (input === imageModelInput) { currentSettings.models.providerSettings[provider].imageModel = input.value; }

        // Also update the top-level active key for backward compatibility/immediate use
        if (input === apiKeyInput) { currentSettings.models.apiKey = input.value; }
        if (input === baseUrlInput) { currentSettings.models.baseUrl = input.value; }
        if (input === textModelInput) { currentSettings.models.textModel = input.value; }
        if (input === imageModelInput) { currentSettings.models.imageModel = input.value; }
    });
});

// --- EVENT LISTENERS ---

// Tab Switching
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));

        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
    });
});

// Temperature Slider
tempInput.addEventListener('input', (e) => {
    tempValue.textContent = e.target.value;
});

// Toggle API Key Visibility
showKeyToggleBtn.addEventListener('click', () => {
    isKeyVisible = !isKeyVisible;
    apiKeyInput.setAttribute('type', isKeyVisible ? 'text' : 'password');
    // Change SVG or opacity slightly to indicate toggle
    showKeyToggleBtn.style.opacity = isKeyVisible ? '1' : '0.5';
});



// Save Button
saveBtn.addEventListener('click', () => {
    collectSettings();
    vscode.postMessage({
        command: 'saveSettings',
        settings: currentSettings
    });
    
    // Toast UI Animation
    const toast = document.getElementById('toastNotification');
    if (toast) {
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
    }
});

// Add Prompt Button
addPromptBtn.addEventListener('click', () => {
    const newId = Date.now().toString(); // Simple ID
    currentSettings.prompts.push({
        id: newId,
        name: 'New Agent',
        content: 'You are a helpful assistant.',
        isActive: true,
        order: currentSettings.prompts.length + 1
    });
    renderPrompts();
});

// Handle Messages from Extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'loadSettings':
            currentSettings = message.settings;
            // Update available models from backend source of truth
            if (message.availableModels) {
                DEFAULT_MODELS = message.availableModels;
            }

            // Ensure providerSettings exists in loaded data
            if (!currentSettings.models.providerSettings) {
                currentSettings.models.providerSettings = {};
            }
            // First populate dropdowns based on the load
            populateModelDropdowns(currentSettings.models.provider, currentSettings.models.textModel, currentSettings.models.imageModel);
            populateForm();
            renderPrompts();
            break;

    }
});


// --- FUNCTIONS ---

function populateForm() {
    const { general, models, permissions } = currentSettings;

    // Models
    providerSelect.value = models.provider;
    apiKeyInput.value = models.apiKey;
    baseUrlInput.value = models.baseUrl;
    textModelInput.value = models.textModel;
    imageModelInput.value = models.imageModel;

    // General
    tempInput.value = general.temperature;
    tempValue.textContent = general.temperature;
    contextInput.value = general.maxContextMessages;

    // Permissions
    if (permissions) {
        if (readFilesConfirmationToggle) { readFilesConfirmationToggle.checked = permissions.readFilesConfirmation; }
        if (writeFilesConfirmationToggle) { writeFilesConfirmationToggle.checked = permissions.writeFilesConfirmation; }
        if (runCommandsConfirmationToggle) { runCommandsConfirmationToggle.checked = permissions.runCommandsConfirmation; }
    }
}

function collectSettings() {
    currentSettings.general.temperature = parseFloat(tempInput.value);
    currentSettings.general.maxContextMessages = parseInt(contextInput.value);
    
    if (!currentSettings.permissions) currentSettings.permissions = {};
    currentSettings.permissions.readFilesConfirmation = readFilesConfirmationToggle.checked;
    currentSettings.permissions.writeFilesConfirmation = writeFilesConfirmationToggle.checked;
    currentSettings.permissions.runCommandsConfirmation = runCommandsConfirmationToggle.checked;
}

function renderPrompts() {
    promptsList.innerHTML = '';

    if (currentSettings.prompts.length === 0) {
        promptsList.innerHTML = `<div class="empty-state" style="padding:40px; text-align:center; color:var(--text-muted); border: 2px dashed var(--panel-border); border-radius: 8px;">No Agent profiles defined. Click '+ New Agent' to build one.</div>`;
        return;
    }

    // Sort by Order
    currentSettings.prompts.sort((a, b) => a.order - b.order);

    currentSettings.prompts.forEach((prompt, index) => {
        const item = document.createElement('div');
        item.className = 'agent-card';

        // Define HTML structure for the Agent Card
        item.innerHTML = `
            <div class="agent-card-header" style="display:flex; justify-content:space-between; align-items:center;">
                <div class="agent-avatar" style="display:flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:8px; background:rgba(92,110,255,0.1); color:var(--accent-color);">
                   <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                </div>
                <div class="prompt-controls" style="display:flex; gap: 8px;">
                    <button class="icon-btn move-up" title="Move Left" style="background:transparent; border:none; cursor:pointer; color:var(--text-muted);" ${index === 0 ? 'disabled' : ''}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
                    </button>
                    <button class="icon-btn move-down" title="Move Right" style="background:transparent; border:none; cursor:pointer; color:var(--text-muted);" ${index === currentSettings.prompts.length - 1 ? 'disabled' : ''}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
                    </button>
                    <button class="icon-btn delete" title="Delete" style="background:transparent; border:none; cursor:pointer; color:#ff5c5c;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2h2"/></svg>
                    </button>
                </div>
            </div>
            <div class="prompt-body" style="margin-top: 16px;">
                <div class="form-group mb-3" style="margin-bottom:12px;">
                    <label>Agent Name</label>
                    <input type="text" class="styled-input prompt-name-input" value="${escapeHtml(prompt.name)}" placeholder="e.g. Assistant">
                </div>
                <div class="form-group">
                    <label>Identity / System Prompt</label>
                    <textarea rows="4" class="styled-input prompt-text" placeholder="e.g. You are an expert AI...">${escapeHtml(prompt.content)}</textarea>
                </div>
            </div>
        `;

        // Add Listeners

        // Name Change
        item.querySelector('.prompt-name-input').addEventListener('input', (e) => {
            prompt.name = e.target.value;
        });

        // Content Change
        item.querySelector('.prompt-text').addEventListener('input', (e) => {
            prompt.content = e.target.value;
        });

        // Move Up
        item.querySelector('.move-up').addEventListener('click', (e) => {
            e.stopPropagation();
            if (index > 0) {
                const temp = currentSettings.prompts[index];
                currentSettings.prompts[index] = currentSettings.prompts[index - 1];
                currentSettings.prompts[index - 1] = temp;
                currentSettings.prompts.forEach((p, i) => p.order = i + 1);
                renderPrompts();
            }
        });

        // Move Down
        item.querySelector('.move-down').addEventListener('click', (e) => {
            e.stopPropagation();
            if (index < currentSettings.prompts.length - 1) {
                const temp = currentSettings.prompts[index];
                currentSettings.prompts[index] = currentSettings.prompts[index + 1];
                currentSettings.prompts[index + 1] = temp;
                currentSettings.prompts.forEach((p, i) => p.order = i + 1);
                renderPrompts();
            }
        });

        // Delete
        item.querySelector('.delete').addEventListener('click', (e) => {
            e.stopPropagation();
            currentSettings.prompts = currentSettings.prompts.filter(p => p.id !== prompt.id);
            currentSettings.prompts.forEach((p, i) => p.order = i + 1);
            renderPrompts();
        });

        promptsList.appendChild(item);
    });
}

function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function populateModelDropdowns(provider, selectedText, selectedImage) {

    const data = DEFAULT_MODELS[provider] || DEFAULT_MODELS['OpenAI'];

    // Safety check: specific model data might not be loaded yet
    if (!data) return;

    // Structure from backend is { name: '...', models: { text: [], image: [] } }
    // But we should also fail-safe if structure is flat
    const source = data.models || data;

    if (!source || !source.text) return;

    let textList = [...source.text];
    let imageList = [...source.image];

    // If selected model is not in default list, add it (preserves previously fetched selection)
    if (selectedText && !textList.includes(selectedText)) {
        textList.push(selectedText);
    }
    if (selectedImage && !imageList.includes(selectedImage)) {
        imageList.push(selectedImage);
    }

    // Text
    textModelInput.innerHTML = textList.map(m => `<option value="${m}">${m}</option>`).join('');
    // Image
    imageModelInput.innerHTML = imageList.map(m => `<option value="${m}">${m}</option>`).join('');
}

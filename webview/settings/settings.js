const vscode = acquireVsCodeApi();

// --- STATE ---
let currentSettings = {
    general: { temperature: 0.7, maxContextMessages: 10 },
    models: {
        textModel: 'gpt-4o', imageModel: 'gpt-4o-mini', baseUrl: '', apiKey: '', provider: 'OpenAI',
        providerSettings: {}
    },
    prompts: []
};

// Default lists to show before fetching
const DEFAULT_MODELS = {
    'OpenAI': {
        text: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
        image: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'] // Vision capable models
    },
    'Gemini': {
        text: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'],
        image: ['gemini-1.5-flash', 'gemini-1.5-pro']
    }
};

// --- DOM ELEMENTS ---
const tabs = document.querySelectorAll('.nav-tab');
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
const showKeyToggle = document.getElementById('showKeyToggle');
const fetchModelsBtn = document.getElementById('fetchModelsBtn');


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
    let defaults = currentSettings.models.providerSettings[newProvider] || { apiKey: '', baseUrl: '', textModel: '', imageModel: '' };

    // PRESET BASE URL if empty
    if (!defaults.baseUrl && (!defaults.apiKey || defaults.apiKey === '')) {
        // Only preset if effectively empty/unused to avoid overwriting user intent
        if (newProvider === 'OpenAI') defaults.baseUrl = 'https://api.openai.com/v1';
        if (newProvider === 'Gemini') defaults.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    }

    // Determine target values
    const defaultText = newProvider === 'Gemini' ? 'gemini-1.5-pro' : 'gpt-4o';
    const defaultImage = newProvider === 'Gemini' ? 'gemini-1.5-flash-8b' : 'dall-e-3';

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
        if (!currentSettings.models.providerSettings) currentSettings.models.providerSettings = {};
        if (!currentSettings.models.providerSettings[provider]) {
            currentSettings.models.providerSettings[provider] = {};
        }

        // Update specific field
        if (input === apiKeyInput) currentSettings.models.providerSettings[provider].apiKey = input.value;
        if (input === baseUrlInput) currentSettings.models.providerSettings[provider].baseUrl = input.value;
        if (input === textModelInput) currentSettings.models.providerSettings[provider].textModel = input.value;
        if (input === imageModelInput) currentSettings.models.providerSettings[provider].imageModel = input.value;

        // Also update the top-level active key for backward compatibility/immediate use
        if (input === apiKeyInput) currentSettings.models.apiKey = input.value;
        if (input === baseUrlInput) currentSettings.models.baseUrl = input.value;
        if (input === textModelInput) currentSettings.models.textModel = input.value;
        if (input === imageModelInput) currentSettings.models.imageModel = input.value;
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
showKeyToggle.addEventListener('change', (e) => {
    apiKeyInput.setAttribute('type', e.target.checked ? 'text' : 'password');
});

// Fetch Models
fetchModelsBtn.addEventListener('click', () => {
    const provider = currentSettings.models.provider;
    // Uses current input values (user might have just typed them without switching providers)
    const apiKey = apiKeyInput.value;
    const baseUrl = baseUrlInput.value;

    vscode.postMessage({
        command: 'fetchModels',
        provider,
        apiKey,
        baseUrl
    });
});

// Save Button
saveBtn.addEventListener('click', () => {
    collectSettings();
    vscode.postMessage({
        command: 'saveSettings',
        settings: currentSettings
    });
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
            // Ensure providerSettings exists in loaded data
            if (!currentSettings.models.providerSettings) {
                currentSettings.models.providerSettings = {};
            }
            // First populate dropdowns based on the load
            populateModelDropdowns(currentSettings.models.provider, currentSettings.models.textModel, currentSettings.models.imageModel);
            populateForm();
            renderPrompts();
            break;
        case 'updateModelList':
            const { textModels, imageModels } = message;

            // Populate Text Select
            const textOptions = textModels.map(m => `<option value="${m}">${m}</option>`).join('');

            // Populate Image Select
            const imageOptions = imageModels.map(m => `<option value="${m}">${m}</option>`).join('');

            // Preserve current selection if possible
            const currentText = textModelInput.value;
            const currentImage = imageModelInput.value;

            textModelInput.innerHTML = textOptions;
            imageModelInput.innerHTML = imageOptions;

            // Try to restore selection
            if (textModels.includes(currentText)) textModelInput.value = currentText;
            if (imageModels.includes(currentImage)) imageModelInput.value = currentImage;

            break;
    }
});


// --- FUNCTIONS ---

function populateForm() {
    const { general, models } = currentSettings;

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
}

function collectSettings() {
    currentSettings.general.temperature = parseFloat(tempInput.value);
    currentSettings.general.maxContextMessages = parseInt(contextInput.value);
}

function renderPrompts() {
    promptsList.innerHTML = '';

    if (currentSettings.prompts.length === 0) {
        promptsList.innerHTML = `<div class="empty-state" style="padding:20px; text-align:center; color:#8b949e">No prompt chains defined. Click '+ Add Prompt' to create one.</div>`;
        return;
    }

    // Sort by Order
    currentSettings.prompts.sort((a, b) => a.order - b.order);

    currentSettings.prompts.forEach((prompt, index) => {
        const item = document.createElement('div');
        item.className = 'prompt-item';

        // Define HTML structure
        item.innerHTML = `
            <div class="prompt-header">
                <div class="prompt-index">${index + 1}</div>
                <input type="text" class="prompt-name-input" value="${escapeHtml(prompt.name)}" placeholder="Agent Name">
                <div class="prompt-controls">
                    <button class="icon-btn move-up" title="Move Up" ${index === 0 ? 'disabled' : ''}>▲</button>
                    <button class="icon-btn move-down" title="Move Down" ${index === currentSettings.prompts.length - 1 ? 'disabled' : ''}>▼</button>
                    
                    <label class="switch" style="display:flex; align-items:center; margin:0 8px;">
                        <input type="checkbox" class="active-toggle" ${prompt.isActive ? 'checked' : ''}>
                         <!-- Basic toggle styling needed if not in CSS, assuming browser default or simple checkbox for now to save space -->
                    </label>
                    <button class="icon-btn delete" title="Delete">🗑️</button>
                </div>
            </div>
            <div class="prompt-body">
                <div class="form-group">
                    <label>System Prompt</label>
                    <textarea rows="3" class="prompt-text" placeholder="e.g. You are a helpful assistant...">${escapeHtml(prompt.content)}</textarea>
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

        // Toggle Active
        item.querySelector('.active-toggle').addEventListener('change', (e) => {
            prompt.isActive = e.target.checked;
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

        // Expand/Collapse (Clicking header)
        const header = item.querySelector('.prompt-header');
        const content = item.querySelector('.prompt-body');
        header.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
            item.classList.toggle('expanded');
            content.style.display = content.style.display === 'none' ? 'block' : 'none';
        });

        // Init state
        content.style.display = 'block';

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
    let textList = [...data.text];
    let imageList = [...data.image];

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

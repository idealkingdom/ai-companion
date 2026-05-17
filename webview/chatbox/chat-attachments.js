
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


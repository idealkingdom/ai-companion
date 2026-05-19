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
            <button class="refresh-btn" onclick="this.classList.add('refreshing'); this.disabled = true; this.querySelector('svg').classList.add('spin'); sendMessage('refreshIndex', { chatId: chatLog.dataset.chatId });">
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


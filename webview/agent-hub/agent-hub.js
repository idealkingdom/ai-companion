/**
 * Agent Hub — Frontend Logic
 * Sources management, Agent Profiles (with linked sources + Smart Generate), Content Viewer.
 */
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    // ─── STATE ───────────────────────────────────────────────────────────
    let sources = [];
    let agents = [];
    let rules = [];
    let _smartGenTimeouts = {};

    // ─── DOM REFS ────────────────────────────────────────────────────────
    const urlInput = document.getElementById('url-input');
    const btnAddUrl = document.getElementById('btn-add-url');
    const btnUploadDoc = document.getElementById('btn-upload-doc');
    const searchInput = document.getElementById('search-input');
    const btnUpdateAll = document.getElementById('btn-update-all');
    const sourceCount = document.getElementById('source-count');
    const sourcesList = document.getElementById('sources-list');
    const emptyState = document.getElementById('empty-state');
    const searchResults = document.getElementById('search-results');

    const btnAddAgent = document.getElementById('btn-add-agent');
    const agentCountEl = document.getElementById('agent-count');
    const activeCountEl = document.getElementById('active-agent-count');
    const agentsList = document.getElementById('agents-list');
    const agentsEmpty = document.getElementById('agents-empty');

    // Rules DOM refs
    const btnAddRule = document.getElementById('btn-add-rule');
    const ruleCountEl = document.getElementById('rule-count');
    const globalRuleCountEl = document.getElementById('global-rule-count');
    const rulesList = document.getElementById('rules-list');
    const rulesEmpty = document.getElementById('rules-empty');

    // Content Viewer
    const contentViewer = document.getElementById('content-viewer');
    const viewerTitle = document.getElementById('viewer-title');
    const viewerMeta = document.getElementById('viewer-meta');
    const viewerContent = document.getElementById('viewer-content');
    const btnCloseViewer = document.getElementById('btn-close-viewer');

    // ─── MODAL DOM REFS ──────────────────────────────────────────────────
    const customModal = document.getElementById('customModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalText = document.getElementById('modalText');
    const modalCancelBtn = document.getElementById('modalCancelBtn');
    const modalConfirmBtn = document.getElementById('modalConfirmBtn');

    // ─── MODAL CONTROLLER ────────────────────────────────────────────────
    // Track active modal abort controller to prevent stale listener accumulation
    let _modalAbort = null;
    let _modalPendingResolve = null; // resolve(false) any prior modal that gets displaced

    function showModal(title, text, isAlert = false) {
        return new Promise((resolve) => {
            if (!customModal) return resolve(false);
            
            // Abort any previous modal listeners and resolve its promise as cancelled
            if (_modalAbort) { _modalAbort.abort(); }
            if (_modalPendingResolve) { _modalPendingResolve(false); }

            _modalAbort = new AbortController();
            _modalPendingResolve = resolve;
            const signal = _modalAbort.signal;

            modalTitle.textContent = title;
            modalText.textContent = text;
            
            if (isAlert) {
                modalCancelBtn.style.display = 'none';
                modalConfirmBtn.textContent = 'OK';
            } else {
                modalCancelBtn.style.display = 'inline-block';
                modalConfirmBtn.textContent = 'Confirm';
            }

            // Use rAF to prevent the modal from flashing when buttons are
            // clicked during a DOM re-render (e.g. tab switch / list rebuild)
            requestAnimationFrame(() => {
                if (signal.aborted) return;
                customModal.classList.remove('hidden');
            });

            const cleanup = () => {
                customModal.classList.add('hidden');
                _modalAbort?.abort();
                _modalAbort = null;
                _modalPendingResolve = null;
            };

            modalConfirmBtn.addEventListener('click', () => {
                cleanup();
                resolve(true);
            }, { signal });
            
            modalCancelBtn.addEventListener('click', () => {
                cleanup();
                resolve(false);
            }, { signal });
        });
    }

    // ─── TAB SWITCHING ───────────────────────────────────────────────────
    document.querySelectorAll('.hub-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.hub-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.hub-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const target = tab.getAttribute('data-tab');
            document.getElementById('panel-' + target)?.classList.add('active');

            if (target === 'agents') {
                vscode.postMessage({ command: 'requestAgents' });
            }
            if (target === 'rules') {
                vscode.postMessage({ command: 'requestRules' });
            }
        });
    });

    // ─── SOURCES: ADD URL ────────────────────────────────────────────────
    btnAddUrl?.addEventListener('click', () => {
        const url = urlInput?.value?.trim();
        if (!url) return;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            urlInput.style.borderColor = '#f14c4c';
            setTimeout(() => { urlInput.style.borderColor = ''; }, 1500);
            return;
        }
        vscode.postMessage({ command: 'addUrl', data: { url } });
        urlInput.value = '';
    });

    urlInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnAddUrl?.click();
    });

    btnUploadDoc?.addEventListener('click', () => {
        vscode.postMessage({ command: 'uploadDocument' });
    });

    btnUpdateAll?.addEventListener('click', () => {
        vscode.postMessage({ command: 'updateAllSources' });
    });

    // ─── SOURCES: SEARCH ─────────────────────────────────────────────────
    let searchTimeout;
    searchInput?.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const query = searchInput.value.trim();
        if (!query) {
            searchResults?.classList.add('hidden');
            return;
        }
        searchTimeout = setTimeout(() => {
            vscode.postMessage({ command: 'searchSources', data: { query } });
        }, 300);
    });

    // ─── RULES: ADD ──────────────────────────────────────────────────────
    btnAddRule?.addEventListener('click', () => {
        vscode.postMessage({ command: 'addRule' });
    });

    // ─── AGENTS: ADD ─────────────────────────────────────────────────────
    btnAddAgent?.addEventListener('click', () => {
        vscode.postMessage({ command: 'addAgent' });
    });

    // ─── CONTENT VIEWER ──────────────────────────────────────────────────
    btnCloseViewer?.addEventListener('click', closeViewer);
    contentViewer?.addEventListener('click', (e) => {
        if (e.target === contentViewer) closeViewer();
    });

    function openViewer(source) {
        if (!contentViewer || !viewerTitle || !viewerContent) return;
        viewerTitle.textContent = source.title || 'Source Content';
        const meta = source.metadata || {};
        viewerMeta.textContent = [
            meta.wordCount ? meta.wordCount.toLocaleString() + ' words' : '',
            meta.sizeBytes ? formatSize(meta.sizeBytes) : '',
            source.type || ''
        ].filter(Boolean).join(' · ');
        viewerContent.textContent = source.content || '(No content available)';
        contentViewer.classList.remove('hidden');
    }

    function closeViewer() {
        contentViewer?.classList.add('hidden');
    }

    // ─── MESSAGE HANDLER ─────────────────────────────────────────────────
    window.addEventListener('message', (event) => {
        const msg = event.data;
        switch (msg.command) {
            case 'loadSources':
                sources = msg.sources || [];
                renderSources();
                renderAgents(); // refresh linked source names
                break;
            case 'loadAgents':
                agents = msg.agents || [];
                renderAgents();
                break;
            case 'searchResults':
                renderSearchResults(msg.results || []);
                break;
            case 'viewSourceContent':
                openViewer(msg.source);
                break;
            case 'smartGenerateResult':
                applyGeneratedPrompt(msg.agentId, msg.generatedPrompt);
                break;
            case 'loadRules':
                rules = msg.rules || [];
                renderRules();
                break;
            case 'smartGenerateRuleResult':
                applyGeneratedRule(msg.ruleId, msg.generatedContent);
                break;
        }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // SMART GENERATE RESULT
    // ═══════════════════════════════════════════════════════════════════════
    function applyGeneratedPrompt(agentId, generatedPrompt) {
        if (_smartGenTimeouts[agentId]) {
            clearTimeout(_smartGenTimeouts[agentId]);
            delete _smartGenTimeouts[agentId];
        }
        if (!generatedPrompt) return;
        // Find the textarea for this agent and update it
        const ta = agentsList?.querySelector(`textarea[data-agent-id="${agentId}"]`);
        if (ta) {
            ta.value = generatedPrompt;
            ta.style.borderColor = 'var(--hub-accent)';
            setTimeout(() => { ta.style.borderColor = ''; }, 2000);
        }
        // Update local state
        const agent = agents.find(a => a.id === agentId);
        if (agent) { agent.content = generatedPrompt; }

        // Remove loading state from the button
        const btn = agentsList?.querySelector(`.smart-gen-btn[data-agent-id="${agentId}"]`);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg> Generate`;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RENDER: SOURCES
    // ═══════════════════════════════════════════════════════════════════════
    function renderSources() {
        if (!sourcesList) return;

        const indexedCount = sources.filter(s => s.status === 'indexed').length;
        if (sourceCount) {
            sourceCount.textContent = `${sources.length} source${sources.length !== 1 ? 's' : ''} (${indexedCount} indexed)`;
        }

        if (sources.length === 0) {
            sourcesList.innerHTML = '';
            if (emptyState) {
                sourcesList.appendChild(emptyState);
                emptyState.style.display = 'flex';
            }
            return;
        }

        if (emptyState) emptyState.style.display = 'none';

        sourcesList.innerHTML = sources.map(source => {
            const typeIcon = getTypeIcon(source.type);
            const statusHtml = getStatusHtml(source.status, source.metadata?.errorMessage);
            const meta = source.metadata || {};
            const dateStr = meta.lastUpdated ? formatDate(meta.lastUpdated) : '—';
            const sizeStr = meta.sizeBytes ? formatSize(meta.sizeBytes) : '—';
            const wordsStr = meta.wordCount ? meta.wordCount.toLocaleString() + ' words' : '—';
            const canView = source.content && source.content.length > 0;

            return `
                <div class="source-card" data-id="${source.id}">
                    <div class="source-type-badge ${source.type}">${typeIcon}</div>
                    <div class="source-info">
                        <div class="source-title" title="${escHtml(source.origin)}">${escHtml(source.title)}</div>
                        <div class="source-meta">
                            <span>${dateStr}</span>
                            <span>${sizeStr}</span>
                            <span>${wordsStr}</span>
                        </div>
                    </div>
                    ${statusHtml}
                    <div class="source-actions">
                        ${canView ? `<button class="hub-btn icon-only" title="View content" onclick="hubViewContent('${source.id}')">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>` : ''}
                        <button class="hub-btn icon-only" title="Update" onclick="hubAction('updateSource','${source.id}')">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                        </button>
                        <button class="hub-btn icon-only danger" title="Delete" onclick="hubDeleteSource('${source.id}')">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                    ${source.status === 'error' && source.metadata?.errorMessage ? `<div class="source-error-msg">${escHtml(source.metadata.errorMessage)}</div>` : ''}
                </div>`;
        }).join('');
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RENDER: AGENTS (with inline Smart Generate)
    // ═══════════════════════════════════════════════════════════════════════
    function renderAgents() {
        if (!agentsList) return;

        if (agentCountEl) agentCountEl.textContent = String(agents.length);
        if (activeCountEl) activeCountEl.textContent = String(agents.filter(a => a.isActive).length);

        if (agents.length === 0) {
            agentsList.innerHTML = '';
            if (agentsEmpty) {
                agentsList.appendChild(agentsEmpty);
                agentsEmpty.style.display = 'flex';
            }
            return;
        }

        if (agentsEmpty) agentsEmpty.style.display = 'none';

        agentsList.innerHTML = agents.map((agent) => {
            const linkedIds = agent.linkedSources || [];
            const linkedChips = linkedIds.map(sid => {
                const src = sources.find(s => s.id === sid);
                const name = src ? src.title : 'Unknown';
                return `<span class="linked-source-chip"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/></svg> ${escHtml(name)}<span class="chip-remove" onclick="hubUnlinkSource('${agent.id}','${sid}')">&times;</span></span>`;
            }).join('');

            const linkedRuleIds = agent.linkedRules || [];
            const linkedRuleChips = linkedRuleIds.map(rid => {
                const rule = rules.find(r => r.id === rid);
                const name = rule ? rule.name : 'Unknown';
                return `<span class="linked-source-chip rule-chip"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> ${escHtml(name)}<span class="chip-remove" onclick="hubUnlinkRule('${agent.id}','${rid}')">&times;</span></span>`;
            }).join('');

            const hasLinkedSources = linkedIds.length > 0;

            return `
            <div class="agent-card" data-agent-id="${agent.id}">
                <div class="agent-card-top">
                    <div class="agent-card-top-left">
                        <div class="agent-avatar">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                        </div>
                        <input type="text" class="agent-name-input" value="${escHtml(agent.name)}" placeholder="Agent name" data-agent-id="${agent.id}" data-field="name">
                    </div>
                    <div class="agent-card-actions">
                        <label class="agent-toggle" title="${agent.isActive ? 'Active' : 'Inactive'}">
                            <input type="checkbox" ${agent.isActive ? 'checked' : ''} data-agent-id="${agent.id}" data-field="active">
                            <span class="agent-toggle-slider"></span>
                        </label>
                        <button class="hub-btn icon-only danger" title="Delete" onclick="hubDeleteAgent('${agent.id}')">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </div>

                <div class="agent-temp-row">
                    <label class="agent-temp-label">Temperature</label>
                    <input type="range" class="agent-temp-slider" min="0" max="100" value="${Math.round((agent.temperature ?? 0.15) * 100)}" data-agent-id="${agent.id}" data-field="temperature">
                    <span class="agent-temp-value" data-agent-id="${agent.id}">${(agent.temperature ?? 0.15).toFixed(2)}</span>
                </div>

                <div class="agent-prompt-area">
                    <div class="agent-prompt-label-row">
                        <span class="agent-prompt-label">System Prompt</span>
                        <button class="hub-btn ghost small smart-gen-btn" data-agent-id="${agent.id}" title="Generate system prompt from agent description and linked sources" onclick="hubSmartGenerate('${agent.id}')">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
                            Generate
                        </button>
                    </div>
                    <textarea class="agent-prompt-textarea" placeholder="e.g. You are an expert AI..." spellcheck="false" data-agent-id="${agent.id}" data-field="content">${escHtml(agent.content)}</textarea>
                </div>

                <div class="agent-sources-section">
                    <div class="agent-sources-header">
                        <span class="agent-sources-title">Linked Sources</span>
                        <div class="link-source-dropdown">
                            <button class="hub-btn ghost small" onclick="hubToggleLinkDropdown('${agent.id}')">+ Link</button>
                            <div class="link-dropdown-menu hidden" id="link-dropdown-${agent.id}"></div>
                        </div>
                    </div>
                    <div class="linked-sources-list">
                        ${linkedChips || '<span class="no-linked-sources">No linked sources</span>'}
                    </div>
                </div>

                <div class="agent-sources-section">
                    <div class="agent-sources-header">
                        <span class="agent-sources-title">Linked Rules</span>
                        <div class="link-source-dropdown">
                            <button class="hub-btn ghost small" onclick="hubToggleRuleLinkDropdown('${agent.id}')">+ Link</button>
                            <div class="link-dropdown-menu hidden" id="rule-link-dropdown-${agent.id}"></div>
                        </div>
                    </div>
                    <div class="linked-sources-list">
                        ${linkedRuleChips || '<span class="no-linked-sources">No linked rules</span>'}
                    </div>
                </div>
            </div>`;
        }).join('');

        // Save on blur (focus-out) — no flicker, saves only when user moves to next field
        agentsList.querySelectorAll('.agent-name-input').forEach(input => {
            input.addEventListener('blur', (e) => {
                const agent = agents.find(a => a.id === e.target.dataset.agentId);
                if (agent && agent.name !== e.target.value) {
                    agent.name = e.target.value;
                    vscode.postMessage({ command: 'updateAgent', data: { id: e.target.dataset.agentId, field: 'name', value: e.target.value } });
                }
            });
        });

        agentsList.querySelectorAll('.agent-prompt-textarea').forEach(ta => {
            ta.addEventListener('blur', (e) => {
                const agent = agents.find(a => a.id === e.target.dataset.agentId);
                if (agent && agent.content !== e.target.value) {
                    agent.content = e.target.value;
                    vscode.postMessage({ command: 'updateAgent', data: { id: e.target.dataset.agentId, field: 'content', value: e.target.value } });
                }
            });
        });

        agentsList.querySelectorAll('.agent-toggle input').forEach(cb => {
            cb.addEventListener('change', (e) => {
                vscode.postMessage({ command: 'updateAgent', data: { id: e.target.dataset.agentId, field: 'isActive', value: e.target.checked } });
                const a = agents.find(a => a.id === e.target.dataset.agentId);
                if (a) a.isActive = e.target.checked;
                if (activeCountEl) activeCountEl.textContent = String(agents.filter(a => a.isActive).length);
            });
        });

        // Temperature slider: update display on drag, save on release
        agentsList.querySelectorAll('.agent-temp-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const val = (parseInt(e.target.value, 10) / 100).toFixed(2);
                const label = agentsList.querySelector(`.agent-temp-value[data-agent-id="${e.target.dataset.agentId}"]`);
                if (label) label.textContent = val;
            });
            slider.addEventListener('change', (e) => {
                const val = parseFloat((parseInt(e.target.value, 10) / 100).toFixed(2));
                const agent = agents.find(a => a.id === e.target.dataset.agentId);
                if (agent) agent.temperature = val;
                vscode.postMessage({ command: 'updateAgent', data: { id: e.target.dataset.agentId, field: 'temperature', value: val } });
            });
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RENDER: SEARCH RESULTS
    // ═══════════════════════════════════════════════════════════════════════
    function renderSearchResults(results) {
        if (!searchResults) return;
        if (results.length === 0) {
            searchResults.innerHTML = '<p style="font-size:12px;color:var(--hub-text-muted);padding:8px;">No results found.</p>';
            searchResults.classList.remove('hidden');
            return;
        }
        let html = `<div class="search-results-header"><h3>${results.length} result${results.length !== 1 ? 's' : ''}</h3></div>`;
        for (const r of results) {
            html += `<div class="search-result-item">
                <div class="search-result-title">${escHtml(r.source.title)}</div>
                ${r.matches.map(m => `<div class="search-result-match">${escHtml(m)}</div>`).join('')}
            </div>`;
        }
        searchResults.innerHTML = html;
        searchResults.classList.remove('hidden');
    }

    // ═══════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════════
    function getTypeIcon(type) {
        switch (type) {
            case 'url': return '🔗';
            case 'pdf': return '📄';
            case 'excel': return '📊';
            case 'word': return '📝';
            default: return '📎';
        }
    }

    function getStatusHtml(status, errorMsg) {
        switch (status) {
            case 'indexed': return '<span class="source-status indexed">✓ Indexed</span>';
            case 'indexing': return '<span class="source-status indexing"><span class="status-spinner"></span> Indexing</span>';
            case 'updating': return '<span class="source-status updating"><span class="status-spinner"></span> Updating</span>';
            case 'error': return `<span class="source-status error" title="${escAttr(errorMsg || '')}">✕ Error</span>`;
            case 'pending': return '<span class="source-status pending">⏳ Pending</span>';
            default: return '';
        }
    }

    function formatDate(iso) {
        try {
            const d = new Date(iso);
            const diff = Date.now() - d.getTime();
            if (diff < 60000) return 'Just now';
            if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
            if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        } catch { return '—'; }
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function escHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escAttr(str) {
        if (!str) return '';
        return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, ' ');
    }

    // ═══════════════════════════════════════════════════════════════════════
    // GLOBAL ACTIONS
    // ═══════════════════════════════════════════════════════════════════════
    window.hubAction = function (action, id) {
        vscode.postMessage({ command: action, data: { id } });
    };

    window.hubViewContent = function (id) {
        vscode.postMessage({ command: 'viewSourceContent', data: { id } });
    };

    window.hubDeleteAgent = async function (id) {
        const agent = agents.find(a => a.id === id);
        const name = agent ? agent.name : 'this agent';
        const confirmed = await showModal('Delete Agent', `Are you sure you want to delete ${name}? This action cannot be undone.`);
        if (confirmed) {
            vscode.postMessage({ command: 'deleteAgent', data: { id } });
        }
    };

    window.hubDeleteSource = async function (id) {
        const source = sources.find(s => s.id === id);
        const title = source ? source.title : 'this source';
        const confirmed = await showModal('Delete Source', `Are you sure you want to delete ${title}? This will remove the source from the vector store.`);
        if (confirmed) {
            vscode.postMessage({ command: 'deleteSource', data: { id } });
        }
    };

    window.hubUnlinkSource = function (agentId, sourceId) {
        vscode.postMessage({ command: 'unlinkSource', data: { agentId, sourceId } });
    };

    window.hubSmartGenerate = function (agentId) {
        // Show loading state on button
        const btn = agentsList?.querySelector(`.smart-gen-btn[data-agent-id="${agentId}"]`);
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="status-spinner"></span> Generating (up to 2m)...';
        }
        
        if (_smartGenTimeouts[agentId]) clearTimeout(_smartGenTimeouts[agentId]);
        _smartGenTimeouts[agentId] = setTimeout(() => {
            if (btn && btn.disabled) {
                btn.disabled = false;
                btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg> Generate`;
                showModal('Generation Timeout', 'Agent generation took too long. Please try again.', true);
            }
        }, 120000);
        
        vscode.postMessage({ command: 'smartGenerate', data: { agentId } });
    };

    window.hubToggleLinkDropdown = function (agentId) {
        const menu = document.getElementById('link-dropdown-' + agentId);
        if (!menu) return;

        document.querySelectorAll('.link-dropdown-menu').forEach(m => {
            if (m.id !== 'link-dropdown-' + agentId) m.classList.add('hidden');
        });

        const isHidden = menu.classList.contains('hidden');
        if (isHidden) {
            const agent = agents.find(a => a.id === agentId);
            const linkedIds = (agent && agent.linkedSources) || [];
            const indexedSources = sources.filter(s => s.status === 'indexed');

            if (indexedSources.length === 0) {
                menu.innerHTML = '<div class="link-dropdown-empty">No indexed sources available. Add sources first.</div>';
            } else {
                menu.innerHTML = indexedSources.map(s => {
                    const isLinked = linkedIds.includes(s.id);
                    return `<button class="link-dropdown-item ${isLinked ? 'linked' : ''}" onclick="hubLinkSource('${agentId}','${s.id}')">${escHtml(s.title)}${isLinked ? ' ✓' : ''}</button>`;
                }).join('');
            }
            menu.classList.remove('hidden');
        } else {
            menu.classList.add('hidden');
        }
    };

    window.hubLinkSource = function (agentId, sourceId) {
        vscode.postMessage({ command: 'linkSource', data: { agentId, sourceId } });
        const menu = document.getElementById('link-dropdown-' + agentId);
        if (menu) menu.classList.add('hidden');
    };

    window.hubToggleRuleLinkDropdown = function (agentId) {
        const menu = document.getElementById('rule-link-dropdown-' + agentId);
        if (!menu) return;

        document.querySelectorAll('.link-dropdown-menu').forEach(m => {
            if (m.id !== 'rule-link-dropdown-' + agentId) m.classList.add('hidden');
        });

        const isHidden = menu.classList.contains('hidden');
        if (isHidden) {
            const agent = agents.find(a => a.id === agentId);
            const linkedIds = (agent && agent.linkedRules) || [];
            const availableRules = rules.filter(r => r.scope === 'assignable' || r.scope === 'global');

            if (availableRules.length === 0) {
                menu.innerHTML = '<div class="link-dropdown-empty">No rules available. Create rules in the Rules tab.</div>';
            } else {
                menu.innerHTML = availableRules.map(r => {
                    const isLinked = linkedIds.includes(r.id);
                    return `<button class="link-dropdown-item ${isLinked ? 'linked' : ''}" onclick="hubLinkRule('${agentId}','${r.id}')">${escHtml(r.name)}${isLinked ? ' ✓' : ''}</button>`;
                }).join('');
            }
            menu.classList.remove('hidden');
        } else {
            menu.classList.add('hidden');
        }
    };

    window.hubLinkRule = function (agentId, ruleId) {
        vscode.postMessage({ command: 'linkRule', data: { agentId, ruleId } });
        const menu = document.getElementById('rule-link-dropdown-' + agentId);
        if (menu) menu.classList.add('hidden');
    };

    window.hubUnlinkRule = function (agentId, ruleId) {
        vscode.postMessage({ command: 'unlinkRule', data: { agentId, ruleId } });
    };

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.link-source-dropdown')) {
            document.querySelectorAll('.link-dropdown-menu').forEach(m => m.classList.add('hidden'));
        }
    });

    // ─── INIT ────────────────────────────────────────────────────────────
    vscode.postMessage({ command: 'requestSources' });
    vscode.postMessage({ command: 'requestAgents' });
    vscode.postMessage({ command: 'requestRules' });

    // ═══════════════════════════════════════════════════════════════════════
    // RENDER: RULES (#68)
    // ═══════════════════════════════════════════════════════════════════════
    function renderRules() {
        if (!rulesList) return;

        if (ruleCountEl) ruleCountEl.textContent = String(rules.length);
        if (globalRuleCountEl) globalRuleCountEl.textContent = String(rules.filter(r => r.scope === 'global').length);

        if (rules.length === 0) {
            rulesList.innerHTML = '';
            if (rulesEmpty) {
                rulesList.appendChild(rulesEmpty);
                rulesEmpty.style.display = 'flex';
            }
            return;
        }

        if (rulesEmpty) rulesEmpty.style.display = 'none';

        rulesList.innerHTML = rules.map(rule => {
            return `
            <div class="agent-card" data-rule-id="${rule.id}">
                <div class="agent-card-top">
                    <div class="agent-card-top-left">
                        <div class="agent-avatar">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        </div>
                        <input type="text" class="agent-name-input rule-name-input" value="${escHtml(rule.name)}" placeholder="Rule name" data-rule-id="${rule.id}" data-field="name">
                    </div>
                    <div class="agent-card-actions">
                        <select class="rule-scope-select" data-rule-id="${rule.id}" data-field="scope" title="Scope">
                            <option value="global" ${rule.scope === 'global' ? 'selected' : ''}>Global</option>
                            <option value="workspace" ${rule.scope === 'workspace' ? 'selected' : ''}>Workspace</option>
                            <option value="assignable" ${rule.scope === 'assignable' ? 'selected' : ''}>Assignable</option>
                        </select>
                        <button class="hub-btn icon-only danger" title="Delete" onclick="hubDeleteRule('${rule.id}')">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </div>

                <div class="agent-prompt-area">
                    <div class="agent-prompt-label-row">
                        <span class="agent-prompt-label">Rule Content</span>
                        <button class="hub-btn ghost small smart-gen-btn" data-rule-id="${rule.id}" title="Generate rule content from name" onclick="hubSmartGenerateRule('${rule.id}')">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
                            Generate
                        </button>
                    </div>
                    <textarea class="agent-prompt-textarea rule-content-textarea" placeholder="e.g. Always use TypeScript strict mode..." spellcheck="false" data-rule-id="${rule.id}" data-field="content">${escHtml(rule.content)}</textarea>
                </div>
            </div>`;
        }).join('');

        // Save on blur — consistent with agent inputs
        rulesList.querySelectorAll('.rule-name-input').forEach(input => {
            input.addEventListener('blur', (e) => {
                const rule = rules.find(r => r.id === e.target.dataset.ruleId);
                if (rule && rule.name !== e.target.value) {
                    rule.name = e.target.value;
                    vscode.postMessage({ command: 'updateRule', data: { id: e.target.dataset.ruleId, field: 'name', value: e.target.value } });
                }
            });
        });

        rulesList.querySelectorAll('.rule-content-textarea').forEach(ta => {
            ta.addEventListener('blur', (e) => {
                const rule = rules.find(r => r.id === e.target.dataset.ruleId);
                if (rule && rule.content !== e.target.value) {
                    rule.content = e.target.value;
                    vscode.postMessage({ command: 'updateRule', data: { id: e.target.dataset.ruleId, field: 'content', value: e.target.value } });
                }
            });
        });

        rulesList.querySelectorAll('.rule-scope-select').forEach(sel => {
            sel.addEventListener('change', (e) => {
                vscode.postMessage({ command: 'updateRule', data: { id: e.target.dataset.ruleId, field: 'scope', value: e.target.value } });
                const r = rules.find(r => r.id === e.target.dataset.ruleId);
                if (r) r.scope = e.target.value;
                if (globalRuleCountEl) globalRuleCountEl.textContent = String(rules.filter(r => r.scope === 'global').length);
            });
        });
    }

    window.hubDeleteRule = async function (id) {
        const rule = rules.find(r => r.id === id);
        const name = rule ? rule.name : 'this rule';
        const confirmed = await showModal('Delete Rule', `Are you sure you want to delete "${name}"? This action cannot be undone.`);
        if (confirmed) {
            vscode.postMessage({ command: 'deleteRule', data: { id } });
        }
    };

    window.hubSmartGenerateRule = function (ruleId) {
        const btn = rulesList?.querySelector(`.smart-gen-btn[data-rule-id="${ruleId}"]`);
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="status-spinner"></span> Generating (up to 2m)...';
        }

        if (_smartGenTimeouts[ruleId]) clearTimeout(_smartGenTimeouts[ruleId]);
        _smartGenTimeouts[ruleId] = setTimeout(() => {
            if (btn && btn.disabled) {
                btn.disabled = false;
                btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg> Generate`;
                showModal('Generation Timeout', 'Rule generation took too long. Please try again.', true);
            }
        }, 120000);

        vscode.postMessage({ command: 'smartGenerateRule', data: { ruleId } });
    };

    function applyGeneratedRule(ruleId, generatedContent) {
        if (_smartGenTimeouts[ruleId]) {
            clearTimeout(_smartGenTimeouts[ruleId]);
            delete _smartGenTimeouts[ruleId];
        }
        if (!generatedContent) return;
        const ta = rulesList?.querySelector(`textarea[data-rule-id="${ruleId}"]`);
        if (ta) {
            ta.value = generatedContent;
            ta.style.borderColor = 'var(--hub-accent)';
            setTimeout(() => { ta.style.borderColor = ''; }, 2000);
        }
        const rule = rules.find(r => r.id === ruleId);
        if (rule) { rule.content = generatedContent; }
        const btn = rulesList?.querySelector(`.smart-gen-btn[data-rule-id="${ruleId}"]`);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg> Generate`;
        }
    }
})();

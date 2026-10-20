import { $, esc, state, CodeGraph, toast, ancestors, busy, readStorage, writeStorage } from './state.js';
import { render } from './navigation.js';
export function loadData(data, sourcePath = '') {
    state.data = data;
    state.model = CodeGraph.createModel(data);
    state.nodes = state.model.nodes;
    state.loadedPath = sourcePath || data.name || 'demo';
    if (sourcePath)
        $('path-input').value = sourcePath;
    let saved = {};
    try {
        const value = JSON.parse(readStorage(`atlas.scope:${state.loadedPath}`) || '{}');
        saved = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }
    catch {
    }
    const validProjects = (data.projects || []).map(p => p.id);
    state.projectId = validProjects.includes(saved.projectId) ? saved.projectId : (data.defaultProject || validProjects[0] || '*');
    state.module = typeof saved.module === 'string' ? saved.module : '*';
    state.includeTests = false;
    state.showComments = true;
    state.model.setFilters({ projectId: state.projectId, module: state.module, includeTests: false });
    state.scope = 'root';
    state.selected = 'root';
    state.edgeSelected = null;
    state.sourceJump = null;
    state.mode = 'structure';
    state.detail = 'overview';
    state.search = '';
    state.rendered = false;
    state.viewAnchor = null;
    state.expanded = new Set(['root', ...data.nodes.filter(n => n.kind === 'folder' && n.parent === 'root').map(n => n.id)]);
    state.revealed = new Set(['root']);
    $('search').value = '';
    $('repo-name').textContent = data.name;
    renderScopeControls();
    $('include-tests').checked = false;
    $('show-comments').checked = true;
    $('diagnostics').classList.toggle('hidden', !data.warnings.length);
    $('diagnostics').open = false;
    $('diagnostics-label').textContent = `解析エラー・除外 ${data.warnings.length}件`;
    $('diagnostics-list').innerHTML = data.warnings.map(w => `<li>${esc(w)}</li>`).join('');
    render();
}
export function renderScopeControls() {
    const projects = Array.isArray(state.data?.projects) ? state.data.projects : [];
    const ps = $('project-select'), ms = $('module-select');
    if (!ps || !ms)
        return;
    const projectItems = projects.length ? [{ id: '*', name: '全体' }, ...projects.map(p => ({ id: p.id, name: p.name || p.id, disabled: p.files === 0 }))] : [{ id: '*', name: '全体' }];
    ps.innerHTML = projectItems.map(p => `<option value="${esc(p.id)}" ${p.disabled ? 'disabled' : ''}>${esc(p.name)}</option>`).join('');
    ps.value = projectItems.some(p => p.id === state.projectId && !p.disabled) ? state.projectId : '*';
    state.projectId = ps.value;
    const files = [];
    for (const f of state.data.nodes.filter(n => n.kind === 'file' && (!state.data.projects?.length || state.projectId === '*' || n.projectId === state.projectId) && (!n.isTest || state.includeTests))) {
        const count = state.data.nodes.filter(n => n.path === f.path && CodeGraph.codeKinds.has(n.kind) && (!n.isTest || state.includeTests)).length;
        files.push({ path: f.path, name: f.name, count });
    }
    // A project may advertise only its file count. The node list is the source of
    // truth for module choices and keeps old/demo payloads compatible.
    ms.innerHTML = `<option value="*">すべて</option>` + files.sort((a, b) => (a.path || '').localeCompare(b.path || '')).map(f => `<option value="${esc(f.path)}">${esc(f.path || f.name || '')} (${f.count || 0})</option>`).join('');
    ms.value = files.some(f => f.path === state.module) ? state.module : '*';
    state.module = ms.value;
    state.model.setFilters({ projectId: state.projectId, module: state.module, includeTests: state.includeTests });
}
export function applyScopeFilters(reset = true) {
    state.model.setFilters({ projectId: state.projectId, module: state.module, includeTests: state.includeTests });
    if (reset) {
        state.scope = 'root';
        state.selected = 'root';
        state.edgeSelected = null;
        state.sourceJump = null;
        state.revealed = new Set(['root']);
        state.rendered = false;
        const file = state.module === '*' ? null : [...state.nodes.values()].find(n => n.kind === 'file' && n.path === state.module);
        if (file) {
            for (const a of ancestors(file.id).slice(0, -1))
                state.revealed.add(a.id);
            state.selected = file.id;
        }
    }
    writeStorage(`atlas.scope:${state.loadedPath}`, JSON.stringify({ projectId: state.projectId, module: state.module }));
    render();
}
export async function analyzeRequest(payload, demo = false) {
    busy(true);
    $('open-error').textContent = '';
    try {
        const response = await fetch(demo ? '/api/demo' : '/api/analyze', demo ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atlas-Token': state.token }, body: JSON.stringify(payload) });
        const data = await response.json();
        if (!response.ok)
            throw new Error(data.error || '解析できませんでした。');
        loadData(data, payload?.path || '');
        if (payload?.path)
            writeStorage('atlas.lastPath', payload.path);
        $('open-dialog').close();
        return true;
    }
    catch (error) {
        $('open-error').textContent = error.message;
        toast(error.message);
        return false;
    }
    finally {
        busy(false);
    }
}

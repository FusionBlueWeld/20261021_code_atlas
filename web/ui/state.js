// Shared UI state and small DOM/storage helpers.
import '../graph/layout.js';
import '../graph-model.js';
export const CodeGraph = globalThis.CodeGraph;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const kinds = {
    class: 'クラス', function: '関数', method: 'メソッド', parameter: '引数', interface: 'インターフェース', type: '型', file: 'ファイル', folder: 'フォルダ', repository: 'リポジトリ'
};
const icons = {
    class: 'C', function: 'ƒ', method: 'ƒ', parameter: 'p', interface: 'I', type: 'T', file: '▤', folder: '▱', repository: '▱'
};
const state = {
    data: null,
    model: null,
    nodes: new Map(),
    scope: 'root',
    selected: null,
    edgeSelected: null,
    sourceJump: null,
    mode: 'structure',
    detail: 'overview',
    expanded: new Set(['root']),
    revealed: new Set(['root']),
    zoom: 1,
    pan: { x: 0, y: 0 },
    bounds: { w: 600, h: 400 },
    search: '',
    token: '',
    graph: null,
    projectId: '*',
    module: '*',
    includeTests: false,
    showComments: true,
    loadedPath: '',
    rendered: false,
    viewAnchor: null,
    rowGap: CodeGraph.metrics.defaultRowGap,
    columnGap: CodeGraph.metrics.defaultColumnGap,
    sidebarOpen: true,
    inspectorOpen: true,
    sidebarWidth: 220,
    inspectorWidth: 340
};
let toastTimer;
export function readStorage(key) {
    try {
        return localStorage.getItem(key) || '';
    }
    catch {
        return '';
    }
}
export function writeStorage(key, value) {
    try {
        localStorage.setItem(key, value);
    }
    catch {
    }
}
export function download(content, name, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export { $, esc, kinds, icons, state, toast, icon, children, treeVisible, pathFor, canOpen, ancestors, busy };
function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 3500);
}
function icon(n) {
    return `<span class="node-icon ${esc(n.kind)}" title="${esc(kinds[n.kind])}">${icons[n.kind] || '◇'}</span>`;
}
function children(id) {
    return state.model.children(id);
}
function treeVisible(n) {
    return n?.id === 'root' || (n?.kind === 'file' ? state.model.isFileVisible(n) : (CodeGraph.codeKinds.has(n?.kind) ? state.model.isVisible(n) : children(n.id).some(treeVisible)));
}
function pathFor(n) {
    return n?.context && n.projectId ? `${n.projectId}:${n.path || n.name}` : (n?.path || n?.name || '');
}
function canOpen(n) {
    return state.model.explorableChildren(n.id).length > 0;
}
function ancestors(id) {
    const result = [];
    let n = state.nodes.get(id);
    while (n) {
        result.unshift(n);
        n = state.nodes.get(n.parent);
    }
    return result;
}
function busy(on) {
    $('loading').classList.toggle('hidden', !on);
    for (const id of ['analyze-button', 'open-button', 'folder-button', 'load-demo'])
        $(id).disabled = on;
}

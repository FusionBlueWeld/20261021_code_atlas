// Application startup and stable DOM event bindings.
import { $, state, CodeGraph, toast, busy, readStorage } from './state.js';
import { analyzeRequest, applyScopeFilters, renderScopeControls } from './repository.js';
import { render, preserveNode } from './navigation.js';
import { renderTree } from './tree.js';
import { renderGraph, fitGraph, zoomBy, applyTransform, bindGraphEvents } from './graph.js';
import { download } from './state.js';
import { restorePanelPrefs, savePanelPrefs, updateLayoutControl, updatePanelControls, togglePanel, bindPanelResize } from './panels.js';
async function openFolder(event) {
    const selected = [...event.target.files];
    if (!selected.length)
        return;
    busy(true);
    $('open-error').textContent = '';
    try {
        const root = selected[0].webkitRelativePath.split('/')[0];
        const ignored = new Set(['node_modules', '.git', '.venv', 'venv', 'env', '__pycache__', 'dist', 'build', 'coverage', 'vendor']);
        const files = [];
        let total = 0, skipped = 0;
        for (const file of selected) {
            const parts = file.webkitRelativePath.split('/').slice(1);
            if (parts.some(p => ignored.has(p) || p.startsWith('.')) || !/\.(py|js|jsx|mjs|cjs|ts|tsx)$/i.test(file.name))
                continue;
            if (file.size > 512 * 1024 || total + file.size > 16 * 1024 * 1024 || files.length >= 1200) {
                skipped++;
                continue;
            }
            files.push({ path: parts.join('/'), content: await file.text() });
            total += file.size;
        }
        await analyzeRequest({ name: root, files, warnings: skipped ? [`サイズ・件数上限により ${skipped} ファイルを除外。`] : [] });
    }
    catch (error) {
        $('open-error').textContent = error.message;
        toast(error.message);
    }
    finally {
        busy(false);
        event.target.value = '';
    }
}
export function bindEvents() {
    $('open-button').onclick = () => {
        $('open-error').textContent = '';
        $('open-dialog').showModal();
    };
    document.querySelectorAll('.close-dialog').forEach(el => el.onclick = () => el.closest('dialog').close());
    $('open-form').onsubmit = event => {
        event.preventDefault();
        const path = $('path-input').value.trim().replace(/^"|"$/g, '');
        if (!path) {
            $('open-error').textContent = 'ローカルパスを入力してください。';
            return;
        }
        analyzeRequest({ path });
    };
    $('folder-button').onclick = () => $('folder-input').click();
    $('folder-input').onchange = openFolder;
    $('load-demo').onclick = () => analyzeRequest(null, true);
    $('toggle-sidebar').onclick = () => togglePanel('sidebar');
    $('toggle-inspector').onclick = () => togglePanel('inspector');
    for (const [id, key, min, max] of [
        ['vertical-gap', 'rowGap', CodeGraph.metrics.minRowGap, CodeGraph.metrics.maxRowGap],
        ['horizontal-gap', 'columnGap', CodeGraph.metrics.minColumnGap, CodeGraph.metrics.maxColumnGap]
    ]) {
        $(id).oninput = event => {
            const gap = Number(event.target.value);
            if (!Number.isFinite(gap)) return;
            if (state.data && state.selected) preserveNode(state.selected);
            state[key] = Math.max(min, Math.min(max, gap));
            updateLayoutControl();
            if (state.data) renderGraph();
            savePanelPrefs();
        };
    }
    $('search').oninput = event => {
        state.search = event.target.value;
        if (state.data)
            renderTree();
    };
    $('project-select').onchange = event => {
        state.projectId = event.target.value;
        state.module = '*';
        renderScopeControls();
        applyScopeFilters();
    };
    $('module-select').onchange = event => {
        state.module = event.target.value;
        applyScopeFilters();
    };
    $('include-tests').onchange = event => {
        state.includeTests = event.target.checked;
        renderScopeControls();
        applyScopeFilters();
    };
    $('show-comments').onchange = event => {
        state.showComments = event.target.checked;
        if (state.data)
            renderGraph();
    };
    $('collapse-tree').onclick = () => {
        state.expanded = new Set(['root']);
        if (state.data)
            renderTree();
    };
    $('reset-button').onclick = () => {
        if (!state.data)
            return;
        Object.assign(state, {
            mode: 'structure', revealed: new Set(['root']), selected: 'root', edgeSelected: null, sourceJump: null, rendered: false
        });
        render();
    };
    for (const [id, mode] of [['structure-tab', 'structure'], ['relations-tab', 'relations']]) {
        $(id).onclick = () => {
            state.mode = mode;
            if (state.data)
                renderGraph();
        };
    }
    $('fit-button').onclick = () => {
        if (state.data)
            fitGraph();
    };
    $('zoom-in').onclick = () => zoomBy(1.2);
    $('zoom-out').onclick = () => zoomBy(1 / 1.2);
    $('export-button').onclick = () => {
        if (state.data)
            download(JSON.stringify(state.data, null, 2), state.data.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '-atlas.json');
    };
    restorePanelPrefs();
    updateLayoutControl();
    updatePanelControls();
    bindPanelResize();
    bindGraphEvents();
    bindViewportPan();
    $('layout-control').addEventListener('selectstart', event => event.preventDefault());
    document.addEventListener('keydown', event => {
        if (event.target.matches('input,textarea,select,[contenteditable=true]')) {
            if (event.key === 'Escape' && event.target === $('search')) {
                state.search = '';
                $('search').value = '';
                if (state.data)
                    renderTree();
                $('search').blur();
            }
            return;
        }
        if (document.querySelector('dialog[open]'))
            return;
        if (event.key === '/') {
            event.preventDefault();
            $('search').focus();
        }
    });
    // A viewport resize changes only the available camera area. Rebuilding all
    // cards here used to replace buttons between pointerdown and click.
    new ResizeObserver(() => updatePanelControls()).observe(document.querySelector('.app-shell'));
}
function bindViewportPan() {
    const view = $('graph-viewport');
    let drag = null;
    view.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('.graph-card,.edge-hit,.edge-label-click,input,button,select,a,[role=separator]'))
            return;
        // Labels and the spacing panel's background behave like the canvas.
        // Prevent text/label selection, but leave native range interaction alone.
        event.preventDefault();
        drag = {
            id: event.pointerId, x: event.clientX, y: event.clientY, px: state.pan.x, py: state.pan.y
        };
        view.setPointerCapture(event.pointerId);
        view.classList.add('dragging');
    });
    view.addEventListener('pointermove', event => {
        if (!drag || drag.id !== event.pointerId)
            return;
        state.pan = { x: drag.px + event.clientX - drag.x, y: drag.py + event.clientY - drag.y };
        applyTransform();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
        view.addEventListener(type, () => {
            drag = null;
            view.classList.remove('dragging');
        });
    view.addEventListener('wheel', event => {
        if (event.target.closest('.graph-overlay-control'))
            return;
        event.preventDefault();
        const rect = view.getBoundingClientRect();
        zoomBy(event.deltaY > 0 ? .93 : 1.07, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    }, { passive: false });
}
export async function start() {
    busy(true);
    try {
        const response = await fetch('/api/config');
        if (!response.ok)
            throw new Error('サーバーに接続できません。');
        state.token = (await response.json()).token;
        const lastPath = readStorage('atlas.lastPath');
        const loaded = await analyzeRequest(lastPath ? { path: lastPath } : null, !lastPath);
        if (!loaded)
            $('open-dialog').showModal();
    }
    catch (error) {
        toast(error.message);
        $('open-dialog').showModal();
    }
    finally {
        busy(false);
    }
}

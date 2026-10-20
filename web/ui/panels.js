// Side-panel preferences, responsive limits, and pointer/keyboard resizing.
import { $, state, CodeGraph, readStorage, writeStorage } from './state.js';
const MIN_WIDTH = 160;
const MAX_WIDTH = 720;
const MIN_CANVAS = 320;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function restorePanelPrefs() {
    try {
        const saved = JSON.parse(readStorage('atlas.viewPrefs') || '{}') || {};
        state.sidebarOpen = saved.sidebarOpen !== false;
        state.inspectorOpen = saved.inspectorOpen !== false;
        for (const [key, fallback] of [['sidebarWidth', 220], ['inspectorWidth', 340]]) {
            const value = Number(saved[key]);
            state[key] = Number.isFinite(value) ? clamp(value, MIN_WIDTH, MAX_WIDTH) : fallback;
        }
        const gap = Number(saved.rowGap);
        state.rowGap = Number.isFinite(gap)
            ? clamp(gap, CodeGraph.metrics.minRowGap, CodeGraph.metrics.maxRowGap)
            : CodeGraph.metrics.defaultRowGap;
        const columnGap = Number(saved.columnGap);
        state.columnGap = Number.isFinite(columnGap)
            ? clamp(columnGap, CodeGraph.metrics.minColumnGap, CodeGraph.metrics.maxColumnGap)
            : CodeGraph.metrics.defaultColumnGap;
    }
    catch {
    }
}
export function savePanelPrefs() {
    const { sidebarOpen, inspectorOpen, sidebarWidth, inspectorWidth, rowGap, columnGap } = state;
    writeStorage('atlas.viewPrefs', JSON.stringify({
        sidebarOpen, inspectorOpen, sidebarWidth, inspectorWidth, rowGap, columnGap
    }));
}
export function updateLayoutControl() {
    $('vertical-gap').min = CodeGraph.metrics.minRowGap;
    $('vertical-gap').max = CodeGraph.metrics.maxRowGap;
    $('vertical-gap').value = state.rowGap;
    $('vertical-gap-value').textContent = `${state.rowGap}px`;
    $('horizontal-gap').min = CodeGraph.metrics.minColumnGap;
    $('horizontal-gap').max = CodeGraph.metrics.maxColumnGap;
    $('horizontal-gap').value = state.columnGap;
    $('horizontal-gap-value').textContent = `${state.columnGap}px`;
}
export function updatePanelControls() {
    const shell = document.querySelector('.app-shell');
    shell.classList.toggle('sidebar-collapsed', !state.sidebarOpen);
    shell.classList.toggle('inspector-collapsed', !state.inspectorOpen);
    // Only the rendered widths are constrained; remember the preferred width
    // across narrow windows, collapsed panels, and reloads.
    let left = state.sidebarOpen ? state.sidebarWidth : 0;
    let right = state.inspectorOpen ? state.inspectorWidth : 0;
    const available = Math.max(0, shell.clientWidth - MIN_CANVAS - 12);
    if (left + right > available && shell.clientWidth > 880) {
        const minimum = (left ? MIN_WIDTH : 0) + (right ? MIN_WIDTH : 0);
        const extra = Math.max(1, left + right - minimum);
        const budget = Math.max(0, available - minimum);
        left = left ? MIN_WIDTH + (left - MIN_WIDTH) * budget / extra : 0;
        right = right ? MIN_WIDTH + (right - MIN_WIDTH) * budget / extra : 0;
    }
    if (shell.clientWidth > 560 && shell.clientWidth <= 880) {
        left = Math.min(left, Math.max(MIN_WIDTH, shell.clientWidth - MIN_CANVAS - 6));
    }
    shell.style.setProperty('--left-panel-width', `${left}px`);
    shell.style.setProperty('--right-panel-width', `${right}px`);
    for (const [side, open] of [['sidebar', state.sidebarOpen], ['inspector', state.inspectorOpen]]) {
        const control = $(`toggle-${side}`);
        const name = side === 'sidebar' ? '左サイドバー' : '右サイドバー';
        control.setAttribute('aria-expanded', String(open));
        control.setAttribute('aria-label', name + (open ? 'を隠す' : 'を表示'));
        control.title = control.getAttribute('aria-label');
        $(side).inert = !open;
        const handle = $(`resize-${side}`);
        handle.setAttribute('aria-valuenow', String(Math.round(side === 'sidebar' ? left : right)));
        handle.tabIndex = open ? 0 : -1;
    }
}
export function togglePanel(panel) {
    const key = panel === 'sidebar' ? 'sidebarOpen' : 'inspectorOpen';
    state[key] = !state[key];
    updatePanelControls();
    savePanelPrefs();
}
export function bindPanelResize() {
    const shell = document.querySelector('.app-shell');
    for (const side of ['sidebar', 'inspector']) {
        const handle = $(`resize-${side}`);
        const key = side === 'sidebar' ? 'sidebarWidth' : 'inspectorWidth';
        let active = null;
        function setWidth(value) {
            const other = side === 'sidebar'
                ? (state.inspectorOpen && shell.clientWidth > 880 ? $('inspector').getBoundingClientRect().width : 0)
                : (state.sidebarOpen ? $('sidebar').getBoundingClientRect().width : 0);
            const max = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, shell.clientWidth - other - MIN_CANVAS - 12));
            state[key] = clamp(value, MIN_WIDTH, max);
            updatePanelControls();
        }
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0)
                return;
            event.preventDefault();
            active = { id: event.pointerId, x: event.clientX, width: $(side).getBoundingClientRect().width };
            handle.setPointerCapture(event.pointerId);
            shell.classList.add('resizing');
        });
        handle.addEventListener('pointermove', event => {
            if (!active || active.id !== event.pointerId)
                return;
            const delta = (event.clientX - active.x) * (side === 'sidebar' ? 1 : -1);
            setWidth(active.width + delta);
        });
        function finish(event) {
            if (!active || (event && event.pointerId !== active.id))
                return;
            active = null;
            shell.classList.remove('resizing');
            savePanelPrefs();
        }
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
            handle.addEventListener(type, finish);
        handle.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
                return;
            event.preventDefault();
            const delta = (event.key === 'ArrowRight' ? 16 : -16) * (side === 'sidebar' ? 1 : -1);
            setWidth(event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? MAX_WIDTH : state[key] + delta);
            savePanelPrefs();
        });
    }
}

import { $, state, CodeGraph, canOpen, ancestors } from './state.js';
import { renderTree } from './tree.js';
import { renderGraph, updateSelection } from './graph.js';
import { renderInspector } from './inspector.js';
export function render() {
    renderTree();
    renderGraph();
    renderInspector();
}
export function selectNode(id) {
    if (!state.nodes.has(id))
        return;
    state.selected = id;
    state.edgeSelected = null;
    state.sourceJump = null;
    renderTree();
    renderGraph();
    renderInspector();
    updateSelection();
}
export function sameEdge(a, b) {
    return Boolean(a && b && a.source === b.source && a.target === b.target && a.kind === b.kind);
}
export function selectEdge(index) {
    const edge = state.graph?.edges?.[index];
    if (!edge)
        return;
    state.edgeSelected = edge;
    state.selected = (state.selected === edge.source || state.selected === edge.target) ? state.selected : edge.source;
    state.sourceJump = null;
    renderTree();
    renderInspector();
    updateSelection();
}
export function preserveNode(id) {
    const p = state.positions?.get(id);
    if (p)
        state.viewAnchor = { id, x: state.pan.x + (p.x + CodeGraph.metrics.cardWidth / 2) * state.zoom, y: state.pan.y + (p.y + CodeGraph.metrics.cardHeight / 2) * state.zoom };
}
export function collapseBranch(id) {
    state.revealed.delete(id);
    for (const n of state.nodes.values())
        if (n.id !== id && state.model.isWithin(n.id, id))
            state.revealed.delete(n.id);
}
export function toggleReveal(id) {
    const n = state.nodes.get(id);
    if (!n || !canOpen(n))
        return;
    preserveNode(id);
    state.revealed.has(id) ? collapseBranch(id) : state.revealed.add(id);
    state.selected = id;
    state.edgeSelected = null;
    state.sourceJump = null;
    state.detail = 'overview';
    render();
}
export function navigate(id) {
    toggleReveal(id);
}
export function locate(id) {
    const n = state.nodes.get(id);
    if (!n)
        return;
    const alreadyVisible = state.graph?.nodes.some(item => item.id === id), view = $('graph-viewport');
    if (alreadyVisible)
        preserveNode(id);
    else
        state.viewAnchor = { id, x: view.clientWidth / 2, y: view.clientHeight / 2 };
    state.edgeSelected = null;
    state.sourceJump = null;
    state.selected = id;
    state.detail = n.kind === 'file' ? 'code' : 'overview';
    for (const a of ancestors(id).slice(0, -1)) {
        state.revealed.add(a.id);
        state.expanded.add(a.id);
    }
    render();
}

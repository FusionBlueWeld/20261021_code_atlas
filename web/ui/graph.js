import { $, esc, state, kinds, CodeGraph, icon, children, pathFor, canOpen, ancestors } from './state.js';
import { selectNode, selectEdge, sameEdge, navigate } from './navigation.js';
import { evidenceKind } from './inspector.js';
const edgeLabelTimers = new Map();
const { cardWidth, cardHeight } = CodeGraph.metrics;
export function renderGraph() {
    if (!state.data)
        return;
    for (const [id, mode] of [['structure-tab', 'structure'], ['relations-tab', 'relations']]) {
        $(id).classList.toggle('active', state.mode === mode);
        $(id).setAttribute('aria-selected', String(state.mode === mode));
    }
    const chain = ancestors(state.selected || 'root');
    $('back-button').disabled = true;
    $('breadcrumbs').innerHTML = chain.map((n, i) => `${i ? '<span>›</span>' : ''}<button data-id="${esc(n.id)}" title="${esc(n.path || n.name)}">${esc(n.name)}</button>`).join('');
    $('breadcrumbs').querySelectorAll('button').forEach(el => el.onclick = () => selectNode(el.dataset.id));
    const complete = state.model.explore(state.revealed);
    const visible = complete.nodes;
    const edges = state.mode === 'relations' ? complete.edges.filter(e => e.kind !== 'contains') : complete.edges;
    state.graph = { nodes: visible, edges };
    const evidencePriority = { explicit: 0, inline: 1, preceding: 2, docstring: 3 };
    state.commentEdgeIndexes = new Set(state.graph.edges.map((e, i) => ({ e, i })).filter(({ e }) => state.selected && (e.source === state.selected || e.target === state.selected) && (e.evidence || []).length).sort((a, b) => Math.min(...a.e.evidence.map(x => evidencePriority[x.kind] ?? 9)) - Math.min(...b.e.evidence.map(x => evidencePriority[x.kind] ?? 9))).slice(0, 8).map(({ i }) => i));
    const view = $('graph-viewport');
    // Keep the reading direction stable so the graph follows the reference
    // diagram's left-to-right flow instead of changing orientation by viewport.
    const layout = CodeGraph.layout(complete, 'LR', { rowGap: state.rowGap, columnGap: state.columnGap });
    state.bounds = { w: layout.width, h: layout.height };
    state.direction = layout.direction;
    const positions = new Map(layout.positions.map(p => [p.node.id, p]));
    state.positions = positions;
    edgeLabelTimers.forEach(timer => clearTimeout(timer));
    edgeLabelTimers.clear();
    $('graph-edges').innerHTML = state.graph.edges.map((e, i) => drawEdge(e, positions, i)).join('');
    $('graph-labels').innerHTML = state.graph.edges.map((e, i) => drawFloatingLabel(e, positions, i)).join('');
    $('graph-edges').querySelectorAll('.edge-hit').forEach(el => {
        const index = Number(el.dataset.index);
        el.onclick = () => selectEdge(index);
        el.onmouseenter = () => showEdgeLabel(index);
        el.onmouseleave = () => hideEdgeLabel(index);
    });
    $('graph-labels').querySelectorAll('.edge-floating-label').forEach(el => {
        const index = Number(el.dataset.index);
        el.onclick = () => selectEdge(index);
        el.onmouseenter = () => showEdgeLabel(index);
        el.onmouseleave = () => hideEdgeLabel(index);
    });
    syncCards(layout.positions);
    // Keyed cards remain under the pointer during a selection refresh. Restore
    // their hover labels without requiring the pointer to leave and re-enter.
    const hoveredCard = $('graph-nodes').querySelector('.graph-card:hover');
    if (hoveredCard) showNodeLabels(hoveredCard.dataset.id);
    $('pagination').innerHTML = `<span title="同じ親のカードをまとめ、フォルダ／ファイルは名前順、定義はソース順に配置します">${visible.length}ノード · 親ごと／ソース順</span>`;
    $('graph-empty').classList.toggle('hidden', Boolean(visible.length));
    $('graph-empty').textContent = '表示できるモジュールがありません';
    updateSelection();
    if (state.viewAnchor && positions.has(state.viewAnchor.id)) {
        const p = positions.get(state.viewAnchor.id);
        state.pan = { x: state.viewAnchor.x - (p.x + cardWidth / 2) * state.zoom, y: state.viewAnchor.y - (p.y + cardHeight / 2) * state.zoom };
        state.viewAnchor = null;
        applyTransform();
    }
    else if (!state.rendered)
        requestAnimationFrame(() => fitGraph(true));
    else
        applyTransform();
    state.rendered = true;
}
export function edgeLabelText(e, index) {
    if (!state.showComments || !state.commentEdgeIndexes?.has(index))
        return null;
    const evidence = (e.evidence || []).find(x => x.text) || e.evidence?.[0];
    if (!evidence)
        return null;
    const full = `${evidenceKind(evidence.kind)}: ${evidence.text || ''}`;
    return { full, shown: full.slice(0, 46) + (full.length > 46 ? '…' : '') };
}
export function edgeGeometry(a, b, index) {
    const right = b.x > a.x, same = a.x === b.x;
    const x1 = a.x + (right || same ? cardWidth : 0), x2 = b.x + (right ? 0 : cardWidth), y1 = a.y + cardHeight / 2, y2 = b.y + cardHeight / 2;
    let path, curve;
    if (a.node.id === b.node.id) {
        curve = [a.x + 65, a.y, a.x + 40, a.y - 34, a.x + 210, a.y - 34, a.x + 185, a.y];
        path = `M ${curve[0]} ${curve[1]} C ${curve[2]} ${curve[3]}, ${curve[4]} ${curve[5]}, ${curve[6]} ${curve[7]}`;
    }
    else if (state.direction === 'TB' && a.y !== b.y) {
        const down = b.y > a.y, sy = a.y + (down ? cardHeight : 0), ty = b.y + (down ? 0 : cardHeight), sx = a.x + cardWidth / 2, tx = b.x + cardWidth / 2, delta = Math.max(25, Math.abs(ty - sy) / 2);
        curve = [sx, sy, sx, sy + (down ? delta : -delta), tx, ty + (down ? -delta : delta), tx, ty];
        path = `M ${curve[0]} ${curve[1]} C ${curve[2]} ${curve[3]}, ${curve[4]} ${curve[5]}, ${curve[6]} ${curve[7]}`;
    }
    else if (same) {
        curve = [x1, y1, x1 + 38 + (index % 3) * 12, y1, x2 + 38 + (index % 3) * 12, y2, x2, y2];
        path = `M ${curve[0]} ${curve[1]} C ${curve[2]} ${curve[3]}, ${curve[4]} ${curve[5]}, ${curve[6]} ${curve[7]}`;
    }
    else {
        const delta = Math.max(38, Math.abs(x2 - x1) / 2);
        curve = [x1, y1, x1 + (right ? delta : -delta), y1, x2 + (right ? -delta : delta), y2, x2, y2];
        path = `M ${curve[0]} ${curve[1]} C ${curve[2]} ${curve[3]}, ${curve[4]} ${curve[5]}, ${curve[6]} ${curve[7]}`;
    }
    return { path, curve };
}
export function drawEdge(e, positions, index) {
    const a = positions.get(e.source), b = positions.get(e.target);
    if (!a || !b)
        return '';
    const { path } = edgeGeometry(a, b, index);
    const color = e.kind === 'contains' ? '#aab8c8' : e.kind === 'inherits' ? '#9a7dca' : '#6f9bd6';
    const title = (e.evidence || []).map(x => x.text).filter(Boolean).join(' | ');
    const selectedClass = sameEdge(state.edgeSelected, e) ? 'edge-selected' : '';
    return `<path class="graph-edge ${selectedClass}" data-source="${esc(e.source)}" data-target="${esc(e.target)}" data-kind="${e.kind}" d="${path}" fill="none" stroke="${color}" stroke-width="1.7" ${e.kind === 'contains' ? 'stroke-dasharray="4 4"' : ''}><title>${esc(title)}</title></path><path class="edge-pulse ${selectedClass}" data-source="${esc(e.source)}" data-target="${esc(e.target)}" data-kind="${e.kind}" d="${path}" fill="none" stroke="${color}" pathLength="100" style="--pulse-delay:-${(index % 8) * .18}s" aria-hidden="true"></path><path class="edge-hit" data-index="${index}" d="${path}" fill="none" stroke="transparent" stroke-width="14"><title>${esc(title)}</title></path>`;
}
export function drawFloatingLabel(e, positions, index) {
    const text = edgeLabelText(e, index), a = positions.get(e.source), b = positions.get(e.target);
    if (!text || !a || !b)
        return '';
    const { curve } = edgeGeometry(a, b, index);
    const midX = (curve[0] + 3 * curve[2] + 3 * curve[4] + curve[6]) / 8;
    let midY = (curve[1] + 3 * curve[3] + 3 * curve[5] + curve[7]) / 8;
    // A label must never cover the card's action row. Move the label above any
    // intersecting card while keeping it in the dedicated floating layer.
    const conflicts = [...positions.values()].filter(p => midX + 150 > p.x && midX - 150 < p.x + cardWidth && midY + 16 > p.y && midY - 16 < p.y + cardHeight);
    if (conflicts.length)
        midY = Math.min(...conflicts.map(p => p.y)) - 20;
    return `<button type="button" class="edge-label edge-floating-label edge-label-click" data-index="${index}" style="left:${midX}px;top:${midY}px" title="${esc(text.full)}" aria-label="${esc(text.full)}">${esc(text.shown)}</button>`;
}
export function labelElement(index) {
    return document.querySelector(`#graph-labels .edge-floating-label[data-index="${index}"]`);
}
export function showEdgeLabel(index) {
    const el = labelElement(index);
    if (!el)
        return;
    const timer = edgeLabelTimers.get(index);
    if (timer)
        clearTimeout(timer);
    el.classList.add('visible');
}
export function hideEdgeLabel(index) {
    const el = labelElement(index);
    if (!el)
        return;
    const timer = setTimeout(() => {
        if (!el.matches(':hover'))
            el.classList.remove('visible');
    }, 120);
    edgeLabelTimers.set(index, timer);
}
export function showNodeLabels(id) {
    for (const [index, e] of state.graph?.edges?.entries() || []) {
        if (e.source === id || e.target === id)
            showEdgeLabel(index);
    }
}
export function hideNodeLabels(id) {
    for (const [index, e] of state.graph?.edges?.entries() || []) {
        if (e.source === id || e.target === id)
            hideEdgeLabel(index);
    }
}
export function nodeCard({ node: n, x, y }) {
    const code = state.model.codeChildren(n.id), type = kinds[n.kind], childCount = state.model.explorableChildren(n.id).length, isOpen = state.revealed.has(n.id);
    const signature = CodeGraph.structuralKinds.has(n.kind) ? `${childCount}項目` : n.kind === 'class' || n.kind === 'interface' ? code.filter(c => c.kind === 'method').map(c => c.name).join(' · ') : n.kind === 'parameter' ? (n.type || '') + (n.default ? ' = ' + n.default : '') : '(' + (n.params || []).map(p => p.name).join(', ') + ')' + (n.returnType ? ' → ' + n.returnType : '');
    return `<div role="button" tabindex="0" aria-label="${esc(type + ' ' + n.name)}" aria-pressed="${state.selected === n.id}" ${canOpen(n) ? `aria-expanded="${isOpen}"` : ''} class="graph-card ${esc(n.kind)} ${isOpen ? 'expanded' : ''} ${state.selected === n.id ? 'selected' : ''}" data-id="${esc(n.id)}" data-kind="${esc(n.kind)}" style="left:${x}px;top:${y}px"><div class="node-heading">${icon(n)}<span class="node-name" title="${esc(n.name)}">${esc(n.name)}</span></div><div class="node-signature" title="${esc(signature)}">${esc(signature) || '&nbsp;'}</div><div class="node-footer"><span title="${esc(pathFor(n) + ':' + n.line)}">${esc(type)}${n.line ? ' · L' + n.line : ''}${n.context ? ' · context' : ''}</span>${canOpen(n) ? `<button class="node-open ${isOpen ? 'is-open' : ''}" aria-label="${isOpen ? '内部をしまう' : '内部を展開'}">${isOpen ? 'しまう −' : '展開 ＋'}</button>` : ''}</div></div>`;
}
export function updateSelection() {
    document.querySelectorAll('.graph-card').forEach(el => {
        const selected = el.dataset.id === state.selected;
        el.classList.toggle('selected', selected);
        el.setAttribute('aria-pressed', String(selected));
    });
    const related = state.graph?.edges.some(e => e.source === state.selected || e.target === state.selected);
    document.querySelectorAll('.graph-edge,.edge-pulse').forEach(el => {
        const selected = el.dataset.source === state.selected || el.dataset.target === state.selected;
        el.classList.toggle('emphasized', Boolean(related && selected));
        el.classList.toggle('dim', Boolean(related && !selected));
        el.classList.toggle('edge-selected', Boolean(state.edgeSelected && sameEdge({ source: el.dataset.source, target: el.dataset.target, kind: el.dataset.kind }, state.edgeSelected)));
    });
}
export function fitGraph(exact = true) {
    const view = $('graph-viewport');
    let zoom = Math.min(1, (view.clientWidth - 40) / state.bounds.w, (view.clientHeight - 35) / state.bounds.h);
    state.zoom = exact ? Math.max(.2, zoom) : Math.max(.72, zoom);
    state.pan = { x: Math.max(15, (view.clientWidth - state.bounds.w * state.zoom) / 2), y: Math.max(15, (view.clientHeight - state.bounds.h * state.zoom) / 2) };
    const selected = state.positions?.get(state.selected);
    if (!exact && selected) {
        const left = state.pan.x + selected.x * state.zoom, top = state.pan.y + selected.y * state.zoom;
        if (left < 0 || left + cardWidth * state.zoom > view.clientWidth || top < 0 || top + cardHeight * state.zoom > view.clientHeight)
            state.pan = { x: view.clientWidth / 2 - (selected.x + cardWidth / 2) * state.zoom, y: view.clientHeight / 2 - (selected.y + cardHeight / 2) * state.zoom };
    }
    applyTransform();
}
export function applyTransform() {
    $('graph-world').style.transform = `translate(${state.pan.x}px,${state.pan.y}px) scale(${state.zoom})`;
    $('zoom-label').textContent = Math.round(state.zoom * 100) + '%';
}
export function zoomBy(factor, point) {
    const view = $('graph-viewport'), p = point || { x: view.clientWidth / 2, y: view.clientHeight / 2 }, next = Math.min(2, Math.max(.2, state.zoom * factor)), ratio = next / state.zoom;
    state.pan = { x: p.x - (p.x - state.pan.x) * ratio, y: p.y - (p.y - state.pan.y) * ratio };
    state.zoom = next;
    applyTransform();
}
function syncCards(positions) {
    const host = $('graph-nodes');
    const existing = new Map([...host.children].map(el => [el.dataset.id, el]));
    const keep = new Set();
    const template = document.createElement('template');
    positions.forEach((position, index) => {
        template.innerHTML = nodeCard(position);
        const next = template.content.firstElementChild;
        let card = existing.get(position.node.id);
        if (!card)
            card = next;
        else {
            for (const attr of [...card.attributes])
                if (!next.hasAttribute(attr.name))
                    card.removeAttribute(attr.name);
            for (const attr of next.attributes)
                card.setAttribute(attr.name, attr.value);
            for (const selector of ['.node-heading', '.node-signature', '.node-footer > span']) {
                const currentPart = card.querySelector(selector), nextPart = next.querySelector(selector);
                if (currentPart.outerHTML !== nextPart.outerHTML)
                    currentPart.replaceWith(nextPart);
            }
            const button = card.querySelector('.node-open'), nextButton = next.querySelector('.node-open');
            if (button && nextButton) {
                button.className = nextButton.className;
                button.textContent = nextButton.textContent;
                button.setAttribute('aria-label', nextButton.getAttribute('aria-label'));
            }
            else if (nextButton)
                card.querySelector('.node-footer').append(nextButton);
            else
                button?.remove();
        }
        keep.add(card);
        if (host.children[index] !== card)
            host.insertBefore(card, host.children[index] || null);
    });
    for (const card of [...host.children])
        if (!keep.has(card))
            card.remove();
}
export function bindGraphEvents() {
    const host = $('graph-nodes');
    host.addEventListener('click', event => {
        const card = event.target.closest('.graph-card');
        if (!card)
            return;
        if (event.target.closest('.node-open'))
            navigate(card.dataset.id);
        else
            selectNode(card.dataset.id);
    });
    host.addEventListener('dblclick', event => {
        const card = event.target.closest('.graph-card');
        if (card && !event.target.closest('.node-open'))
            navigate(card.dataset.id);
    });
    host.addEventListener('keydown', event => {
        const card = event.target.closest('.graph-card');
        if (!card || event.target !== card)
            return;
        if (event.key === 'Enter') {
            event.preventDefault();
            selectNode(card.dataset.id);
        }
        if (event.key === ' ') {
            event.preventDefault();
            navigate(card.dataset.id);
        }
    });
    host.addEventListener('pointerover', event => {
        const card = event.target.closest('.graph-card');
        if (card && !card.contains(event.relatedTarget))
            showNodeLabels(card.dataset.id);
    });
    host.addEventListener('pointerout', event => {
        const card = event.target.closest('.graph-card');
        if (card && !card.contains(event.relatedTarget))
            hideNodeLabels(card.dataset.id);
    });
}

import { $, esc, state, icons, children, treeVisible } from './state.js';
import { locate, navigate } from './navigation.js';
export function renderTree() {
    const q = state.search.toLowerCase().trim();
    let html = '';
    const row = (n, depth, search = false) => {
        const expandable = children(n.id).some(c => c.kind !== 'parameter');
        return `<button class="tree-row ${state.selected === n.id ? 'selected' : ''}" data-id="${esc(n.id)}" style="padding-left:${6 + depth * 12}px" title="${esc(n.path || n.name)}" ${state.selected === n.id ? 'aria-current="true"' : ''}><span class="tree-chevron" data-toggle="${esc(n.id)}">${expandable ? (state.expanded.has(n.id) ? '⌄' : '›') : ''}</span><span class="tree-icon ${esc(n.kind)}">${icons[n.kind] || '◇'}</span><span class="tree-name">${esc(n.name)}${search ? `<span class="search-path">${esc(n.path)}</span>` : ''}</span></button>`;
    };
    if (q) {
        const matches = state.data.nodes.filter(n => n.kind !== 'repository' && treeVisible(n) && `${n.name} ${n.path} ${n.signature || ''}`.toLowerCase().includes(q)).slice(0, 150);
        html = matches.map(n => row(n, 0, true)).join('') || '<div class="search-empty">該当なし</div>';
    }
    else {
        let rendered = 0;
        const walk = (id, depth) => {
            const list = children(id).filter(n => n.kind !== 'parameter' && treeVisible(n)).slice().sort((a, b) => a.kind === 'folder' && b.kind !== 'folder' ? -1 : b.kind === 'folder' && a.kind !== 'folder' ? 1 : (a.line && b.line && a.kind !== 'file' ? a.line - b.line : a.name.localeCompare(b.name)));
            for (const n of list) {
                if (++rendered > 700)
                    return;
                html += row(n, depth);
                if (state.expanded.has(n.id))
                    walk(n.id, depth + 1);
            }
        };
        walk('root', 0);
    }
    $('file-tree').innerHTML = html;
    $('file-tree').querySelectorAll('.tree-row').forEach(el => {
        el.onclick = e => {
            const id = el.dataset.id;
            if (e.target.closest('[data-toggle]') && children(id).length) {
                state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
                renderTree();
                return;
            }
            locate(id);
        };
        el.ondblclick = () => navigate(el.dataset.id);
    });
}

// Graph geometry is shared by browser UI and Node model tests.
(function (root) {
    'use strict';
    const metrics = Object.freeze({
        cardWidth: 244, cardHeight: 128,
        minRowGap: 152, maxRowGap: 640, defaultRowGap: 168,
        minColumnGap: 292, maxColumnGap: 900, defaultColumnGap: 338
    });
    function boundedGap(value, min, max, fallback) {
        const requested = Number(value);
        return Number.isFinite(requested) ? Math.max(min, Math.min(max, requested)) : fallback;
    }
    function layout(graph, direction = 'LR', layoutOptions = {}) {
        const rowGap = boundedGap(layoutOptions?.rowGap, metrics.minRowGap, metrics.maxRowGap, metrics.defaultRowGap);
        const columnGap = boundedGap(layoutOptions?.columnGap, metrics.minColumnGap, metrics.maxColumnGap, metrics.defaultColumnGap);
        const nodes = [...new Map((graph?.nodes || []).map(node => [node.id, node])).values()];
        const ids = new Set(nodes.map(node => node.id));
        const edges = (graph?.edges || []).filter(edge => edge && ids.has(edge.source) && ids.has(edge.target));
        direction = direction === 'TB' ? 'TB' : 'LR';
        const contains = edges.filter(edge => edge.kind === 'contains' && edge.source !== edge.target);
        return contains.length
            ? hierarchyLayout(nodes, contains, direction, rowGap, columnGap)
            : relationLayout({ nodes, edges }, direction, rowGap, columnGap);
    }
    function hierarchyLayout(nodes, contains, direction, rowGap, columnGap) {
        const byId = new Map(nodes.map(node => [node.id, node]));
        const sourceOrder = new Map(nodes.map((node, index) => [node.id, index]));
        const structuralOrder = { repository: 0, folder: 1, file: 2 };
        const natural = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
        function compare(a, b) {
            if (a.kind === 'parameter' || b.kind === 'parameter')
                return a.kind === b.kind ? sourceOrder.get(a.id) - sourceOrder.get(b.id) : a.kind === 'parameter' ? -1 : 1;
            const kindDifference = (structuralOrder[a.kind] ?? 3) - (structuralOrder[b.kind] ?? 3);
            if (kindDifference)
                return kindDifference;
            if (!(a.kind in structuralOrder) && !(b.kind in structuralOrder) &&
                (a.path === b.path || (a.parent && a.parent === b.parent)) &&
                Number.isFinite(a.line) && Number.isFinite(b.line) && a.line !== b.line)
                return a.line - b.line;
            return natural(a.name, b.name) || natural(a.path, b.path) ||
                natural(a.id, b.id) || sourceOrder.get(a.id) - sourceOrder.get(b.id);
        }
        const parents = new Map(), candidates = new Map();
        for (const edge of contains) {
            if (!candidates.has(edge.target))
                candidates.set(edge.target, new Set());
            candidates.get(edge.target).add(edge.source);
        }
        for (const [id, choices] of candidates) {
            const node = byId.get(id);
            const ordered = [...choices].sort((a, b) => compare(byId.get(a), byId.get(b)));
            parents.set(id, choices.has(node.parent) ? node.parent : ordered[0]);
        }
        // Malformed input can contain several parents or a containment cycle.
        // Keep one deterministic parent and break one edge per cycle.
        const settled = new Set();
        for (const node of [...nodes].sort(compare)) {
            const chain = [], inChain = new Map();
            let id = node.id;
            while (parents.has(id) && !settled.has(id)) {
                if (inChain.has(id)) {
                    const cycle = chain.slice(inChain.get(id));
                    cycle.sort((a, b) => compare(byId.get(a), byId.get(b)));
                    parents.delete(cycle[0]);
                    break;
                }
                inChain.set(id, chain.length);
                chain.push(id);
                id = parents.get(id);
            }
            chain.forEach(item => settled.add(item));
        }
        const children = new Map(nodes.map(node => [node.id, []]));
        for (const [child, parent] of parents)
            children.get(parent).push(byId.get(child));
        children.forEach(list => list.sort(compare));
        const roots = nodes.filter(node => !parents.has(node.id)).sort(compare);
        const order = [], stack = roots.map(node => ({ node, depth: 0 })).reverse();
        while (stack.length) {
            const item = stack.pop();
            order.push(item);
            const list = children.get(item.node.id);
            for (let index = list.length - 1; index >= 0; index--)
                stack.push({ node: list[index], depth: item.depth + 1 });
        }
        const spans = new Map();
        for (let index = order.length - 1; index >= 0; index--) {
            const node = order[index].node, list = children.get(node.id);
            spans.set(node.id, list.length ? list.reduce((sum, child) => sum + spans.get(child.id), 0) : 1);
        }
        // Allocate a continuous leaf band to each branch. Relation edges never
        // influence these bands, their order, or the structural depth.
        const starts = new Map();
        let leafCount = 0, maxDepth = 0;
        for (const node of roots) {
            starts.set(node.id, leafCount);
            leafCount += spans.get(node.id);
        }
        const positions = order.map(({ node, depth }) => {
            const start = starts.get(node.id), span = spans.get(node.id);
            const center = start + (span - 1) / 2;
            let next = start;
            for (const child of children.get(node.id)) {
                starts.set(child.id, next);
                next += spans.get(child.id);
            }
            maxDepth = Math.max(maxDepth, depth);
            return direction === 'TB'
                ? { node, x: 28 + center * columnGap, y: 34 + depth * rowGap }
                : { node, x: 28 + depth * columnGap, y: 34 + center * rowGap };
        });
        return {
            positions,
            width: direction === 'TB' ? Math.max(300, (leafCount - 1) * columnGap + 300) : maxDepth * columnGap + 300,
            height: direction === 'TB' ? maxDepth * rowGap + 190 : Math.max(40, leafCount * rowGap + 40),
            direction, rowGap, columnGap
        };
    }
    function relationLayout(graph, direction, rowGap, columnGap) {
        const adjacency = new Map(graph.nodes.map(n => [n.id, []]));
        graph.edges.forEach(e => {
            if (e.source !== e.target && adjacency.has(e.source) && adjacency.has(e.target))
                adjacency.get(e.source).push(e.target);
        });
        const indices = new Map(), lows = new Map(), stack = [], active = new Set(), components = [];
        let index = 0;
        function visit(id) {
            indices.set(id, index);
            lows.set(id, index++);
            stack.push(id);
            active.add(id);
            for (const target of adjacency.get(id)) {
                if (!indices.has(target)) {
                    visit(target);
                    lows.set(id, Math.min(lows.get(id), lows.get(target)));
                }
                else if (active.has(target))
                    lows.set(id, Math.min(lows.get(id), indices.get(target)));
            }
            if (lows.get(id) === indices.get(id)) {
                const component = [];
                let target;
                do {
                    target = stack.pop();
                    active.delete(target);
                    component.push(target);
                } while (target !== id);
                components.push(component);
            }
        }
        graph.nodes.forEach(n => {
            if (!indices.has(n.id))
                visit(n.id);
        });
        const componentOf = new Map();
        components.forEach((ids, i) => ids.forEach(id => componentOf.set(id, i)));
        const outgoing = components.map(() => new Set()), degree = components.map(() => 0), rank = components.map(() => 0);
        graph.edges.forEach(e => {
            const a = componentOf.get(e.source), b = componentOf.get(e.target);
            if (a !== undefined && b !== undefined && a !== b && !outgoing[a].has(b)) {
                outgoing[a].add(b);
                degree[b]++;
            }
        });
        const queue = degree.map((d, i) => d === 0 ? i : -1).filter(i => i >= 0);
        for (let q = 0; q < queue.length; q++)
            for (const b of outgoing[queue[q]]) {
                rank[b] = Math.max(rank[b], rank[queue[q]] + 1);
                if (--degree[b] === 0)
                    queue.push(b);
            }
        const columns = new Map();
        graph.nodes.forEach(n => {
            const c = rank[componentOf.get(n.id)];
            if (!columns.has(c))
                columns.set(c, []);
            columns.get(c).push(n);
        });
        if (columns.size === 1 && graph.nodes.length > 5 && !graph.edges.length) {
            columns.clear();
            graph.nodes.forEach((n, i) => {
                const c = Math.floor(i / 5);
                if (!columns.has(c))
                    columns.set(c, []);
                columns.get(c).push(n);
            });
        }
        const rowOf = new Map(), sourceOrder = new Map(graph.nodes.map((n, i) => [n.id, i]));
        [...columns.keys()].sort((a, b) => a - b).forEach(c => {
            const score = n => {
                const parents = graph.edges.filter(e => e.target === n.id && rowOf.has(e.source));
                return parents.length ? parents.reduce((sum, e) => sum + rowOf.get(e.source), 0) / parents.length : 100;
            };
            columns.get(c).sort((a, b) => a.kind === 'parameter' && b.kind === 'parameter' ? sourceOrder.get(a.id) - sourceOrder.get(b.id) : score(a) - score(b) || (a.name || '').localeCompare(b.name || ''));
            columns.get(c).forEach((n, i) => rowOf.set(n.id, i));
        });
        const maxRows = Math.max(1, ...[...columns.values()].map(list => list.length)), positions = [];
        for (const [column, list] of columns)
            list.forEach((node, index) => positions.push(direction === 'TB'
                ? { node, x: 28 + (maxRows - list.length) * columnGap / 2 + index * columnGap, y: 34 + column * rowGap }
                : { node, x: 28 + column * columnGap, y: 34 + (maxRows - list.length) * rowGap / 2 + index * rowGap }));
        const lastColumn = Math.max(0, ...columns.keys());
        return {
            positions,
            width: direction === 'TB' ? (maxRows - 1) * columnGap + 300 : lastColumn * columnGap + 300,
            height: direction === 'TB' ? lastColumn * rowGap + 190 : maxRows * rowGap + 40,
            direction, rowGap, columnGap
        };
    }
    const api = { layout, metrics };
    if (typeof module !== 'undefined' && module.exports)
        module.exports = api;
    else
        root.CodeLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

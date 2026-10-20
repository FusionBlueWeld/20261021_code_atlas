(function (root) {
    'use strict';
    // Shared dimensions: CSS, edge anchors, camera, and layout use one contract.
    const { layout, metrics } = typeof module !== 'undefined' && module.exports ? require('./graph/layout.js') : root.CodeLayout;
    const codeKinds = new Set(['class', 'function', 'method', 'interface', 'type', 'parameter']);
    const structuralKinds = new Set(['repository', 'folder', 'file']);
    const relationKinds = new Set(['calls', 'inherits']);
    const evidenceKinds = new Set(['explicit', 'inline', 'preceding', 'docstring']);
    function evidenceKey(e) {
        return [e.kind || '', e.text || '', e.path || '', e.line ?? '', e.endLine ?? '', e.callLine ?? ''].join('|');
    }
    function mergeEvidence(target, source) {
        const result = [], seen = new Set();
        for (const item of [...(target || []), ...(source || [])]) {
            if (!item || typeof item !== 'object')
                continue;
            const e = {
                kind: evidenceKinds.has(item.kind) ? item.kind : (item.kind || 'explicit'), text: String(item.text ?? ''), path: String(item.path ?? ''), line: item.line ?? null, endLine: item.endLine ?? item.line ?? null, callLine: item.callLine ?? null
            };
            const key = evidenceKey(e);
            if (!seen.has(key)) {
                seen.add(key);
                result.push(e);
            }
        }
        return result;
    }
    function mergeEdge(target, source) {
        if (!target)
            return { ...source, evidence: mergeEvidence([], source.evidence), occurrences: source.occurrences ?? source.count ?? 1, count: source.count ?? source.occurrences ?? 1 };
        target.evidence = mergeEvidence(target.evidence, source.evidence);
        target.occurrences = (target.occurrences ?? target.count ?? 0) + (source.occurrences ?? source.count ?? 1);
        target.count = target.occurrences;
        if (!target.label && source.label)
            target.label = source.label;
        return target;
    }
    function normalizeEdge(e) {
        return { ...e, evidence: mergeEvidence([], e.evidence), occurrences: e.occurrences ?? e.count ?? 1, count: e.count ?? e.occurrences ?? 1 };
    }
    function createModel(data, initialOptions = {}) {
        data = data || { nodes: [], edges: [] };
        const rawNodes = (data.nodes || []).map(n => ({ ...n })), rawEdges = (data.edges || []).map(normalizeEdge);
        const nodes = new Map(rawNodes.map(n => [n.id, n])), children = new Map();
        function add(n) {
            if (!children.has(n.parent))
                children.set(n.parent, []);
            children.get(n.parent).push(n);
        }
        rawNodes.forEach(add);
        for (const n of rawNodes)
            (n.params || []).forEach((p, i) => {
                const child = {
                    ...p, id: `${n.id}:param:${i}`, kind: 'parameter', parent: n.id, path: n.path, line: n.line, endLine: n.line, projectId: n.projectId, isTest: n.isTest, signature: p.name + (p.type ? ': ' + p.type : '')
                };
                nodes.set(child.id, child);
                add(child);
            });
        const projects = Array.isArray(data.projects) ? data.projects : [];
        const hasProjects = projects.length > 0 || rawNodes.some(n => n.projectId);
        const firstProject = data.defaultProject || projects[0]?.id || null;
        const options = { projectId: initialOptions.projectId ?? initialOptions.project ?? (hasProjects ? firstProject : '*'), module: initialOptions.module ?? initialOptions.modulePath ?? '*', includeTests: Boolean(initialOptions.includeTests) };
        const getChildren = id => children.get(id) || [];
        const projectMatches = n => structuralKinds.has(n.kind) || !hasProjects || options.projectId === '*' || !options.projectId || n.projectId === options.projectId;
        const moduleMatches = n => structuralKinds.has(n.kind) || options.module === '*' || !options.module || n.kind === 'parameter' || (n.path || '') === options.module || (n.path || '').startsWith(`${options.module}/`);
        const testMatches = n => structuralKinds.has(n.kind) || options.includeTests || !n.isTest;
        const eligible = n => projectMatches(n) && moduleMatches(n) && testMatches(n);
        function rawCodeChildren(id) {
            return getChildren(id).flatMap(n => codeKinds.has(n.kind) ? [n] : rawCodeChildren(n.id));
        }
        function codeChildren(id) {
            return rawCodeChildren(id).filter(eligible);
        }
        function isWithin(id, ancestor) {
            let n = nodes.get(id);
            while (n) {
                if (n.id === ancestor)
                    return true;
                n = nodes.get(n.parent);
            }
            return false;
        }
        function project(id, visible) {
            let n = nodes.get(id);
            while (n && codeKinds.has(n.kind)) {
                if (visible.has(n.id))
                    return n.id;
                n = nodes.get(n.parent);
            }
            return null;
        }
        function isExplicit(e) {
            return Boolean(e.explicit) || (e.evidence || []).some(x => x.kind === 'explicit');
        }
        function projectedEdges(visibleNodes) {
            const visible = new Set(visibleNodes.map(n => n.id)), result = new Map();
            for (const edge of rawEdges) {
                if (!relationKinds.has(edge.kind))
                    continue;
                if (!codeKinds.has(nodes.get(edge.source)?.kind) || !codeKinds.has(nodes.get(edge.target)?.kind))
                    continue;
                const source = project(edge.source, visible), target = project(edge.target, visible);
                if (!source || !target || (source === target && edge.source !== edge.target))
                    continue;
                const key = `${source}|${target}|${edge.kind}`;
                result.set(key, mergeEdge(result.get(key), { ...edge, source, target }));
            }
            for (const n of visibleNodes)
                if (visible.has(n.parent) && codeKinds.has(nodes.get(n.parent)?.kind))
                    result.set(`${n.parent}|${n.id}|contains`, {
                        source: n.parent, target: n.id, kind: 'contains', count: 1, occurrences: 1, evidence: []
                    });
            return [...result.values()];
        }
        function structure(scope = 'root') {
            const focus = nodes.get(scope);
            if (!focus)
                return { nodes: [], edges: [] };
            const visible = codeChildren(scope);
            if (codeKinds.has(focus.kind) && eligible(focus))
                visible.unshift(focus);
            return { nodes: visible, edges: projectedEdges(visible) };
        }
        function calls(scope = 'root') {
            const focus = nodes.get(scope);
            if (!focus)
                return { nodes: [], edges: [] };
            const structuralScope = structuralKinds.has(focus.kind);
            if (structuralScope) {
                const base = structure(scope), visibleIds = new Set(base.nodes.map(n => n.id)), visible = new Map(base.nodes.map(n => [n.id, n])), edges = new Map();
                for (const edge of rawEdges) {
                    if (!relationKinds.has(edge.kind))
                        continue;
                    const a = nodes.get(edge.source), b = nodes.get(edge.target);
                    if (!codeKinds.has(a?.kind) || !codeKinds.has(b?.kind) || !isWithin(edge.source, scope) || !isWithin(edge.target, scope))
                        continue;
                    let source = project(edge.source, visibleIds), target = project(edge.target, visibleIds);
                    const aOk = Boolean(source), bOk = Boolean(target), cross = hasProjects && options.projectId !== '*' && a.projectId !== b.projectId;
                    if (!aOk && !bOk)
                        continue;
                    if (cross && (aOk !== bOk)) {
                        const external = aOk ? b : a;
                        visible.set(external.id, { ...external, context: true, contextOf: external.id });
                        if (!aOk)
                            source = external.id;
                        if (!bOk)
                            target = external.id;
                    }
                    if (!source || !target || (source === target && edge.source !== edge.target))
                        continue;
                    const key = `${source}|${target}|${edge.kind}`;
                    edges.set(key, mergeEdge(edges.get(key), { ...edge, source, target }));
                }
                return { nodes: [...visible.values()], edges: [...edges.values()] };
            }
            const edges = new Map(), visible = new Map([[focus.id, focus]]);
            const projectTestOnly = n => (!hasProjects || options.projectId === '*' || !n.projectId || n.projectId === options.projectId) && (options.includeTests || !n.isTest);
            for (const edge of rawEdges) {
                if (!relationKinds.has(edge.kind))
                    continue;
                const sourceNode = nodes.get(edge.source), targetNode = nodes.get(edge.target);
                if (!codeKinds.has(sourceNode?.kind) || !codeKinds.has(targetNode?.kind))
                    continue;
                const fromInside = isWithin(edge.source, scope), toInside = isWithin(edge.target, scope);
                if (!fromInside && !toInside)
                    continue;
                let source = fromInside ? scope : edge.source, target = toInside ? scope : edge.target;
                const external = fromInside ? targetNode : sourceNode, externalProject = external?.projectId;
                const crossProject = hasProjects && externalProject && options.projectId !== '*' && externalProject !== options.projectId;
                if (!options.includeTests && (sourceNode.isTest || targetNode.isTest))
                    continue;
                // The selected module determines the focus graph. A resolved relation may
                // still bring its other project/file in as context.
                if (source !== scope && !projectTestOnly(sourceNode) && !crossProject)
                    continue;
                if (target !== scope && !projectTestOnly(targetNode) && !crossProject)
                    continue;
                if (crossProject) {
                    const contextId = external.id;
                    if (!visible.has(contextId))
                        visible.set(contextId, { ...external, context: true, contextOf: external.id });
                }
                if (source === target && edge.source !== edge.target)
                    continue;
                const key = `${source}|${target}|${edge.kind}`;
                edges.set(key, mergeEdge(edges.get(key), { ...edge, source, target }));
                if (!visible.has(source))
                    visible.set(source, nodes.get(source) || visible.get(source));
                if (!visible.has(target))
                    visible.set(target, nodes.get(target) || visible.get(target));
            }
            return { nodes: [...visible.values()].filter(n => n && (n.context || projectTestOnly(n) || n.id === focus.id)), edges: [...edges.values()] };
        }
        const branchMemo = new Map();
        function branchEligible(n) {
            if (!n)
                return false;
            if (n.kind === 'repository')
                return true;
            if (codeKinds.has(n.kind))
                return eligible(n);
            if (n.kind === 'file') {
                const projectOk = !hasProjects || options.projectId === '*' || !options.projectId || n.projectId === options.projectId;
                const moduleOk = options.module === '*' || !options.module || (n.path || '') === options.module || (n.path || '').startsWith(`${options.module}/`);
                return projectOk && moduleOk && (options.includeTests || !n.isTest);
            }
            if (branchMemo.has(n.id))
                return branchMemo.get(n.id);
            const result = getChildren(n.id).some(branchEligible);
            branchMemo.set(n.id, result);
            return result;
        }
        function explorableChildren(id) {
            branchMemo.clear();
            return getChildren(id).filter(branchEligible);
        }
        function fileVisible(n) {
            if (!n || n.kind !== 'file')
                return false;
            const projectOk = !hasProjects || options.projectId === '*' || !options.projectId || n.projectId === options.projectId;
            const moduleOk = options.module === '*' || !options.module || (n.path || '') === options.module || (n.path || '').startsWith(`${options.module}/`);
            return projectOk && moduleOk && (options.includeTests || !n.isTest);
        }
        function relationEndpointVisible(n) {
            if (!n)
                return false;
            if (codeKinds.has(n.kind))
                return eligible(n);
            if (n.kind === 'file')
                return fileVisible(n);
            return false;
        }
        function explore(expandedIds = ['root']) {
            const expanded = expandedIds instanceof Set ? expandedIds : new Set(expandedIds), visible = new Map(), ordered = [];
            function add(n) {
                if (!n || visible.has(n.id))
                    return;
                visible.set(n.id, n);
                ordered.push(n);
            }
            function walk(id) {
                if (!expanded.has(id))
                    return;
                for (const child of explorableChildren(id)) {
                    add(child);
                    walk(child.id);
                }
            }
            const root = nodes.get('root');
            if (!root)
                return { nodes: [], edges: [] };
            add(root);
            walk(root.id);
            const visibleIds = new Set(visible.keys()), result = new Map();
            for (const n of ordered)
                if (n.parent && visibleIds.has(n.parent))
                    result.set(`${n.parent}|${n.id}|contains`, {
                        source: n.parent, target: n.id, kind: 'contains', count: 1, occurrences: 1, evidence: []
                    });
            function visibleAncestor(id) {
                let n = nodes.get(id);
                while (n) {
                    if (visibleIds.has(n.id))
                        return n.id;
                    n = nodes.get(n.parent);
                }
                return null;
            }
            for (const edge of rawEdges) {
                if (!relationKinds.has(edge.kind))
                    continue;
                const sourceNode = nodes.get(edge.source), targetNode = nodes.get(edge.target);
                if (!relationEndpointVisible(sourceNode) || !relationEndpointVisible(targetNode))
                    continue;
                const source = visibleAncestor(edge.source), target = visibleAncestor(edge.target);
                if (!source || !target)
                    continue;
                if (source === target && edge.source !== edge.target)
                    continue;
                const key = `${source}|${target}|${edge.kind}`;
                result.set(key, mergeEdge(result.get(key), { ...edge, source, target }));
            }
            return { nodes: ordered, edges: [...result.values()] };
        }
        function setFilters(next = {}) {
            if (Object.hasOwn(next, 'projectId') || Object.hasOwn(next, 'project'))
                options.projectId = next.projectId ?? next.project ?? '*';
            if (Object.hasOwn(next, 'module') || Object.hasOwn(next, 'modulePath'))
                options.module = next.module ?? next.modulePath ?? '*';
            if (Object.hasOwn(next, 'includeTests'))
                options.includeTests = Boolean(next.includeTests);
            branchMemo.clear();
            return getFilters();
        }
        function getFilters() {
            return { ...options };
        }
        function filterNodes() {
            return [...nodes.values()].filter(eligible);
        }
        return {
            nodes, children: getChildren, codeChildren, rawCodeChildren, structure, calls, explore, explorableChildren, isWithin, setFilters, setProject: id => setFilters({ projectId: id }), setModule: path => setFilters({ module: path }), getFilters, filterNodes, isVisible: eligible, isFileVisible: fileVisible, projects, hasProjects, mergeEvidence, evidenceKey
        };
    }
    const api = {
        createModel, layout, metrics, codeKinds, structuralKinds, mergeEvidence, evidenceKey
    };
    if (typeof module !== 'undefined' && module.exports)
        module.exports = api;
    else
        root.CodeGraph = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

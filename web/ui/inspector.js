import { $, esc, state, CodeGraph, toast, icon, pathFor, canOpen, download } from './state.js';
import { locate, toggleReveal } from './navigation.js';
import { renderGraph } from './graph.js';
export function member(n) {
    return `<button class="member-button" data-locate="${esc(n.id)}">${icon(n)}<span class="member-name">${esc(n.name)}</span><span class="member-line">${n.line ? 'L' + n.line : ''}</span></button>`;
}
export function kv(key, value) {
    return `<div class="detail-kv"><span>${esc(key)}</span><strong>${esc(value)}</strong></div>`;
}
export function evidenceKind(kind) {
    return ({ explicit: '明示コメント', inline: '行末コメント', preceding: '直前コメント', docstring: '呼出先docstring' })[kind] || kind || '出典';
}
export function renderSourceJump() {
    const j = state.sourceJump, sourceMap = state.data.sources || {};
    let actualPath = j && Object.hasOwn(sourceMap, j.path) ? j.path : '';
    if (!actualPath && j?.path)
        actualPath = Object.keys(sourceMap).find(k => k === j.path.split(':').slice(-1)[0] || k.endsWith('/' + j.path) || k.endsWith('\\' + j.path)) || '';
    const source = actualPath ? sourceMap[actualPath] : null;
    if (!j || typeof source !== 'string')
        return false;
    const lines = source.split('\n'), start = Math.max(0, (j.line || 1) - 3), end = Math.min(lines.length, (j.endLine || j.line || 1) + 3);
    $('inspector').innerHTML = `<div class="inspector-identity"><span class="node-icon file">▤</span><span class="inspector-name">出典</span></div><div class="inspector-path">${esc(j.path || actualPath)} : ${j.line || '?'}</div><div class="detail-tabs"><button class="active">コード</button></div><div class="source-toolbar"><span>L${start + 1}–${end} / ${lines.length}</span></div><div class="source-code">${lines.slice(start, end).map((line, i) => `<div class="source-line ${start + i + 1 >= (j.line || 1) && start + i + 1 <= (j.endLine || j.line || 1) ? 'highlight' : ''}"><span class="line-number">${start + i + 1}</span><span class="source-text">${highlight(line)}</span></div>`).join('')}</div>`;
    return true;
}
export function renderEdgeInspector() {
    const e = state.edgeSelected;
    if (!e)
        return false;
    const source = state.nodes.get(e.source), target = state.nodes.get(e.target), items = e.evidence || [];
    $('inspector').innerHTML = `<div class="inspector-identity"><span class="node-icon ${esc(e.kind)}">→</span><span class="inspector-name">${esc(source?.name || e.source)} → ${esc(target?.name || e.target)}</span></div><div class="inspector-path">${esc(e.kind === 'calls' ? '呼び出し' : e.kind === 'inherits' ? '継承' : '所属')} · ${e.occurrences || e.count || 1}件</div><div class="edge-evidence"><div class="edge-evidence-title">出典 ${items.length}件</div>${items.length ? items.map((x, i) => `<button class="evidence-button" data-evidence="${i}"><span class="evidence-kind">${esc(evidenceKind(x.kind))}</span> ${esc(x.text || '（原文なし）')}<span class="evidence-path">${esc(x.path || '')} ${x.line ? ' : L' + x.line + (x.endLine && x.endLine !== x.line ? '–' + x.endLine : '') : ''}</span></button>`).join('') : '<span class="empty-detail">出典なし</span>'}</div>`;
    $('inspector').querySelectorAll('[data-evidence]').forEach(el => el.onclick = () => {
        const x = items[Number(el.dataset.evidence)];
        if (x?.path) {
            state.sourceJump = x;
            renderSourceJump();
        }
    });
    return true;
}
export function renderInspector() {
    if (state.sourceJump && renderSourceJump())
        return;
    if (state.edgeSelected && renderEdgeInspector())
        return;
    const n = state.graph?.nodes.find(x => x.id === state.selected && x.context) || state.nodes.get(state.selected);
    if (!n) {
        $('inspector').innerHTML = '';
        return;
    }
    const hasSource = Object.hasOwn(state.data.sources, n.path);
    if (!hasSource && state.detail === 'code')
        state.detail = 'overview';
    let body = '';
    if (state.detail === 'code') {
        const lines = state.data.sources[n.path].split('\n'), start = n.kind === 'file' ? 0 : Math.max(0, (n.line || 1) - 3), end = n.kind === 'file' ? Math.min(lines.length, 1500) : Math.min(lines.length, (n.endLine || n.line) + 2, start + 1000);
        body = `<div class="source-toolbar"><span>L${start + 1}–${end} / ${lines.length}</span><button id="copy-source">コピー</button></div><div class="source-code">${lines.slice(start, end).map((line, i) => `<div class="source-line ${n.kind !== 'file' && start + i + 1 >= n.line && start + i + 1 <= n.endLine ? 'highlight' : ''}"><span class="line-number">${start + i + 1}</span><span class="source-text">${highlight(line)}</span></div>`).join('')}</div><button id="save-source" class="inspector-open">コードを保存</button>`;
    }
    else {
        if (n.signature)
            body += `<pre class="detail-signature">${esc(n.signature)}</pre>`;
        if (n.returnType)
            body += kv('戻り値', n.returnType);
        if (n.kind === 'parameter')
            body += kv('型', n.type || '—') + kv('初期値', n.default || '—');
        if (n.params?.length)
            body += '<table class="parameter-table"><thead><tr><th>引数</th><th>型</th><th>初期値</th></tr></thead><tbody>' + n.params.map(p => `<tr><td>${esc((p.mode === 'variadic' ? '*' : p.mode === 'keyword-variadic' ? '**' : '') + p.name)}</td><td>${esc(p.type || '—')}</td><td>${esc(p.default || '—')}</td></tr>`).join('') + '</tbody></table>';
        const members = state.model.explorableChildren(n.id).filter(c => c.kind !== 'parameter');
        if (members.length)
            body += '<div class="member-list">' + members.slice(0, 70).map(member).join('') + '</div>';
        if (canOpen(n))
            body += `<button id="inspect-open" class="inspector-open">${state.revealed.has(n.id) ? 'この枝をしまう −' : 'この場で展開 ＋'}</button>`;
        if (CodeGraph.codeKinds.has(n.kind))
            body += '<button id="show-relations" class="inspector-open">呼び出しを表示 →</button>';
        if (n.doc && CodeGraph.codeKinds.has(n.kind))
            body += `<details class="code-comments"><summary>docstring</summary><pre>${esc(n.doc)}</pre></details>`;
        if (!body)
            body = '<div class="empty-detail">定義なし</div>';
    }
    $('inspector').innerHTML = `<div class="inspector-identity">${icon(n)}<span class="inspector-name">${esc(n.name)}</span></div><div class="inspector-path">${esc(pathFor(n))}${n.line ? ' : ' + n.line : ''}</div><div class="detail-tabs"><button data-detail="overview" class="${state.detail === 'overview' ? 'active' : ''}">定義</button><button data-detail="code" ${!hasSource ? 'disabled' : ''} class="${state.detail === 'code' ? 'active' : ''}">コード</button></div>${body}`;
    document.querySelectorAll('[data-detail]').forEach(el => el.onclick = () => {
        state.detail = el.dataset.detail;
        renderInspector();
    });
    document.querySelectorAll('[data-locate]').forEach(el => el.onclick = () => locate(el.dataset.locate));
    if ($('inspect-open'))
        $('inspect-open').onclick = () => toggleReveal(n.id);
    if ($('show-relations'))
        $('show-relations').onclick = () => {
            state.mode = 'relations';
            state.selected = n.id;
            renderGraph();
            renderInspector();
        };
    if ($('copy-source'))
        $('copy-source').onclick = async () => {
            try {
                await navigator.clipboard.writeText(state.data.sources[n.path]);
                toast('コピーしました');
            }
            catch {
                toast('コピーできませんでした');
            }
        };
    if ($('save-source'))
        $('save-source').onclick = () => download(state.data.sources[n.path], n.path.split('/').pop(), 'text/plain');
}
export function highlight(line) {
    const pattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\n]*|\/\/[^\n]*|\b(?:def|class|return|if|else|elif|for|while|from|import|as|async|await|None|True|False|self|const|let|function|export|new|this|interface|type|extends|throw|try|except|with|in)\b)/g;
    let result = '', last = 0;
    for (const match of line.matchAll(pattern)) {
        result += esc(line.slice(last, match.index));
        const token = match[0];
        result += `<span class="source-token-${token.startsWith('#') || token.startsWith('//') ? 'comment' : token.startsWith('"') || token.startsWith("'") ? 'string' : 'keyword'}">${esc(token)}</span>`;
        last = match.index + token.length;
    }
    return result + esc(line.slice(last));
}

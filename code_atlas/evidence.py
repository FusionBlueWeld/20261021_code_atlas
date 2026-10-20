"""Attach source comments and docstrings to relationships."""
import io
import re
import tokenize


def _edge_evidence(path, line, end_line, target, sources, call_line=None, cache=None,
                   callee=None, statement_line=None, statement_end_line=None, statement_col=None):
    """Extract a small, source-grounded explanation without executing code."""
    content = sources.get(path, '')
    lines = content.splitlines()
    call_line = call_line or line
    comments = cache.get(path) if cache is not None and path in cache else None
    if comments is None:
        comments = []
        try:
            for token in tokenize.generate_tokens(io.StringIO(content).readline):
                if token.type == tokenize.COMMENT:
                    text_value = token.string[1:].strip()
                    if text_value and not _separator_comment(text_value):
                        comments.append((token.start[0], token.start[1], text_value))
        except (tokenize.TokenError, IndentationError):
            pass
    if not path.endswith('.py'):
        # JavaScript and TypeScript comments are intentionally not inferred here:
        # a URL or division expression must never become source evidence.
        comments = []
    if cache is not None:
        cache[path] = comments
    chosen = None
    target_name = target.get('name', '')
    statement_line = statement_line if statement_line is not None else line
    statement_end_line = statement_end_line if statement_end_line is not None else end_line
    statement_col = statement_col if statement_col is not None else 0
    callee = callee or target_name
    # An explicit hook belongs only to the directly preceding, same-indent
    # comment block and only when its callee names this call.
    block = _preceding_comment_block(comments, lines, statement_line, statement_col)
    for row, col, value in block:
        if value.startswith('@atlas-edge '):
            spec = value[len('@atlas-edge '):]
            hook_callee, _, description = spec.partition(':')
            if hook_callee.strip() in (callee, target_name) and description.strip():
                chosen = ('explicit', description.strip(), row, row)
                break
    if chosen is None:
        for row, col, value in comments:
            if row == statement_end_line and row < len(lines) + 1 and col <= len(lines[row - 1]) and lines[row - 1][:col].strip():
                chosen = ('inline', value, row, row)
                break
    if chosen is None:
        usable = [(row, col, value) for row, col, value in block if not value.startswith('@atlas-edge ')]
        if usable:
            chosen = ('preceding', '\n'.join(value for _, _, value in usable), usable[0][0], usable[-1][0])
    if chosen is None and target.get('doc'):
        paragraph = target['doc'].strip().split('\n\n', 1)[0].strip()
        if paragraph:
            chosen = ('docstring', paragraph, target.get('docLine', target.get('line', 1)), target.get('docEndLine', target.get('docLine', target.get('line', 1))))
    if chosen is None:
        return []
    kind, value, row, end_row = chosen
    return [{'kind': kind, 'text': value, 'path': path if kind != 'docstring' else target.get('path', path),
             'line': row, 'endLine': end_row, 'callLine': call_line}]


def _separator_comment(value):
    compact = value.replace(' ', '').replace('\t', '')
    return bool(compact) and bool(re.fullmatch(r'[-=*_~+#]+', compact))


def _preceding_comment_block(comments, lines, statement_line, statement_col):
    by_row = {row: (row, col, value) for row, col, value in comments}
    result = []
    row = statement_line - 1
    while row >= 1:
        item = by_row.get(row)
        if item is None:
            break
        _, col, value = item
        if col != statement_col or lines[row - 1][:col].strip():
            break
        result.append(item)
        row -= 1
    return list(reversed(result))

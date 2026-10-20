"""Assemble a repository graph from validated files and language parsers."""
from pathlib import PurePosixPath

from .collection import accepted
from .config import LANGUAGES, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES
from .javascript_parser import parse_javascript
from .projects import _project_id, _is_test_path, _project_list
from .python_parser import parse_python
from .relations import build_relations


def analyze(name, files, warnings=None, project_roots=None):
    """Build the graph API response shared by uploads and local directories."""
    warnings = list(warnings or [])
    sources, total = {}, 0
    for item in files:
        path = str(item['path']).replace('\\', '/')
        if path.startswith('/') or '..' in PurePosixPath(path).parts or ':' in path:
            raise ValueError('ファイルの相対パスが不正です。')
        if not accepted(path):
            continue
        content = item['content']
        if not isinstance(content, str):
            raise ValueError('ファイル内容はテキストで指定してください。')
        size = len(content.encode('utf-8'))
        if size > MAX_FILE_BYTES or total + size > MAX_TOTAL_BYTES or len(sources) >= MAX_FILES:
            warnings.append(f'{path}: 解析上限によりスキップしました。')
            continue
        if path not in sources:
            sources[path] = content
            total += size
    if not sources:
        raise ValueError('解析対象がありません。Python / JavaScript / TypeScript のファイルがあるフォルダを選んでください。')

    nodes = [{'id': 'root', 'name': name or 'Repository', 'kind': 'repository', 'parent': None, 'path': '', 'doc': 'リポジトリ全体の構造です。フォルダやファイルを開いて、少しずつ詳しく見ていきましょう。'}]
    folders = set()
    parsed = {}
    js_files = []
    for path, content in sorted(sources.items()):
        parts = PurePosixPath(path).parts
        for i in range(1, len(parts)):
            folder = '/'.join(parts[:i])
            if folder not in folders:
                folders.add(folder)
                nodes.append({'id': 'dir:' + folder, 'name': parts[i - 1], 'kind': 'folder', 'path': folder,
                              'parent': 'dir:' + '/'.join(parts[:i - 1]) if i > 1 else 'root'})
        language = LANGUAGES[PurePosixPath(path).suffix.lower()]
        nodes.append({'id': 'file:' + path, 'name': parts[-1], 'kind': 'file', 'path': path, 'language': language,
                      'projectId': _project_id(path), 'isTest': _is_test_path(path),
                      'parent': 'dir:' + '/'.join(parts[:-1]) if len(parts) > 1 else 'root', 'line': 1,
                      'endLine': max(1, len(content.splitlines())), 'doc': ''})
        if language == 'Python':
            try:
                parsed[path] = parse_python(path, content)
            except (SyntaxError, ValueError, RecursionError) as exc:
                warnings.append(f'{path}: 構文を解析できません ({exc})。ファイルのみ表示します。')
        else:
            js_files.append({'path': path, 'content': content})
    if js_files:
        javascript_results, javascript_warnings = parse_javascript(js_files)
        parsed.update(javascript_results)
        warnings.extend(javascript_warnings)

    for path, result in parsed.items():
        for symbol in result['symbols']:
            symbol['projectId'] = _project_id(path)
            symbol['isTest'] = _is_test_path(path)
        nodes.extend(result['symbols'])
        next(n for n in nodes if n['id'] == 'file:' + path)['doc'] = result.get('doc', '')
    edges, unresolved, children = build_relations(nodes, parsed, sources)

    for n in nodes:
        n.setdefault('projectId', _project_id(n.get('path', '')) if n.get('path') else '@shared')
        n.setdefault('isTest', _is_test_path(n.get('path', '')) if n.get('path') else False)
        n['childCount'] = len(children.get(n['id'], []))
        n['lines'] = n.get('endLine', 0) - n.get('line', 1) + 1
    projects = _project_list(sources, project_roots)
    for project in projects:
        project['symbols'] = sum(1 for n in nodes if n.get('projectId') == project['id'] and n['kind'] in ('class', 'function', 'method', 'interface', 'type'))
    versions = [p['id'] for p in projects if p['id'] != '@shared' and p['files'] and p['id'][1:].isdigit()]
    default_project = max(versions, key=lambda value: int(value[1:])) if versions else '@shared'
    return {'name': name, 'nodes': nodes, 'edges': edges, 'sources': sources,
            'warnings': warnings, 'unresolved': unresolved,
            'projects': projects, 'defaultProject': default_project,
            'stats': {'files': len(sources), 'classes': sum(n['kind'] == 'class' for n in nodes),
                      'functions': sum(n['kind'] in ('function', 'method') for n in nodes),
                      'lines': sum(len(s.splitlines()) for s in sources.values()),
                      'relations': sum(e['kind'] != 'contains' for e in edges),
                      'languages': sorted(set(LANGUAGES[PurePosixPath(p).suffix.lower()] for p in sources))}}

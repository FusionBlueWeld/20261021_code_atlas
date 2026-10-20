"""Version-directory and test-file metadata shared by nodes and summaries."""
from pathlib import PurePosixPath


def _project_id(path):
    first = PurePosixPath(path).parts[0] if PurePosixPath(path).parts else ''
    return first if len(first) > 1 and first[0] == 'v' and first[1:].isdigit() else '@shared'


def _is_test_path(path):
    p = PurePosixPath(path)
    return any(part in ('test', 'tests') for part in p.parts) or p.name.startswith('test_') or p.name.endswith(('_test.py', '.test.js', '.test.ts', '.spec.js', '.spec.ts'))


def _project_list(sources, project_roots=None):
    ids = {_project_id(path) for path in sources}
    ids.add('@shared')
    for item in project_roots or []:
        ids.add(item.get('id') if isinstance(item, dict) else str(item))
    ids.discard('')
    ordered = sorted((i for i in ids if i != '@shared'), key=lambda i: (not i[1:].isdigit(), i))
    ordered.append('@shared')
    projects = []
    for project_id in ordered:
        supplied = next((p for p in (project_roots or []) if isinstance(p, dict) and p.get('id') == project_id), {})
        project_files = [p for p in sources if _project_id(p) == project_id]
        projects.append({'id': project_id, 'name': supplied.get('name', '共通' if project_id == '@shared' else project_id),
                         'root': supplied.get('root', '' if project_id == '@shared' else project_id),
                         'files': len(project_files), 'symbols': 0,
                         'testFiles': len([p for p in project_files if _is_test_path(p)])})
    return projects

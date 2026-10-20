"""Resolve imports, calls, and inheritance against parsed repository symbols."""
import os
from pathlib import PurePosixPath

from .evidence import _edge_evidence
from .projects import _project_id


def build_relations(nodes, parsed, sources):
    """Return relationships, unresolved references, and the containment index."""
    by_id = {n['id']: n for n in nodes}
    children = {}
    for n in nodes:
        children.setdefault(n.get('parent'), []).append(n)
    edges = [{'source': n['parent'], 'target': n['id'], 'kind': 'contains'} for n in nodes if n.get('parent')]
    unique_edges = set()
    evidence_cache = {}
    unresolved = []

    def edge(source, target, kind, line=0, evidence=None, evaluation_context=None):
        key = (source, target, kind)
        if source not in by_id or target not in by_id:
            return
        if key not in unique_edges:
            unique_edges.add(key)
            item = {'source': source, 'target': target, 'kind': kind, 'line': line, 'confidence': 'static',
                    'evidence': list(evidence or []), 'occurrences': 1}
            if evaluation_context:
                item['evaluationContexts'] = [evaluation_context]
            edges.append(item)
        else:
            existing = next(e for e in edges if e['source'] == source and e['target'] == target and e['kind'] == kind)
            existing['occurrences'] = existing.get('occurrences', 1) + 1
            for item in evidence or []:
                if item not in existing['evidence'] and len(existing['evidence']) < 20:
                    existing['evidence'].append(item)
            if evaluation_context and evaluation_context not in existing.setdefault('evaluationContexts', []):
                existing['evaluationContexts'].append(evaluation_context)

    def module_path(path, module):
        if path.endswith('.py'):
            if module.startswith('.'):
                dots = len(module) - len(module.lstrip('.'))
                parent = list(PurePosixPath(path).parent.parts)
                if dots > 1:
                    parent = parent[:max(0, len(parent) - dots + 1)]
                base = '/'.join(parent + module.lstrip('.').split('.')).strip('/')
            else:
                base = module.replace('.', '/')
            project_prefix = _project_id(path)
            scoped = [project_prefix + '/' + base] if project_prefix != '@shared' and not module.startswith('.') else []
            candidates = ([base + '.py', base + '/__init__.py'] if module.startswith('.') else
                          [x + suffix for x in scoped for suffix in ('.py', '/__init__.py')])
            if project_prefix == '@shared' and not module.startswith('.'):
                candidates += [base + '.py', base + '/__init__.py', 'src/' + base + '.py', 'src/' + base + '/__init__.py']
        else:
            if not module.startswith('.'):
                return None
            base = os.path.normpath(str(PurePosixPath(path).parent / module)).replace('\\', '/')
            candidates = [base] + [base + ext for ext in ('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs')] + [base + '/index' + ext for ext in ('.ts', '.tsx', '.js', '.jsx')]
            if base.endswith(('.js', '.mjs', '.cjs')):
                candidates.extend([base.rsplit('.', 1)[0] + '.ts', base.rsplit('.', 1)[0] + '.tsx'])
        return next((c for c in candidates if c in sources), None)

    def exported_symbol(path, name, seen=None):
        """Follow module-scope explicit from-import re-exports with a cycle guard."""
        seen = set(seen or ())
        if path in seen:
            return None
        seen.add(path)
        direct = [s for s in children.get('file:' + path, []) if s['name'] == name]
        if len(direct) == 1:
            return direct[0]['id']
        file_id = 'file:' + path
        for imp in parsed.get(path, {}).get('imports', []):
            if imp.get('scope') != file_id or imp['alias'] != name:
                continue
            target_path = module_path(path, imp['module'])
            if target_path:
                found = exported_symbol(target_path, imp['name'], seen)
                if found:
                    return found
        return None

    for path, result in parsed.items():
        bindings = {}
        for imp in result['imports']:
            target_path = module_path(path, imp['module'])
            submodule = None
            if path.endswith('.py') and imp['name'] != '*':
                submodule = module_path(path, imp['module'] + ('' if imp['module'] == '.' or imp['module'].endswith('.') else '.') + imp['name'])
            if target_path and submodule and not any(s['name'] == imp['name'] for s in children.get('file:' + target_path, [])):
                target_path = submodule
            if not target_path and path.endswith('.py') and imp['name'] != '*':
                target_path = module_path(path, imp['module'] + ('' if imp['module'] == '.' or imp['module'].endswith('.') else '.') + imp['name'])
            if target_path:
                target_id = 'file:' + target_path
                edge('file:' + path, target_id, 'imports', imp['line'], _edge_evidence(path, imp['line'], imp['line'], by_id[target_id], sources, cache=evidence_cache))
                target_symbols = [s for s in children.get(target_id, []) if s['name'] == imp['name'] or (imp['name'] == 'default' and s.get('exportDefault'))]
                if len(target_symbols) == 1:
                    binding = target_symbols[0]['id']
                elif path.endswith('.py') and imp['name'] != '*':
                    binding = exported_symbol(target_path, imp['name'])
                    if not binding and PurePosixPath(target_path).stem == imp['name']:
                        binding = target_id
                elif imp['name'] in ('*', 'default') or PurePosixPath(target_path).stem == imp['name']:
                    binding = target_id
                else:
                    binding = None
                if binding:
                    key = (imp.get('scope', 'file:' + path), imp['alias'])
                    qualifier = tuple(imp.get('qualifier', ()))
                    if qualifier:
                        # Sibling imports such as pkg.a and pkg.b share the pkg
                        # binding while retaining their own qualified targets.
                        qualified = bindings.setdefault(key, {})
                        qualified.pop((), None)
                        qualified[qualifier] = binding
                    else:
                        # Explicit aliases and from-imports replace the name.
                        bindings[key] = {(): binding}
            else:
                unresolved.append({'path': path, 'name': imp['module'], 'kind': 'import', 'line': imp['line']})

        def resolve(name, source, class_id=None):
            parts = name.split('.')
            scope = source
            consumed = 1
            if parts[0] in ('self', 'cls', 'this') and class_id:
                target = class_id
                parts = parts[1:]
            else:
                target = None
                while scope:
                    if parts[0] in result.get('shadows', {}).get(scope, []):
                        return None
                    if by_id.get(scope, {}).get('kind') == 'class' and scope != source:
                        scope = by_id.get(scope, {}).get('parent')
                        continue
                    found = [c for c in children.get(scope, []) if c['name'] == parts[0]]
                    if len(found) == 1:
                        target = found[0]['id']
                        break
                    if (scope, parts[0]) in bindings:
                        matches = [(qualifier, binding) for qualifier, binding in bindings[(scope, parts[0])].items()
                                   if parts[1:1 + len(qualifier)] == list(qualifier)]
                        if not matches:
                            return None
                        qualifier, target = max(matches, key=lambda item: len(item[0]))
                        consumed += len(qualifier)
                        break
                    scope = by_id.get(scope, {}).get('parent')
                parts = parts[consumed:]
            for part in parts:
                found = [c for c in children.get(target, []) if c['name'] == part] if target else []
                target = found[0]['id'] if len(found) == 1 else None
            return target

        for call in result['calls']:
            target = resolve(call['name'], call['source'], call.get('classId'))
            if target and by_id[target]['kind'] in ('function', 'method', 'class'):
                edge(call['source'], target, 'calls', call['line'], _edge_evidence(
                    path, call['line'], call.get('endLine', call['line']), by_id[target], sources,
                    call['line'], evidence_cache, call.get('callee'), call.get('statementLine'),
                    call.get('statementEndLine'), call.get('statementCol')),
                    call.get('evaluationContext', 'runtime'))
            else:
                unresolved.append({'path': path, 'name': call['name'], 'kind': 'call', 'line': call['line']})
        for symbol in result['symbols']:
            for base in symbol.get('bases', []):
                target = resolve(base, symbol['parent'])
                if target:
                    edge(symbol['id'], target, 'inherits', symbol['line'], _edge_evidence(
                        path, symbol['line'], symbol.get('headerEndLine', symbol['line']), by_id[target], sources,
                        symbol['line'], evidence_cache, base, symbol['line'], symbol.get('headerEndLine', symbol['line']),
                        0))

    return edges, unresolved, children

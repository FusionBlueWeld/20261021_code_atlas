"""Extract Python symbols, imports, calls, and lexical shadowing from syntax."""
from __future__ import annotations

import ast


def text(node):
    return ast.unparse(node) if node is not None else ''


def parse_python(path, content):
    """Parse one source file without importing or evaluating its contents."""
    tree = ast.parse(content, filename=path)
    symbols, imports, calls, shadows = [], [], [], {}
    file_id = 'file:' + path

    class Visitor(ast.NodeVisitor):
        def __init__(self):
            self.parent = file_id
            self.class_id = None
            self.statement = None
            self.evaluation_context = 'runtime'

        def visit(self, node):
            previous = self.statement
            if isinstance(node, ast.stmt):
                self.statement = node
            try:
                return super().visit(node)
            finally:
                self.statement = previous

        def definition(self, node, kind):
            previous, previous_class = self.parent, self.class_id
            identifier = f'{path}:{node.lineno}:{node.col_offset}:{node.name}'
            params = []
            if kind != 'class':
                positional = node.args.posonlyargs + node.args.args
                defaults = [None] * (len(positional) - len(node.args.defaults)) + node.args.defaults
                args = [(a, d, 'positional-only' if i < len(node.args.posonlyargs) else 'positional') for i, (a, d) in enumerate(zip(positional, defaults))]
                if node.args.vararg:
                    args.append((node.args.vararg, None, 'variadic'))
                args.extend((a, d, 'keyword-only') for a, d in zip(node.args.kwonlyargs, node.args.kw_defaults))
                if node.args.kwarg:
                    args.append((node.args.kwarg, None, 'keyword-variadic'))
                for a, default, mode in args:
                    params.append({'name': a.arg, 'type': text(a.annotation), 'default': text(default), 'mode': mode})
            returns = text(getattr(node, 'returns', None))
            signature = ('async ' if isinstance(node, ast.AsyncFunctionDef) else '') + node.name
            signature += '(' + (', '.join(text(b) for b in node.bases) if kind == 'class' else text(node.args)) + ')'
            if returns:
                signature += ' → ' + returns
            symbol = {'id': identifier, 'name': node.name, 'kind': kind, 'parent': previous, 'path': path,
                      'line': node.lineno, 'endLine': node.end_lineno, 'signature': signature,
                      'doc': ast.get_docstring(node) or '', 'params': params, 'returnType': returns,
                      'bases': [text(b) for b in getattr(node, 'bases', [])],
                      'decorators': [text(d) for d in node.decorator_list], 'classId': previous_class}
            if node.body and isinstance(node.body[0], ast.Expr) and isinstance(getattr(node.body[0], 'value', None), ast.Constant) and isinstance(node.body[0].value.value, str):
                symbol['docLine'] = node.body[0].lineno
                symbol['docEndLine'] = getattr(node.body[0], 'end_lineno', node.body[0].lineno)
            if kind == 'class':
                symbol['headerEndLine'] = max(node.lineno, node.body[0].lineno - 1) if node.body else node.lineno
            symbols.append(symbol)
            shadows[identifier] = {p['name'] for p in params}

            # Decorators, defaults, class bases, and class keywords are evaluated
            # in the enclosing scope while the definition is created. They must
            # not be attributed to the function or class body.
            previous_context = self.evaluation_context
            self.evaluation_context = 'definition'
            header_expressions = list(node.decorator_list)
            if kind == 'class':
                header_expressions.extend(node.bases)
                header_expressions.extend(keyword.value for keyword in node.keywords)
            else:
                header_expressions.extend(node.args.defaults)
                header_expressions.extend(default for default in node.args.kw_defaults if default is not None)
            for expression in header_expressions:
                self.visit(expression)
            self.evaluation_context = previous_context

            self.parent = identifier
            if kind == 'class':
                self.class_id = identifier
            for statement in node.body:
                self.visit(statement)
            self.parent, self.class_id = previous, previous_class

        def visit_ClassDef(self, node):
            self.definition(node, 'class')

        def visit_FunctionDef(self, node):
            direct_class = next((s for s in symbols if s['id'] == self.parent and s['kind'] == 'class'), None)
            self.definition(node, 'method' if direct_class else 'function')

        visit_AsyncFunctionDef = visit_FunctionDef

        def visit_Name(self, node):
            if isinstance(node.ctx, (ast.Store, ast.Del)):
                shadows.setdefault(self.parent, set()).add(node.id)

        def visit_Import(self, node):
            for item in node.names:
                module_parts = item.name.split('.')
                imports.append({'module': item.name, 'name': '*',
                                'alias': item.asname or module_parts[0],
                                'qualifier': [] if item.asname else module_parts[1:],
                                'line': node.lineno, 'scope': self.parent})

        def visit_ImportFrom(self, node):
            for item in node.names:
                imports.append({'module': '.' * node.level + (node.module or ''), 'name': item.name,
                                'alias': item.asname or item.name, 'line': node.lineno, 'scope': self.parent})

        def visit_Call(self, node):
            calls.append({'source': self.parent, 'name': text(node.func), 'line': node.lineno,
                          'endLine': getattr(node, 'end_lineno', node.lineno), 'classId': self.class_id,
                          'evaluationContext': self.evaluation_context,
                          'callee': text(node.func),
                          'statementLine': getattr(self.statement, 'lineno', node.lineno),
                          'statementEndLine': getattr(self.statement, 'end_lineno', node.end_lineno),
                          'statementCol': getattr(self.statement, 'col_offset', 0)})
            self.generic_visit(node)

    Visitor().visit(tree)
    return {'symbols': symbols, 'imports': imports, 'calls': calls, 'doc': ast.get_docstring(tree) or '',
            'shadows': {k: sorted(v) for k, v in shadows.items()}}

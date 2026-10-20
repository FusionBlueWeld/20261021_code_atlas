import unittest

from analyzer import analyze


def result(*files):
    return analyze('evidence', [{'path': path, 'content': content} for path, content in files])


def call_edge(data, target='wanted'):
    node = next(node for node in data['nodes'] if node['name'] == target)
    return next(edge for edge in data['edges'] if edge['kind'] == 'calls' and edge['target'] == node['id'])


class EvidenceTests(unittest.TestCase):
    def test_explicit_hook_applies_only_to_next_matching_statement(self):
        data = result(('main.py', '''\
def wanted():
    pass
def other():
    pass
def caller():
    # @atlas-edge wanted: use the wanted call
    wanted()
    # @atlas-edge wanted: must not cross to another callee
    other()
'''))
        self.assertEqual(call_edge(data)['evidence'][0]['text'], 'use the wanted call')
        other = next(node for node in data['nodes'] if node['name'] == 'other')
        other_edge = next(edge for edge in data['edges'] if edge['kind'] == 'calls' and edge['target'] == other['id'])
        self.assertEqual(other_edge['evidence'], [])

    def test_alias_and_qualified_callee_can_match_explicit_hook(self):
        data = result(
            ('lib.py', 'def wanted():\n    pass\n'),
            ('main.py', '''\
from lib import wanted as alias
def caller():
    # @atlas-edge alias: alias call
    alias()
'''))
        self.assertEqual(call_edge(data)['evidence'][0]['text'], 'alias call')

    def test_multiline_call_uses_comment_on_statement_final_line(self):
        data = result(('main.py', '''\
def wanted(value):
    pass
def caller():
    return wanted(
        1,
    )  # final line
'''))
        evidence = call_edge(data)['evidence'][0]
        self.assertEqual(evidence['kind'], 'inline')
        self.assertEqual(evidence['line'], 6)
        self.assertEqual(evidence['callLine'], 4)

    def test_hash_inside_string_is_not_a_comment(self):
        data = result(('main.py', '''\
def wanted():
    pass
def caller():
    url = "https://example.test/#fragment"
    wanted()
'''))
        self.assertEqual(call_edge(data)['evidence'], [])

    def test_preceding_comments_require_same_indent_and_contiguous_lines(self):
        data = result(('main.py', '''\
# leaked comment
def wanted():
    pass
def caller():
    # first line
    # second line
    wanted()
'''))
        evidence = call_edge(data)['evidence'][0]
        self.assertEqual(evidence['kind'], 'preceding')
        self.assertEqual(evidence['text'], 'first line\nsecond line')
        self.assertEqual((evidence['line'], evidence['endLine']), (5, 6))

    def test_docstring_evidence_preserves_multiline_span(self):
        data = result(('main.py', '''\
def wanted():
    """First paragraph.

    Second paragraph.
    """
def caller():
    wanted()
'''))
        evidence = call_edge(data)['evidence'][0]
        self.assertEqual(evidence['kind'], 'docstring')
        self.assertEqual(evidence['text'], 'First paragraph.')
        self.assertEqual((evidence['line'], evidence['endLine']), (2, 5))

    def test_multiple_callsites_on_one_edge_keep_each_evidence(self):
        data = result(('main.py', '''\
def wanted():
    pass
def caller():
    # first
    wanted()
    # second
    wanted()
'''))
        evidence = call_edge(data)['evidence']
        self.assertEqual([item['text'] for item in evidence], ['first', 'second'])
        self.assertEqual([item['callLine'] for item in evidence], [5, 7])

    def test_javascript_url_is_not_inferred_as_comment(self):
        data = result(
            ('lib.js', 'export function wanted() {}\n'),
            ('main.js', 'import { wanted } from "./lib.js";\nexport function caller() { const url = "https://example.test/x"; return wanted(); }\n'))
        self.assertEqual(call_edge(data)['evidence'], [])


if __name__ == '__main__':
    unittest.main()

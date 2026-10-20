import unittest

from analyzer import analyze


class VersionProjectTests(unittest.TestCase):
    def test_same_module_names_are_isolated_by_version(self):
        data = analyze('versions', [
            {'path': 'v002/src/mod.py', 'content': 'def run(): pass\n'},
            {'path': 'v002/src/caller.py', 'content': 'from src.mod import run\ndef call():\n    run()\n'},
            {'path': 'v003/src/mod.py', 'content': 'def run(): pass\n'},
            {'path': 'v003/src/caller.py', 'content': 'from src.mod import run\ndef call():\n    run()\n'},
        ])
        calls = [edge for edge in data['edges'] if edge['kind'] == 'calls']
        self.assertEqual(len(calls), 2)
        nodes = {node['id']: node for node in data['nodes']}
        self.assertTrue(all(nodes[edge['source']]['projectId'] == nodes[edge['target']]['projectId'] for edge in calls))

    def test_empty_version_is_kept_and_latest_nonempty_is_default(self):
        data = analyze('versions', [{'path': 'v003/app.py', 'content': 'def main(): pass\n'}],
                       project_roots=[{'id': 'v000', 'name': 'v000', 'root': 'v000'},
                                      {'id': 'v003', 'name': 'v003', 'root': 'v003'},
                                      {'id': 'v004', 'name': 'v004', 'root': 'v004'}])
        projects = {project['id']: project for project in data['projects']}
        self.assertEqual(projects['v004']['files'], 0)
        self.assertEqual(projects['v003']['files'], 1)
        self.assertEqual(data['defaultProject'], 'v003')
        self.assertIn('@shared', projects)

    def test_aliased_reexport_resolves_and_cycle_is_guarded(self):
        data = analyze('reexports', [
            {'path': 'v003/src/__init__.py', 'content': 'from .impl import run as public_run\nfrom .cycle_a import a\n'},
            {'path': 'v003/src/impl.py', 'content': 'def run(): pass\n'},
            {'path': 'v003/src/cycle_a.py', 'content': 'from .cycle_b import missing\ndef a(): pass\n'},
            {'path': 'v003/src/cycle_b.py', 'content': 'from .cycle_a import missing\ndef b(): pass\n'},
            {'path': 'v003/src/use.py', 'content': 'from src import public_run\ndef use():\n    public_run()\n'},
            {'path': 'v003/src/consumer.py', 'content': 'from src.cycle_a import missing\ndef consumer():\n    missing()\n'},
        ])
        calls = [edge for edge in data['edges'] if edge['kind'] == 'calls']
        self.assertTrue(any('impl.py' in edge['target'] for edge in calls))
        self.assertFalse(any(edge['source'].startswith('v003/src/consumer.py:') for edge in calls))
        self.assertTrue(any(item['name'] == 'missing' and item['kind'] in ('import', 'call') for item in data['unresolved']))
        self.assertLess(len(data['unresolved']), 20)

    def test_function_local_import_is_not_treated_as_module_reexport(self):
        data = analyze('local', [
            {'path': 'v003/src/__init__.py', 'content': ''},
            {'path': 'v003/src/use.py', 'content': 'def use():\n    from .impl import run\n    run()\n'},
            {'path': 'v003/src/impl.py', 'content': 'def run(): pass\n'},
            {'path': 'v003/src/consumer.py', 'content': 'from src.use import run\ndef consumer():\n    run()\n'},
        ])
        imports = [edge for edge in data['edges'] if edge['kind'] == 'imports']
        self.assertTrue(imports)
        self.assertFalse(any(edge['source'] == 'file:v003/src/__init__.py' and edge['target'].endswith('impl.py') for edge in imports))
        self.assertFalse(any(edge['source'].startswith('v003/src/consumer.py:') and edge['target'].endswith('impl.py')
                             for edge in data['edges'] if edge['kind'] == 'calls'))


if __name__ == '__main__':
    unittest.main()

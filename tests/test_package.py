"""Regression checks for the public facade and bundled parser location."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import analyzer
import code_atlas


class PackageTests(unittest.TestCase):
    def test_existing_analyzer_entry_points_match_package_api(self):
        self.assertIs(analyzer.analyze, code_atlas.analyze)
        self.assertIs(analyzer.collect_directory, code_atlas.collect_directory)
        self.assertIs(analyzer.discover_project_roots, code_atlas.discover_project_roots)
        self.assertTrue((analyzer.BASE / 'js_parser.cjs').is_file())

    def test_bundled_javascript_parser_works_from_another_working_directory(self):
        repository = str(Path(__file__).resolve().parents[1])
        environment = dict(os.environ, PYTHONPATH=repository)
        command = (
            'import json; from analyzer import analyze; '
            'print(json.dumps(analyze("external", '
            '[{"path": "lib.ts", "content": "export function work() {}"}, '
            '{"path": "main.ts", "content": '
            '"import {work} from \'./lib.js\'; export function run() { work(); }"}])))'
        )
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, '-c', command], cwd=directory,
                                    env=environment, text=True, encoding='utf-8',
                                    capture_output=True, check=True, timeout=20)
        data = json.loads(result.stdout)
        self.assertEqual(data['warnings'], [])
        self.assertTrue(any(edge['kind'] == 'calls' for edge in data['edges']))

    def test_missing_node_keeps_source_file_and_adds_warning(self):
        with patch('code_atlas.javascript_parser.shutil.which', return_value=None):
            data = analyzer.analyze('missing-node', [{'path': 'main.js', 'content': 'function run() {}'}])
        self.assertEqual(data['stats']['files'], 1)
        self.assertEqual(data['sources']['main.js'], 'function run() {}')
        self.assertIn('file:main.js', {node['id'] for node in data['nodes']})
        self.assertTrue(any('Node.js' in warning for warning in data['warnings']))


if __name__ == '__main__':
    unittest.main()

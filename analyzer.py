"""Compatibility entry point for Code Atlas's read-only repository analyzer.

Implementation modules live in code_atlas; existing imports from analyzer
continue to work. Repository code is never imported or executed.
"""
from code_atlas import analyze, collect_directory, discover_project_roots
from code_atlas.collection import accepted
from code_atlas.config import BASE, IGNORED, LANGUAGES, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES
from code_atlas.evidence import _edge_evidence, _preceding_comment_block, _separator_comment
from code_atlas.projects import _project_id, _is_test_path, _project_list
from code_atlas.python_parser import parse_python, text

__all__ = ['analyze', 'collect_directory', 'discover_project_roots', 'accepted', 'parse_python']

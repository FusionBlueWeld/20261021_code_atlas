"""Shared source-analysis limits and bundled runtime paths."""
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
IGNORED = {'.git', '.hg', '.svn', 'node_modules', '__pycache__', '.venv', 'venv', 'env',
           'dist', 'build', '.next', '.nuxt', 'coverage', '.cache', 'vendor', '.idea', '.vscode'}
LANGUAGES = {'.py': 'Python', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript',
             '.cjs': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript'}
MAX_FILES = 1200
MAX_FILE_BYTES = 512 * 1024
MAX_TOTAL_BYTES = 16 * 1024 * 1024

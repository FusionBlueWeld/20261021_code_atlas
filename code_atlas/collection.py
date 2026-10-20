"""Collect and validate source text without importing repository modules."""
from __future__ import annotations

import io
import os
from pathlib import Path, PurePosixPath
import tokenize

from .config import IGNORED, LANGUAGES, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES


def accepted(path):
    """Accept supported source files outside hidden or generated directories."""
    parts = PurePosixPath(path).parts
    return bool(parts) and not any(p in IGNORED or p.startswith('.') for p in parts) and PurePosixPath(path).suffix.lower() in LANGUAGES


def collect_directory(value):
    """Read bounded source text, skipping symlinks and returning diagnostics."""
    root = Path(value).expanduser().resolve()
    if not root.is_dir():
        raise ValueError('フォルダが見つかりません。リポジトリのフォルダを指定してください。')
    files, warnings, total = [], [], 0
    for current, directories, names in os.walk(root, followlinks=False):
        directories[:] = sorted(d for d in directories if d not in IGNORED and not d.startswith('.') and not Path(current, d).is_symlink())
        for name in sorted(names):
            source = Path(current, name)
            relative = source.relative_to(root).as_posix()
            if not accepted(relative) or source.is_symlink():
                continue
            if len(files) >= MAX_FILES:
                warnings.append(f'ファイル数の上限 {MAX_FILES} 件に達しました。一部だけを表示しています。')
                return root.name, files, warnings
            try:
                size = source.stat().st_size
                if size > MAX_FILE_BYTES or total + size > MAX_TOTAL_BYTES:
                    warnings.append(f'{relative}: サイズ上限によりスキップしました。')
                    continue
                raw = source.read_bytes()
                if source.suffix.lower() == '.py':
                    encoding, _ = tokenize.detect_encoding(io.BytesIO(raw).readline)
                    content = raw.decode(encoding)
                else:
                    content = raw.decode('utf-8-sig')
                files.append({'path': relative, 'content': content})
                total += size
            except (OSError, UnicodeError, SyntaxError) as exc:
                warnings.append(f'{relative}: 読み込みできません ({exc})')
    return root.name, files, warnings


def discover_project_roots(value):
    """Return version directories for project metadata, including empty ones."""
    root = Path(value).expanduser().resolve()
    if not root.is_dir():
        return []
    return [{'id': child.name, 'name': child.name, 'root': child.name}
            for child in sorted(root.iterdir(), key=lambda p: p.name)
            if child.is_dir() and child.name.startswith('v') and child.name[1:].isdigit()]

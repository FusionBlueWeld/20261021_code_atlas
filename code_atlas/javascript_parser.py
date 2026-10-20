"""Bridge to the bundled JavaScript/TypeScript syntax parser."""
import json
import shutil
import subprocess

from .config import BASE


def parse_javascript(files):
    """Parse JS/TS files or report why the bundled parser is unavailable."""
    try:
        node = shutil.which('node')
        if not node:
            raise RuntimeError('Node.js が見つかりません')
        result = subprocess.run([node, str(BASE / 'js_parser.cjs')], input=json.dumps(files),
                                capture_output=True, text=True, encoding='utf-8', timeout=60, cwd=BASE)
        if result.returncode:
            raise RuntimeError('TypeScript パーサーを使用できません。npm install を実行してください')
        response = json.loads(result.stdout)
        return response['files'], response.get('warnings', [])
    except (OSError, RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        return {}, [f'JS/TS: {exc}。対象ファイルの一覧とコードは表示できます。']

"""Code Atlas local HTTP server; Python 3.10+, standard library only."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
from urllib.parse import urlparse
import webbrowser

from analyzer import analyze, collect_directory, discover_project_roots

BASE = Path(__file__).resolve().parent
TOKEN = secrets.token_urlsafe(32)
MAX_REQUEST = 24 * 1024 * 1024


class LocalServer(ThreadingHTTPServer):
    # Windows must not let two app instances serve different tokens on one port.
    allow_reuse_address = False


class Handler(BaseHTTPRequestHandler):
    def send(self, status, data, content_type='application/json; charset=utf-8'):
        if isinstance(data, (dict, list)):
            data = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def valid_host(self):
        return self.headers.get('Host', '') in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')

    def do_GET(self):
        if not self.valid_host():
            return self.send(403, {'error': 'Invalid host'})
        path = urlparse(self.path).path
        if path == '/api/config':
            return self.send(200, {'token': TOKEN, 'workspace': str(BASE), 'version': '1.0.0'})
        if path == '/api/demo':
            name, files, warnings = collect_directory(BASE / 'demo_repository')
            return self.send(200, analyze('paperlane', files, warnings, discover_project_roots(BASE / 'demo_repository')))
        assets = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
                  '/graph-model.js': ('graph-model.js', 'text/javascript; charset=utf-8'),
                  '/style.css': ('style.css', 'text/css; charset=utf-8'), '/favicon.svg': ('favicon.svg', 'image/svg+xml')}
        # Serve only known source files from the feature directories. Never map
        # an arbitrary request path directly onto the filesystem.
        for folder, extension, mime in [('ui', 'js', 'text/javascript'), ('graph', 'js', 'text/javascript'), ('styles', 'css', 'text/css')]:
            for asset in (BASE / 'web' / folder).glob('*.' + extension):
                assets[f'/{folder}/{asset.name}'] = (f'{folder}/{asset.name}', mime + '; charset=utf-8')
        if path in assets:
            filename, mime = assets[path]
            return self.send(200, (BASE / 'web' / filename).read_bytes(), mime)
        return self.send(404, {'error': 'Not found'})

    def do_POST(self):
        if not self.valid_host() or self.headers.get('X-Atlas-Token') != TOKEN:
            return self.send(403, {'error': 'アプリを再読み込みしてください。'})
        if urlparse(self.path).path != '/api/analyze':
            return self.send(404, {'error': 'Not found'})
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length <= 0 or length > MAX_REQUEST:
                return self.send(413, {'error': '入力は24 MB以下にしてください。大きなリポジトリはローカルパスで開けます。'})
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('解析リクエストはオブジェクトで指定してください。')
            if payload.get('path'):
                root = payload['path']
                name, files, warnings = collect_directory(root)
                projects = discover_project_roots(root)
            else:
                name, files, warnings = payload.get('name', 'Repository'), payload.get('files', []), payload.get('warnings', [])
                projects = payload.get('projects', [])
                if not isinstance(warnings, list) or len(warnings) > 1200 or not all(isinstance(w, str) for w in warnings):
                    raise ValueError('解析メモの形式が不正です。')
                if not isinstance(name, str) or not isinstance(files, list) or not all(isinstance(item, dict) for item in files):
                    raise ValueError('名前とファイル一覧の形式が不正です。')
                if not isinstance(projects, list) or not all(isinstance(item, (str, dict)) for item in projects):
                    raise ValueError('プロジェクト一覧の形式が不正です。')
            self.send(200, analyze(name, files, warnings, projects))
        except (ValueError, OSError, KeyError, TypeError) as exc:
            self.send(400, {'error': str(exc)})
        except Exception:
            self.send(500, {'error': '解析中にエラーが発生しました。対象フォルダを小さくして再度お試しください。'})


def main():
    parser = argparse.ArgumentParser(description='Code Atlas — local repository explorer')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    try:
        server = LocalServer(('127.0.0.1', args.port), Handler)
    except OSError:
        parser.exit(1, f'Port {args.port} is unavailable. Open the running app or use --port with another port.\n')
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'Code Atlas: {url}', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()


if __name__ == '__main__':
    main()

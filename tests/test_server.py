import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from server import Handler


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def get_token(self):
        with urlopen(self.url + '/api/config') as response:
            return json.load(response)['token']

    def test_analysis_requires_app_token(self):
        request = Request(self.url + '/api/analyze', data=b'{}', method='POST')
        with self.assertRaises(HTTPError) as caught:
            urlopen(request)
        self.assertEqual(caught.exception.code, 403)

    def test_reject_foreign_host(self):
        request = Request(self.url + '/api/config', headers={'Host': 'untrusted.example'})
        with self.assertRaises(HTTPError) as caught:
            urlopen(request)
        self.assertEqual(caught.exception.code, 403)

    def test_upload_and_invalid_input(self):
        body = json.dumps({'name': 'hello', 'files': [{'path': 'hello.py', 'content': 'def greet(name: str): return name'}]}).encode()
        request = Request(self.url + '/api/analyze', data=body, headers={'X-Atlas-Token': self.get_token()}, method='POST')
        with urlopen(request) as response:
            result = json.load(response)
        self.assertEqual(result['stats']['functions'], 1)
        self.assertEqual(result['name'], 'hello')
        invalid = Request(self.url + '/api/analyze', data=b'{', headers={'X-Atlas-Token': self.get_token()}, method='POST')
        with self.assertRaises(HTTPError) as caught:
            urlopen(invalid)
        self.assertEqual(caught.exception.code, 400)

    def test_static_assets_and_traversal(self):
        with urlopen(self.url + '/') as response:
            self.assertIn(b'Code Atlas', response.read())
            self.assertIn("frame-ancestors 'none'", response.headers['Content-Security-Policy'])
        with self.assertRaises(HTTPError) as caught:
            urlopen(self.url + '/../../server.py')
        self.assertEqual(caught.exception.code, 404)

    def test_feature_assets_are_served_without_arbitrary_file_access(self):
        for path, content_type in [('/ui/panels.js', 'text/javascript'),
                                   ('/graph/layout.js', 'text/javascript'),
                                   ('/styles/graph.css', 'text/css')]:
            with self.subTest(path=path), urlopen(self.url + path) as response:
                self.assertIn(content_type, response.headers['Content-Type'])
                self.assertTrue(response.read())
        with self.assertRaises(HTTPError) as caught:
            urlopen(self.url + '/ui/../../server.py')
        self.assertEqual(caught.exception.code, 404)

    def test_non_object_request_is_a_client_error(self):
        for body in [b'[]', b'null', b'"hello"', b'{"files": [null]}',
                     b'{"name": {}, "files": []}', b'{"projects": 2}']:
            request = Request(self.url + '/api/analyze', data=body,
                              headers={'X-Atlas-Token': self.get_token()}, method='POST')
            with self.subTest(body=body), self.assertRaises(HTTPError) as caught:
                urlopen(request)
            self.assertEqual(caught.exception.code, 400)


if __name__ == '__main__':
    unittest.main()

"""Review probes: report current behavior without executing fixture code."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from analyzer import analyze

cases = {
    'B03_header_calls': [
        ('main.py', 'def factory(): pass\ndef deco(): pass\n@deco()\ndef run(value=factory()): pass\n'),
    ],
    'B04_dotted_import': [
        ('pkg/worker.py', 'def work(): pass\n'),
        ('main.py', 'import pkg.worker\ndef run():\n    pkg.worker.work()\n'),
    ],
}
for label, files in cases.items():
    data = analyze(label, [{'path': path, 'content': content} for path, content in files])
    print(json.dumps({'case': label,
                      'calls': [e for e in data['edges'] if e['kind'] == 'calls'],
                      'unresolved': data['unresolved']}, ensure_ascii=False))

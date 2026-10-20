"""Behavioral tests for the read-only repository analyzer."""

import unittest

from analyzer import analyze


def result(*files, name="demo", warnings=None):
    return analyze(name, [{"path": path, "content": content} for path, content in files], warnings)


class AnalyzerTests(unittest.TestCase):
    def test_function_signature_captures_async_nested_posonly_kwonly_defaults_and_annotations(self):
        data = result(("main.py", """\
async def outer(first: int, /, second: str = 'x', *items: float, flag: bool = True, **options: str) -> str:
    def nested(value: int = 1) -> int:
        return value
    return str(nested(first))
"""))
        functions = {node["name"]: node for node in data["nodes"] if node["kind"] == "function"}
        self.assertIn("outer", functions)
        outer = functions["outer"]
        self.assertTrue(outer["signature"].startswith("async outer("))
        self.assertEqual(outer["returnType"], "str")
        self.assertEqual([p["mode"] for p in outer["params"]],
                         ["positional-only", "positional", "variadic", "keyword-only", "keyword-variadic"])
        self.assertEqual(outer["params"][0]["type"], "int")
        self.assertEqual(outer["params"][1]["default"], "'x'")
        self.assertEqual(outer["params"][3]["default"], "True")
        self.assertEqual(functions["nested"]["parent"], outer["id"])

    def test_relative_import_and_imported_call_create_edges(self):
        data = result(
            ("pkg/__init__.py", ""),
            ("pkg/orders.py", "from .payments import charge\n\ndef submit() -> int:\n    return charge(10)\n"),
            ("pkg/payments.py", "def charge(amount: int) -> int:\n    return amount\n"),
        )
        edges = {(edge["source"], edge["target"], edge["kind"]) for edge in data["edges"]}
        self.assertIn(("file:pkg/orders.py", "file:pkg/payments.py", "imports"), edges)
        submit = next(node for node in data["nodes"] if node["name"] == "submit")
        charge = next(node for node in data["nodes"] if node["name"] == "charge")
        self.assertIn((submit["id"], charge["id"], "calls"), edges)

    def test_self_method_call_is_resolved(self):
        data = result(("cart.py", """\
class Cart:
    def total(self) -> int:
        return 1
    def checkout(self) -> int:
        return self.total()
"""))
        methods = {node["name"]: node for node in data["nodes"] if node["kind"] == "method"}
        calls = {(edge["source"], edge["target"], edge["kind"]) for edge in data["edges"]}
        self.assertIn((methods["checkout"]["id"], methods["total"]["id"], "calls"), calls)

    def test_ambiguous_name_is_reported_unresolved(self):
        data = result(("ambiguous.py", """\
def run() -> None:
    pass
def run() -> None:
    pass
def caller() -> None:
    run()
"""))
        self.assertTrue(any(item["kind"] == "call" and item["name"] == "run" for item in data["unresolved"]))

    def test_syntax_error_keeps_file_and_adds_warning(self):
        data = result(("broken.py", "def broken(:\n    pass\n"))
        self.assertIn("file:broken.py", {node["id"] for node in data["nodes"]})
        self.assertTrue(any("broken.py" in warning for warning in data["warnings"]))

    def test_ignored_directories_and_hidden_files_are_skipped(self):
        data = result(("src/good.py", "def good():\n    pass\n"), (".git/config.py", "def hidden():\n    pass\n"),
                      ("node_modules/pkg.js", "function hidden() {}\n"), ("src/__pycache__/cache.py", "x = 1\n"))
        self.assertEqual(data["stats"]["files"], 1)
        self.assertEqual(data["sources"], {"src/good.py": "def good():\n    pass\n"})

    def test_empty_input_is_rejected(self):
        with self.assertRaises(ValueError):
            analyze("empty", [])

    def test_parameter_or_assignment_does_not_resolve_to_global_function(self):
        data = result(("scope.py", "def run(): pass\ndef caller(run):\n    run()\ndef other():\n    run = lambda: 1\n    run()\n"))
        self.assertFalse(any(e["kind"] == "calls" for e in data["edges"]))

    def test_bare_method_name_is_not_a_python_class_scope_lookup(self):
        data = result(("scope.py", "class A:\n    def helper(self): pass\n    def run(self):\n        helper()\n        self.helper()\n"))
        calls = [e for e in data["edges"] if e["kind"] == "calls"]
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["line"], 5)
        self.assertTrue(any(u["name"] == "helper" for u in data["unresolved"]))

    def test_relative_submodule_import(self):
        data = result(("pkg/__init__.py", ""), ("pkg/worker.py", "from . import helper\ndef run():\n    helper.work()\n"),
                      ("pkg/helper.py", "def work(): pass\n"))
        self.assertTrue(any(e["kind"] == "imports" and e["target"] == "file:pkg/helper.py" for e in data["edges"]))
        self.assertTrue(any(e["kind"] == "calls" for e in data["edges"]))

    def test_definition_header_calls_belong_to_the_enclosing_scope(self):
        data = result(("main.py", """\
def factory(): pass
def decorate(): pass
@decorate()
def run(value=factory()): pass
"""))
        nodes = {node["name"]: node for node in data["nodes"] if node["kind"] == "function"}
        calls = [edge for edge in data["edges"] if edge["kind"] == "calls"]
        self.assertEqual(
            {(edge["source"], edge["target"]) for edge in calls},
            {("file:main.py", nodes["factory"]["id"]),
             ("file:main.py", nodes["decorate"]["id"])},
        )
        self.assertFalse(any(edge["source"] == nodes["run"]["id"] for edge in calls))
        self.assertTrue(all(edge["evaluationContexts"] == ["definition"] for edge in calls))

    def test_nested_definition_default_call_belongs_to_outer_function(self):
        data = result(("main.py", """\
def factory(): pass
def outer():
    def inner(value=factory()): pass
    return inner
"""))
        nodes = {node["name"]: node for node in data["nodes"] if node["kind"] == "function"}
        calls = {(edge["source"], edge["target"]) for edge in data["edges"] if edge["kind"] == "calls"}
        self.assertIn((nodes["outer"]["id"], nodes["factory"]["id"]), calls)
        self.assertNotIn((nodes["inner"]["id"], nodes["factory"]["id"]), calls)

    def test_dotted_import_resolves_qualified_call(self):
        data = result(
            ("pkg/worker.py", "def work(): pass\n"),
            ("main.py", "import pkg.worker\ndef run():\n    pkg.worker.work()\n"),
        )
        nodes = {node["name"]: node for node in data["nodes"] if node["kind"] == "function"}
        calls = {(edge["source"], edge["target"]) for edge in data["edges"] if edge["kind"] == "calls"}
        self.assertIn((nodes["run"]["id"], nodes["work"]["id"]), calls)
        self.assertFalse(any(item["name"] == "pkg.worker.work" for item in data["unresolved"]))

    def test_aliased_dotted_import_resolves_without_module_prefix(self):
        data = result(
            ("pkg/worker.py", "def work(): pass\n"),
            ("main.py", "import pkg.worker as worker\ndef run():\n    worker.work()\n"),
        )
        nodes = {node["name"]: node for node in data["nodes"] if node["kind"] == "function"}
        calls = {(edge["source"], edge["target"]) for edge in data["edges"] if edge["kind"] == "calls"}
        self.assertIn((nodes["run"]["id"], nodes["work"]["id"]), calls)

    def test_sibling_dotted_imports_resolve_both_module_calls(self):
        data = result(
            ("pkg/a.py", "def first(): pass\n"),
            ("pkg/b.py", "def second(): pass\n"),
            ("main.py", "import pkg.a\nimport pkg.b\ndef run():\n    pkg.a.first()\n    pkg.b.second()\n"),
        )
        nodes = {node["name"]: node for node in data["nodes"] if node["kind"] == "function"}
        calls = {(edge["source"], edge["target"]) for edge in data["edges"] if edge["kind"] == "calls"}
        self.assertEqual(calls, {(nodes["run"]["id"], nodes["first"]["id"]),
                                 (nodes["run"]["id"], nodes["second"]["id"])})
        self.assertFalse(any(item["kind"] == "call" for item in data["unresolved"]))

    def test_aliased_import_replaces_sibling_bindings_for_the_same_name(self):
        data = result(
            ("pkg/a.py", "def first(): pass\n"),
            ("pkg/b.py", "def second(): pass\n"),
            ("main.py", "import pkg.a\nimport pkg.b as pkg\ndef run():\n    pkg.a.first()\n    pkg.second()\n"),
        )
        nodes = {node["name"]: node for node in data["nodes"] if node["kind"] == "function"}
        calls = {(edge["source"], edge["target"]) for edge in data["edges"] if edge["kind"] == "calls"}
        self.assertEqual(calls, {(nodes["run"]["id"], nodes["second"]["id"])})
        self.assertTrue(any(item["name"] == "pkg.a.first" for item in data["unresolved"]))

    def test_parameter_and_assignment_shadow_all_sibling_module_bindings(self):
        data = result(
            ("pkg/a.py", "def first(): pass\n"),
            ("pkg/b.py", "def second(): pass\n"),
            ("main.py", "import pkg.a\nimport pkg.b\ndef parameter(pkg):\n    pkg.a.first()\ndef assignment():\n    pkg = object()\n    pkg.b.second()\n"),
        )
        self.assertFalse(any(edge["kind"] == "calls" for edge in data["edges"]))

    def test_multilevel_dotted_import_consumes_the_full_module_qualifier(self):
        data = result(
            ("company/pkg/worker.py", "def work(): pass\n"),
            ("main.py", "import company.pkg.worker\ndef run():\n    company.pkg.worker.work()\n"),
        )
        nodes = {node["name"]: node for node in data["nodes"] if node["kind"] == "function"}
        calls = {(edge["source"], edge["target"]) for edge in data["edges"] if edge["kind"] == "calls"}
        self.assertIn((nodes["run"]["id"], nodes["work"]["id"]), calls)

    def test_typescript_import_and_arrow_call_across_files(self):
        data = result(("lib.ts", "export const twice = (n: number): number => n * 2;"),
                      ("main.ts", "import { twice as double } from './lib.js';\nexport function run(value: number) { return double(value); }"))
        self.assertEqual(data['warnings'], [])
        self.assertTrue(any(e["kind"] == "calls" for e in data["edges"]))

    def test_javascript_parameter_shadowing_does_not_create_false_call(self):
        data = result(("scope.js", "function run() {}\nfunction invoke(run) { return run(); }"))
        self.assertFalse(any(e["kind"] == "calls" for e in data["edges"]))

    def test_unsafe_upload_path_is_rejected(self):
        with self.assertRaises(ValueError):
            result(("../secret.py", "x = 1\n"))
        with self.assertRaises(ValueError):
            result(("C:/secret.py", "x = 1\n"))

    def test_duplicate_filenames_in_different_directories_are_preserved(self):
        data = result(("one/main.py", "def first():\n    pass\n"), ("two/main.py", "def second():\n    pass\n"))
        self.assertEqual(set(data["sources"]), {"one/main.py", "two/main.py"})
        self.assertEqual(data["stats"]["files"], 2)
        self.assertEqual({node["path"] for node in data["nodes"] if node["kind"] == "file"},
                         {"one/main.py", "two/main.py"})

    def test_warnings_are_preserved_and_stats_are_returned(self):
        data = result(("main.py", "x = 1\n"), warnings=["caller warning"])
        self.assertIn("caller warning", data["warnings"])
        self.assertEqual(set(data), {"name", "nodes", "edges", "sources", "warnings", "unresolved", "stats", "projects", "defaultProject"})
        self.assertEqual(data["stats"]["files"], 1)


if __name__ == "__main__":
    unittest.main()

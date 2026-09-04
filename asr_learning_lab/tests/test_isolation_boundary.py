import ast
import unittest
from pathlib import Path


LAB_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = LAB_ROOT.parent
FORBIDDEN_IMPORT_ROOTS = {"server", "src", "shared", "tools"}


class IsolationBoundaryTests(unittest.TestCase):
    def test_lab_does_not_import_production_modules(self):
        violations = []
        for path in (LAB_ROOT / "src").glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                modules = []
                if isinstance(node, ast.Import):
                    modules = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                    modules = [node.module]
                for module in modules:
                    if module.split(".", 1)[0] in FORBIDDEN_IMPORT_ROOTS:
                        violations.append(f"{path.name}: {module}")
        self.assertEqual(violations, [], "lab imports production code: " + ", ".join(violations))

    def test_production_code_does_not_reference_lab(self):
        violations = []
        for folder in ("server", "src", "shared", "tools"):
            root = REPO_ROOT / folder
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if path.suffix.lower() not in {".py", ".ts", ".tsx", ".js", ".mjs", ".cjs"}:
                    continue
                try:
                    text = path.read_text(encoding="utf-8")
                except UnicodeDecodeError:
                    continue
                if "asr_learning_lab" in text:
                    violations.append(str(path.relative_to(REPO_ROOT)))
        self.assertEqual(violations, [], "production references the isolated lab: " + ", ".join(violations))


if __name__ == "__main__":
    unittest.main()

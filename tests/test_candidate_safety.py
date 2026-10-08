"""Offline tests: no acquisition, training, GitHub Actions, push, or deployment."""
import ast
import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch

import yaml  # Test-only dependency, PyYAML. No package installation during tests.

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("candidate_artifacts", ROOT / "training/candidate_artifacts.py")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
ENV = {"GITHUB_SHA": "a" * 40, "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1"}


class BundleSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for name in ("index.html", "predict.js", "vercel.json", "model/model.json", "model/model.previous.json", "model/production-manifest.json"):
            dest = self.root / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, dest)
        self.directory = self.root / "candidate-output/daily"
        self.env = patch.dict(os.environ, ENV)
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def write(self, name, data):
        (self.directory / name).write_text(json.dumps(data), encoding="utf-8")

    def prepare(self):
        guard.capture(self.root, self.directory, "daily")
        model = json.loads((self.root / "model/model.json").read_text())
        self.write("model.json", model)
        model["mode"] = "evaluation"
        self.write("eval-model.json", model)
        self.write("backtest-v93.json", {"version": "v9.3-continuous-purchase-score"})
        self.write("backtest.json", {"version": "v9.2-predict-all-buy-selective"})
        self.write("comparison-v93.json", {"v9.2": {}, "v9.3": {}})

    def seal(self):
        with contextlib.redirect_stdout(io.StringIO()):
            guard.seal(self.root, self.directory, "daily")

    def test_complete_bundle_never_allows_publication(self):
        self.prepare(); self.seal()
        result = guard.verify(self.directory, "daily")
        self.assertFalse(result["publicationAllowed"])
        self.assertTrue(result["requiresSeparateApproval"])
        self.assertEqual(result["requestedRetentionDays"], 14)

    def test_existing_manifest_mismatch_is_recorded_not_repaired(self):
        before = guard.serving_state(self.root)
        self.prepare(); self.seal()
        self.assertFalse(guard.verify(self.directory, "daily")["servingManifestMatchesModel"])
        self.assertEqual(before, guard.serving_state(self.root))

    def test_missing_output_stops(self):
        self.prepare(); (self.directory / "model.json").unlink()
        with self.assertRaisesRegex(ValueError, "missing"): self.seal()

    def test_unexpected_output_stops(self):
        self.prepare(); self.write("unknown.json", {})
        with self.assertRaisesRegex(ValueError, "Unknown output"): self.seal()

    def test_serving_mutation_stops_without_repair(self):
        self.prepare(); path = self.root / "model/model.json"; path.write_text("{}")
        with self.assertRaisesRegex(ValueError, "Serving files changed"): self.seal()
        self.assertEqual(path.read_text(), "{}")

    def test_new_serving_file_stops(self):
        self.prepare(); (self.root / "model/unknown.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "Serving files changed"): self.seal()

    def test_unknown_run_stops(self):
        with patch.dict(os.environ, {"GITHUB_SHA": "unknown"}):
            with self.assertRaisesRegex(ValueError, "source commit"): guard.capture(self.root, self.directory, "daily")

    def test_changed_attempt_stops(self):
        self.prepare()
        with patch.dict(os.environ, {"GITHUB_RUN_ATTEMPT": "2"}):
            with self.assertRaisesRegex(ValueError, "identity changed"): self.seal()

    def test_reused_directory_stops(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError, "reuse"): guard.capture(self.root, self.directory, "daily")

    def test_bad_model_dimensions_stop(self):
        self.prepare(); model = guard.read_json(self.directory / "model.json"); model["mean"].pop(); self.write("model.json", model)
        with self.assertRaisesRegex(ValueError, "dimensions"): self.seal()

    def test_duplicate_features_stop(self):
        self.prepare(); model = guard.read_json(self.directory / "model.json"); model["features"][1] = "lane1"; self.write("model.json", model)
        with self.assertRaisesRegex(ValueError, "Duplicate features"): self.seal()

    def test_unknown_schema_stops(self):
        self.prepare(); model = guard.read_json(self.directory / "model.json"); model["features"][0] = "new_feature"; self.write("model.json", model)
        with self.assertRaisesRegex(ValueError, "feature schema"): self.seal()

    def test_nonpositive_scale_stops(self):
        self.prepare(); model = guard.read_json(self.directory / "model.json"); model["scale"][0] = 0; self.write("model.json", model)
        with self.assertRaisesRegex(ValueError, "positive"): self.seal()

    def test_duplicate_json_keys_stop(self):
        self.prepare(); (self.directory / "comparison-v93.json").write_text('{"x":1,"x":2}')
        with self.assertRaisesRegex(ValueError, "Duplicate JSON"): self.seal()

    def test_nonfinite_json_stops(self):
        self.prepare(); (self.directory / "comparison-v93.json").write_text('{"x":NaN}')
        with self.assertRaisesRegex(ValueError, "Non-finite"): self.seal()

    def test_symlink_output_stops(self):
        self.prepare(); (self.directory / "model.json").unlink(); (self.directory / "model.json").symlink_to(self.root / "model/model.json")
        with self.assertRaisesRegex(ValueError, "symlinked"): self.seal()

    def test_tampered_artifact_stops(self):
        self.prepare(); self.seal(); (self.directory / "comparison-v93.json").write_text('{"v9.2":{},"v9.3":{},"changed":true}')
        with self.assertRaisesRegex(ValueError, "digest mismatch"): guard.verify(self.directory, "daily")

    def test_tampered_provenance_stops(self):
        self.prepare(); self.seal(); manifest = guard.read_json(self.directory / "bundle-manifest.json")
        manifest["sourceCommit"] = "b" * 40; self.write("bundle-manifest.json", manifest)
        with self.assertRaisesRegex(ValueError, "provenance mismatch"): guard.verify(self.directory, "daily")

    def test_removed_approval_requirement_stops(self):
        self.prepare(); self.seal(); manifest = guard.read_json(self.directory / "bundle-manifest.json")
        manifest["requiresSeparateApproval"] = False; self.write("bundle-manifest.json", manifest)
        with self.assertRaisesRegex(ValueError, "review-only"): guard.verify(self.directory, "daily")

    def test_all_other_bundle_kinds_are_review_only(self):
        fixtures = {
            "automl": {"automl-search.json": {"version": "v11-automl-search", "productionChanged": False}, "auto-cycle.json": {"promoted": False}},
            "auto-improve": {"experiment-v10-features.json": {"version": "v10-live-relative-feature-experiment", "design": {"productionChanged": False}}, "model-registry.json": {"latestChallenger": {"passedGate": False}}},
            "multibet": {"multibet-strategy-oos.json": {"version": "v12-multibet-oos-strategy", "productionChanged": False, "promotionCandidate": False}},
        }
        for kind, outputs in fixtures.items():
            with self.subTest(kind=kind):
                directory = self.root / "candidate-output" / kind
                guard.capture(self.root, directory, kind)
                for name, data in outputs.items(): (directory / name).write_text(json.dumps(data))
                with contextlib.redirect_stdout(io.StringIO()): guard.seal(self.root, directory, kind)
                self.assertFalse(guard.verify(directory, kind)["publicationAllowed"])

    def test_model_candidates_cannot_omit_model_schema(self):
        cases = {
            "automl": ("automl-challenger.json", "automl-validated-challenger", {
                "automl-search.json": {"version": "v11-automl-search", "productionChanged": False},
                "auto-cycle.json": {"promoted": False, "promotionCandidate": True}}),
            "auto-improve": ("challenger-model.json", "validated-challenger", {
                "experiment-v10-features.json": {"version": "v10-live-relative-feature-experiment", "design": {"productionChanged": False}},
                "model-registry.json": {"latestChallenger": {"passedGate": True}}}),
        }
        for kind, (name, status, outputs) in cases.items():
            with self.subTest(kind=kind):
                directory = self.root / "candidate-output" / kind
                guard.capture(self.root, directory, kind)
                for filename, data in outputs.items(): (directory / filename).write_text(json.dumps(data))
                (directory / name).write_text(json.dumps({"version": "fixture", "productionPromoted": False, "status": status}))
                with self.assertRaisesRegex(ValueError, "features"): guard.seal(self.root, directory, kind)

    def test_unknown_report_version_stops(self):
        self.prepare(); self.write("backtest.json", {"version": "unknown"})
        with self.assertRaisesRegex(ValueError, "reference backtest schema"): self.seal()


class AutoCycleSafety(unittest.TestCase):
    """Execute only the orchestration function against stubs, never model code."""
    def run_main(self, candidate, flags):
        tree = ast.parse((ROOT / "training/auto_cycle.py").read_text())
        main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
        written, touched = {}, []
        report = {"latestPeriod": {"test": ["2026-09-04", "2026-10-03"]}}
        champion = {"version": "current-fixture"}
        def fail(*args, **kwargs):
            touched.append("production")
            raise AssertionError("Production operation reached")
        ns = {"argparse": argparse, "Path": Path, "date": date, "datetime": datetime,
              "timezone": timezone, "json": json, "BASE": guard.BASE_FEATURES,
              "load": lambda path: report if path.endswith("search.json") else champion,
              "evaluate_champion": lambda *args: {"fixture": True},
              "choose_candidate": lambda *args: candidate,
              "write_json": lambda path, data: written.__setitem__(path, data),
              "patch_runtime": fail, "shutil": type("NoCopy", (), {"copyfile": staticmethod(fail)}),
              "build_production": fail}
        exec(compile(ast.Module(body=[main], type_ignores=[]), "auto_cycle.main", "exec"), ns)
        args = ["auto_cycle.py", "--report", "candidate-output/automl/automl-search.json",
                "--challenger", "candidate-output/automl/automl-challenger.json",
                "--cycle-report", "candidate-output/automl/auto-cycle.json"] + flags
        with patch.object(sys, "argv", args), contextlib.redirect_stdout(io.StringIO()): ns["main"]()
        self.assertFalse(touched)
        return written

    def test_selected_candidate_does_not_promote_by_default(self):
        candidate = {"features": [], "lr": .02, "l2": .001, "epochs": 1,
                     "latestModel": {"mean": [], "scale": [], "weights": []},
                     "latest": {}, "replication": {}, "robustnessScore": 1}
        written = self.run_main(candidate, [])
        self.assertFalse(written["candidate-output/automl/automl-challenger.json"]["productionPromoted"])
        self.assertFalse(written["candidate-output/automl/auto-cycle.json"]["promoted"])

    def test_explicit_candidate_mode_with_no_winner(self):
        written = self.run_main(None, ["--candidate-only"])
        self.assertEqual(len(written), 1)
        self.assertFalse(next(iter(written.values()))["promoted"])

    def test_serving_output_path_is_rejected_before_evaluation(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.run_main(None, ["--challenger", "model/model.json"])


class RepositorySafety(unittest.TestCase):
    scheduled = ("train-model.yml", "automl.yml", "auto-improve.yml", "multibet-strategy.yml")

    def test_changed_workflows_are_read_only_and_archive_candidates(self):
        for name in self.scheduled:
            with self.subTest(workflow=name):
                doc = yaml.load((ROOT / ".github/workflows" / name).read_text(), Loader=yaml.BaseLoader)
                self.assertEqual(doc["permissions"], {"contents": "read"})
                steps = next(iter(doc["jobs"].values()))["steps"]
                self.assertEqual(steps[0]["with"]["persist-credentials"], "false")
                shell = "\n".join(step.get("run", "") for step in steps)
                self.assertNotRegex(shell, r"git\s+(push|commit|revert)|--promote(?:\s|$)|vercel.*deploy")
                self.assertIn("candidate_artifacts.py seal", shell)
                artifacts = [s for s in steps if s.get("uses", "").startswith("actions/upload-artifact@")]
                self.assertEqual([s["with"]["retention-days"] for s in artifacts], ["14", "7"])
                self.assertTrue(all(s["with"]["overwrite"] == "false" for s in artifacts))
                if name == "automl.yml": self.assertIn("--candidate-only", shell)

    def test_no_push_or_pr_trigger_exists(self):
        for path in (ROOT / ".github/workflows").glob("*.yml"):
            # Trigger headers are parsed separately because an unrelated legacy manual
            # fix workflow already has invalid YAML inside its embedded script.
            header = path.read_text().split("\npermissions:", 1)[0]
            events = yaml.load(header, Loader=yaml.BaseLoader)["on"]
            self.assertLessEqual(set(events), {"schedule", "workflow_dispatch"}, path.name)

    def test_review_branch_alone_disables_vercel(self):
        config = json.loads((ROOT / "vercel.json").read_text())
        self.assertEqual(config["git"]["deploymentEnabled"], {"dot/review-model-pipeline-20261008": False})

    def test_prediction_and_training_source_bytes_preserved(self):
        expected = json.loads((ROOT / "tests/preserved_source_sha256.json").read_text())
        for path, digest in expected["files"].items():
            self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), digest, path)

    def test_preexisting_ui_functions_preserved(self):
        expected = json.loads((ROOT / "tests/preserved_ui_functions.json").read_text())
        source = (ROOT / "index.html").read_text()
        starts = list(re.finditer(r"^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(", source, re.M))
        actual = {}
        for i, match in enumerate(starts):
            end = starts[i + 1].start() if i + 1 < len(starts) else source.index("</script>", match.start())
            actual[match.group(1)] = hashlib.sha256(source[match.start():end].strip().encode()).hexdigest()
        for name, digest in expected.items(): self.assertEqual(actual[name], digest, name)


if __name__ == "__main__":
    unittest.main()

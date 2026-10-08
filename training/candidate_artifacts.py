"""Seal review-only research outputs. No training, network, git write, or promotion."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path

BASE_FEATURES = [f"lane{i}" for i in range(1, 7)] + [
    "avg_st", "national_win", "national2", "local_win", "local2", "motor2",
    "boat2", "meet_avg_finish", "meet_avg_st",
]
LIVE_FEATURES = {"ex_time_rel", "ex_st_rel", "course_gain", "weight_rel", "tilt_rel", "ex_flying"}
OUTPUTS = {
    "daily": ({"eval-model.json", "model.json", "backtest.json", "backtest-v93.json", "comparison-v93.json"}, set()),
    "automl": ({"automl-search.json", "auto-cycle.json"}, {"automl-challenger.json"}),
    "auto-improve": ({"experiment-v10-features.json", "model-registry.json"}, {"challenger-model.json"}),
    "multibet": ({"multibet-strategy-oos.json"}, {"multibet-strategy.json"}),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON key: " + key)
        result[key] = value
    return result


def read_json(path):
    def invalid_constant(value):
        raise ValueError("Non-finite JSON constant: " + value)
    require(path.is_file() and not path.is_symlink(), "Missing or symlinked file: " + str(path))
    value = json.loads(path.read_text(encoding="utf-8"), parse_constant=invalid_constant,
                       object_pairs_hook=unique_object)
    require(isinstance(value, dict), "Expected JSON object: " + str(path))
    return value


def write_new(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def validate_model(model, serving=False):
    require(isinstance(model.get("version"), str) and model["version"].strip(), "Unknown model version")
    features = model.get("features")
    require(isinstance(features, list) and all(isinstance(x, str) for x in features), "Invalid features")
    require(len(set(features)) == len(features), "Duplicate features")
    require(features[:15] == BASE_FEATURES and set(features[15:]) <= LIVE_FEATURES,
            "Unknown feature schema or ordering")
    for key in ("mean", "scale", "coefficients"):
        values = model.get(key)
        require(isinstance(values, list) and len(values) == len(features), "Invalid dimensions: " + key)
        require(all(type(x) in (int, float) and math.isfinite(x) for x in values), "Invalid numeric value: " + key)
    require(all(x > 0 for x in model["scale"]), "Scale must be positive")
    if serving and features[15:]:
        require(model.get("liveFeatureMode") == "race-relative", "Unknown serving preprocessing")


def serving_state(root):
    paths = {root / name for name in ("index.html", "predict.js", "vercel.json",
             "model/model.json", "model/model.previous.json", "model/production-manifest.json")}
    paths.update((root / "model").glob("*.json"))
    paths.update((root / "api").glob("*.js"))
    require(all(p.is_file() and not p.is_symlink() for p in paths), "Serving file missing or symlinked")
    return {p.relative_to(root).as_posix(): sha256(p) for p in sorted(paths)}


def output_directory(root, directory, kind):
    require(kind in OUTPUTS, "Unknown candidate kind")
    expected = root / "candidate-output" / kind
    require(directory.absolute() == expected.absolute(), "Output must use the exact isolated candidate directory")
    require(not directory.is_symlink() and not directory.parent.is_symlink(), "Symlinked output directory")
    return directory


def capture(root, directory, kind):
    output_directory(root, directory, kind)
    require(not directory.exists(), "Refusing to reuse a previous or partial candidate directory")
    model = read_json(root / "model/model.json")
    validate_model(model, serving=True)
    manifest = read_json(root / "model/production-manifest.json")
    source_sha = os.environ.get("GITHUB_SHA", "")
    run_id, attempt = os.environ.get("GITHUB_RUN_ID", ""), os.environ.get("GITHUB_RUN_ATTEMPT", "")
    require(re.fullmatch(r"[0-9a-f]{40}", source_sha), "Unknown source commit")
    require(re.fullmatch(r"[1-9][0-9]*", run_id) and re.fullmatch(r"[1-9][0-9]*", attempt), "Unknown run identity")
    baseline = {
        "schema": "boat-candidate-baseline-v1", "kind": kind, "capturedAt": utc_now(),
        "sourceCommit": source_sha, "runId": run_id, "runAttempt": attempt,
        "servingFiles": serving_state(root), "servingModelVersion": model["version"],
        "servingManifestVersion": manifest.get("active"),
        "servingManifestMatchesModel": manifest.get("active") == model["version"],
        "note": "A pre-existing manifest mismatch is recorded, never repaired or used to select a model.",
    }
    directory.mkdir(parents=True)
    write_new(directory / "baseline.json", baseline)


def check_outputs(directory, kind):
    required, optional = OUTPUTS[kind]
    names = {p.name for p in directory.iterdir()}
    require(required <= names, "Required research output missing")
    require(names <= required | optional | {"baseline.json", "bundle-manifest.json"}, "Unknown output file")
    data = {name: read_json(directory / name) for name in required | (optional & names)}
    if kind == "daily":
        for name in ("model.json", "eval-model.json"):
            validate_model(data[name])
        require(data["model.json"].get("mode") == "production", "Invalid daily candidate mode")
        require(data["eval-model.json"].get("mode") == "evaluation", "Invalid evaluation mode")
        require(data["backtest.json"].get("version") == "v9.2-predict-all-buy-selective", "Unknown reference backtest schema")
        require(data["backtest-v93.json"].get("version") == "v9.3-continuous-purchase-score", "Unknown backtest schema")
        require(all(isinstance(data["comparison-v93.json"].get(key), dict) for key in ("v9.2", "v9.3")),
                "Unknown comparison schema")
    elif kind == "automl":
        require(data["automl-search.json"].get("version") == "v11-automl-search", "Unknown AutoML report schema")
        require(data["automl-search.json"].get("productionChanged") is False, "Search changed production")
        require(data["auto-cycle.json"].get("promoted") is False, "Unexpected promotion")
        if data["auto-cycle.json"].get("promotionCandidate") is True:
            require("automl-challenger.json" in names, "Selected candidate missing")
    elif kind == "auto-improve":
        experiment = data["experiment-v10-features.json"]
        require(experiment.get("version") == "v10-live-relative-feature-experiment" and
                experiment.get("design", {}).get("productionChanged") is False, "Unknown experiment schema")
        latest = data["model-registry.json"].get("latestChallenger", {})
        passed = latest.get("passedGate")
        require(type(passed) is bool, "Unknown challenger result")
        require(("challenger-model.json" in names) == passed, "Candidate/gate mismatch")
    elif kind == "multibet":
        report = data["multibet-strategy-oos.json"]
        require(report.get("version") == "v12-multibet-oos-strategy", "Unknown strategy report schema")
        require(report.get("productionChanged") is False, "Strategy changed production")
        candidate = report.get("promotionCandidate")
        require(type(candidate) is bool, "Unknown strategy result")
        require(("multibet-strategy.json" in names) == candidate, "Strategy candidate/gate mismatch")
    for name in optional & names:
        require(data[name].get("productionPromoted") is False, "Candidate marked as promoted")
        if name in ("automl-challenger.json", "challenger-model.json"):
            expected_status = "automl-validated-challenger" if name.startswith("automl-") else "validated-challenger"
            require(data[name].get("status") == expected_status, "Unknown model candidate status")
            validate_model(data[name])
        else:
            require(data[name].get("version") == "v12-multibet-strategy-challenger" and
                    data[name].get("status") == "oos-positive-challenger" and
                    data[name].get("betType") in {"trifecta", "trio", "exacta", "quinella"},
                    "Unknown strategy candidate schema")
    return names - {"bundle-manifest.json"}


def seal(root, directory, kind):
    output_directory(root, directory, kind)
    baseline = read_json(directory / "baseline.json")
    require(baseline.get("schema") == "boat-candidate-baseline-v1" and baseline.get("kind") == kind, "Unknown baseline")
    require(baseline.get("sourceCommit") == os.environ.get("GITHUB_SHA") and
            baseline.get("runId") == os.environ.get("GITHUB_RUN_ID") and
            baseline.get("runAttempt") == os.environ.get("GITHUB_RUN_ATTEMPT"), "Run identity changed")
    require(baseline.get("servingFiles") == serving_state(root), "Serving files changed; stopping without repair")
    names = check_outputs(directory, kind)
    files = {name: {"sha256": sha256(directory / name), "size": (directory / name).stat().st_size}
             for name in sorted(names)}
    bundle = {
        "schema": "boat-review-candidate-bundle-v1", "kind": kind, "status": "research-complete",
        "publicationAllowed": False, "requiresSeparateApproval": True, "sealedAt": utc_now(),
        "sourceCommit": baseline["sourceCommit"], "runId": baseline["runId"], "runAttempt": baseline["runAttempt"],
        "requestedRetentionDays": 14, "expiryAuthority": "GitHub artifact expires_at metadata",
        "files": files, "servingModelVersion": baseline["servingModelVersion"],
        "servingManifestMatchesModel": baseline["servingManifestMatchesModel"],
        "unknownPolicy": "Stop. Do not retrain, retry publication, replace a model, or infer approval.",
    }
    write_new(directory / "bundle-manifest.json", bundle)
    verify(directory, kind)
    print(json.dumps({"kind": kind, "status": bundle["status"], "publicationAllowed": False}))


def verify(directory, kind):
    manifest = read_json(directory / "bundle-manifest.json")
    baseline = read_json(directory / "baseline.json")
    require(manifest.get("schema") == "boat-review-candidate-bundle-v1" and manifest.get("kind") == kind, "Unknown bundle")
    require(baseline.get("schema") == "boat-candidate-baseline-v1" and baseline.get("kind") == kind, "Unknown baseline")
    require(manifest.get("status") == "research-complete" and manifest.get("publicationAllowed") is False and
            manifest.get("requiresSeparateApproval") is True,
            "Bundle is not review-only research")
    require(manifest.get("requestedRetentionDays") == 14, "Unknown retention contract")
    require(all(manifest.get(key) == baseline.get(key) for key in
                ("sourceCommit", "runId", "runAttempt", "servingModelVersion", "servingManifestMatchesModel")),
            "Artifact provenance mismatch")
    names = check_outputs(directory, kind)
    require(set(manifest.get("files", {})) == names, "Artifact file set mismatch")
    for name, expected in manifest["files"].items():
        require(expected == {"sha256": sha256(directory / name), "size": (directory / name).stat().st_size},
                "Artifact digest mismatch: " + name)
    # This verifies integrity only; expiry, origin, approval and release compatibility
    # must be checked by a separately authorized publisher, which this PR does not add.
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("capture", "seal", "verify"))
    parser.add_argument("--kind", required=True, choices=OUTPUTS)
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    root = Path.cwd().resolve()
    directory = args.directory.absolute()
    if args.command == "verify":
        verify(directory, args.kind)
    else:
        {"capture": capture, "seal": seal}[args.command](root, directory, args.kind)


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


def load(path: Path):
    return json.loads(
        path.read_text(encoding="utf-8")
    )


def main():
    p = argparse.ArgumentParser()

    p.add_argument(
        "--report",
        default="model/automl-search.json",
    )
    p.add_argument(
        "--challenger",
        default="model/automl-challenger.json",
    )
    p.add_argument(
        "--production",
        default="model/model.json",
    )
    p.add_argument(
        "--backup",
        default="model/model.previous.json",
    )
    p.add_argument(
        "--manifest",
        default="model/production-manifest.json",
    )

    args = p.parse_args()

    report_path = Path(args.report)
    challenger_path = Path(args.challenger)
    production_path = Path(args.production)
    backup_path = Path(args.backup)
    manifest_path = Path(args.manifest)

    report = load(report_path)
    challenger = load(challenger_path)
    current = load(production_path)

    if report.get("productionChanged") is not False:
        raise SystemExit(
            "invalid AutoML report state"
        )

    if not report.get("promotionCandidate"):
        raise SystemExit(
            "AutoML report is not a promotion candidate"
        )

    if (
        challenger.get("status")
        != "automl-validated-challenger"
    ):
        raise SystemExit(
            "challenger is not validated"
        )

    if (
        challenger.get("productionPromoted")
        is not False
    ):
        raise SystemExit(
            "challenger already promoted or invalid"
        )

    features = challenger.get("features") or []
    mean = challenger.get("mean") or []
    scale = challenger.get("scale") or []
    coefficients = (
        challenger.get("coefficients") or []
    )

    n = len(features)

    if (
        n < 15
        or
        not (
            len(mean)
            ==
            len(scale)
            ==
            len(coefficients)
            ==
            n
        )
    ):
        raise SystemExit(
            "challenger dimensions invalid"
        )

    # -----------------------------------------
    # 現行Championを必ず1世代保存
    # -----------------------------------------

    backup_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    shutil.copyfile(
        production_path,
        backup_path,
    )

    promoted_at = datetime.now(
        timezone.utc
    ).isoformat()

    latest = (
        challenger.get("latestOOS")
        or {}
    )

    replication = (
        challenger.get("replicationOOS")
        or {}
    )

    # -----------------------------------------
    # Production model
    #
    # 展示前:
    # live特徴量はtraining meanで中立化
    #
    # 展示後:
    # race-relative特徴量を使用
    # -----------------------------------------

    production = {
        "version":
            challenger.get(
                "version",
                "v11-automl-production",
            ),

        "modelType":
            "conditional-logit-automl",

        "trainedAt":
            promoted_at,

        "raceCount":
            int(
                latest.get(
                    "races",
                    0,
                )
            ),

        "features":
            features,

        "mean":
            mean,

        "scale":
            scale,

        "coefficients":
            coefficients,

        "liveFeatures":
            challenger.get(
                "liveFeatures",
                [],
            ),

        "liveFeatureMode":
            "race-relative",

        "missingLivePolicy":
            "training-mean-neutral",

        "validation": {
            "top1Accuracy":
                latest.get(
                    "winnerTop1"
                ),

            "winnerInTop3":
                latest.get(
                    "winnerTop3"
                ),

            "trifectaTop1":
                latest.get(
                    "trifectaTop1"
                ),

            "trifectaTop3":
                latest.get(
                    "trifectaTop3"
                ),

            "trifectaTop5":
                latest.get(
                    "trifectaTop5"
                ),

            "logLoss":
                latest.get(
                    "logLoss"
                ),

            "brier":
                latest.get(
                    "brier"
                ),
        },

        "replicationValidation":
            replication,

        "automl": {
            "lr":
                challenger.get("lr"),

            "l2":
                challenger.get("l2"),

            "epochs":
                challenger.get(
                    "epochs"
                ),

            "robustnessScore":
                challenger.get(
                    "robustnessScore"
                ),
        },

        "source":
            "model/automl-challenger.json",
    }

    production_path.write_text(
        json.dumps(
            production,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    # -----------------------------------------
    # Production manifest / rollback pointer
    # -----------------------------------------

    manifest = {
        "promotedAt":
            promoted_at,

        "active":
            production["version"],

        "previous":
            current.get(
                "version"
            ),

        "rollbackFile":
            str(
                backup_path
            ),

        "liveFeatures":
            production[
                "liveFeatures"
            ],

        "latestOOS":
            latest,

        "replicationOOS":
            replication,

        "automaticRollbackReady":
            True,
    }

    manifest_path.write_text(
        json.dumps(
            manifest,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        json.dumps(
            manifest,
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

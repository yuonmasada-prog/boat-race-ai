from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def load(path: str):
    return json.loads(
        Path(path).read_text(
            encoding="utf-8"
        )
    )


def main():
    p = argparse.ArgumentParser()

    p.add_argument(
        "--experiment",
        default="model/experiment-v10-features.json",
    )

    p.add_argument(
        "--registry",
        default="model/model-registry.json",
    )

    p.add_argument(
        "--candidate",
        default="model/challenger-model.json",
    )

    args = p.parse_args()

    exp = load(
        args.experiment
    )

    ft = exp[
        "finalTest"
    ]

    base = ft[
        "baseline"
    ]

    new = ft[
        "enhanced"
    ]

    # ------------------------------------------
    # Conservative promotion gate
    #
    # 的中率だけではなく、
    # 確率品質も同時に改善していることを要求。
    # ------------------------------------------

    checks = {
        "oosRaces":
            int(
                new["races"]
            )
            >= 3000,

        "winnerTop1":
            new["winnerTop1"]
            >=
            base["winnerTop1"],

        "winnerTop3":
            new["winnerTop3"]
            >=
            base["winnerTop3"],

        "trifectaTop3":
            new["trifectaTop3"]
            >=
            base["trifectaTop3"],

        "trifectaTop5":
            new["trifectaTop5"]
            >=
            base["trifectaTop5"],

        "logLoss":
            new["logLoss"]
            <
            base["logLoss"],

        "brier":
            new["brier"]
            <
            base["brier"],
    }

    passed = all(
        checks.values()
    )

    registry_path = Path(
        args.registry
    )

    if registry_path.exists():
        registry = load(
            args.registry
        )

    else:
        registry = {
            "champion":
                "production-current",

            "history":
                [],
        }

    record = {
        "evaluatedAt":
            datetime.now(
                timezone.utc
            ).isoformat(),

        "experimentVersion":
            exp.get(
                "version"
            ),

        "passedGate":
            passed,

        "checks":
            checks,

        "baseline":
            base,

        "challenger":
            new,

        "addedFeatures":
            exp.get(
                "design",
                {},
            ).get(
                "addedFeatures",
                [],
            ),
    }

    registry.setdefault(
        "history",
        [],
    ).append(
        record
    )

    registry[
        "latestChallenger"
    ] = record

    if passed:
        model = exp[
            "enhancedModel"
        ]

        candidate = {
            "version":
                "challenger-v10-live-relative",

            "status":
                "validated-challenger",

            "generatedAt":
                datetime.now(
                    timezone.utc
                ).isoformat(),

            "features":
                model[
                    "features"
                ],

            "mean":
                model[
                    "mean"
                ],

            "scale":
                model[
                    "scale"
                ],

            "coefficients":
                model[
                    "coefficients"
                ],

            "validationEvidence":
                record,

            # ここでは本番へ自動反映しない
            "productionPromoted":
                False,
        }

        out = Path(
            args.candidate
        )

        out.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        out.write_text(
            json.dumps(
                candidate,
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        registry[
            "candidate"
        ] = candidate[
            "version"
        ]

    else:
        registry[
            "candidate"
        ] = None

    registry_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    registry_path.write_text(
        json.dumps(
            registry,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "passedGate":
                    passed,

                "checks":
                    checks,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

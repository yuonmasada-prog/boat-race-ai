from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone, date
from pathlib import Path

import numpy as np

import experiment_v10_features as v10


BASE = list(v10.BASE_FEATURES)
LIVE = list(v10.LIVE_FEATURES)
BASE_COUNT = len(BASE)


def load(path):
    return json.loads(
        Path(path).read_text(
            encoding="utf-8"
        )
    )


def write_json(path, data):
    path = Path(path)

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    path.write_text(
        json.dumps(
            data,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def subset_matrix(
    matrix,
    live_features,
):
    indices = list(
        range(
            BASE_COUNT
        )
    )

    for name in live_features:

        if name not in LIVE:
            raise RuntimeError(
                f"unsupported feature: {name}"
            )

        indices.append(
            BASE_COUNT
            +
            LIVE.index(
                name
            )
        )

    return matrix[
        :,
        indices
    ]


def transform_fixed(
    races,
    live_features,
    mean,
    scale,
):
    result = []

    for race in races:

        matrix = subset_matrix(
            race.enhanced,
            live_features,
        )

        matrix = np.where(
            np.isfinite(
                matrix
            ),
            matrix,
            mean,
        )

        result.append(
            (
                matrix
                -
                mean
            )
            /
            scale
        )

    return result


def evaluate_champion(
    champion,
    test_start,
    test_end,
):
    features = list(
        champion.get(
            "features",
            []
        )
    )

    live_features = [
        name
        for name in features
        if name in LIVE
    ]

    expected = (
        BASE
        +
        live_features
    )

    if features != expected:
        raise RuntimeError(
            "Champion feature order incompatible"
        )

    mean = np.asarray(
        champion[
            "mean"
        ],
        dtype=float,
    )

    scale = np.asarray(
        champion[
            "scale"
        ],
        dtype=float,
    )

    coefficients = np.asarray(
        champion[
            "coefficients"
        ],
        dtype=float,
    )

    if not (
        len(features)
        ==
        len(mean)
        ==
        len(scale)
        ==
        len(coefficients)
    ):
        raise RuntimeError(
            "Champion dimensions invalid"
        )

    print(
        "Collecting Champion OOS:",
        test_start,
        "->",
        test_end,
    )

    races = v10.collect(
        test_start,
        test_end,
    )

    if len(races) < 300:
        raise RuntimeError(
            "Insufficient Champion OOS races"
        )

    matrix = transform_fixed(
        races,
        live_features,
        mean,
        scale,
    )

    metrics = v10.evaluate(
        matrix,
        races,
        coefficients,
    )

    return metrics


def beats_champion(
    candidate,
    champion,
):
    # ------------------------------------------
    # 自動昇格は「同等」ではなく
    # 明確な改善を要求する。
    #
    # 3連単Top3:
    # +0.20pt以上
    #
    # 他指標はほぼ非劣化を要求。
    # ------------------------------------------

    return (
        candidate[
            "winnerTop1"
        ]
        >=
        champion[
            "winnerTop1"
        ]
        -
        0.001

        and

        candidate[
            "winnerTop3"
        ]
        >=
        champion[
            "winnerTop3"
        ]
        -
        0.002

        and

        candidate[
            "trifectaTop3"
        ]
        >=
        champion[
            "trifectaTop3"
        ]
        +
        0.002

        and

        candidate[
            "trifectaTop5"
        ]
        >=
        champion[
            "trifectaTop5"
        ]

        and

        candidate[
            "logLoss"
        ]
        <=
        champion[
            "logLoss"
        ]
        +
        0.002

        and

        candidate[
            "brier"
        ]
        <=
        champion[
            "brier"
        ]
        +
        0.0005
    )


def replication_guard(
    candidate,
    baseline,
):
    # ------------------------------------------
    # 過去Windowでは現在Championと比較しない。
    #
    # Champion自身がこの期間を
    # 学習に使っている可能性があるため。
    #
    # 同一実験内Baselineとの比較だけで
    # 安定性を確認する。
    # ------------------------------------------

    return (
        candidate[
            "winnerTop1"
        ]
        >=
        baseline[
            "winnerTop1"
        ]
        -
        0.002

        and

        candidate[
            "winnerTop3"
        ]
        >=
        baseline[
            "winnerTop3"
        ]
        -
        0.003

        and

        candidate[
            "trifectaTop3"
        ]
        >=
        baseline[
            "trifectaTop3"
        ]

        and

        candidate[
            "trifectaTop5"
        ]
        >=
        baseline[
            "trifectaTop5"
        ]

        and

        candidate[
            "logLoss"
        ]
        <=
        baseline[
            "logLoss"
        ]
        +
        0.003

        and

        candidate[
            "brier"
        ]
        <=
        baseline[
            "brier"
        ]
        +
        0.0007
    )


def choose_candidate(
    report,
    champion_metrics,
):
    finalists = report.get(
        "finalists",
        []
    )

    baseline = report.get(
        "baseline"
    )

    if not finalists:
        raise RuntimeError(
            "No AutoML finalists"
        )

    if not baseline:
        raise RuntimeError(
            "AutoML baseline missing"
        )

    qualified = []

    for item in finalists:

        latest_ok = beats_champion(
            item[
                "latest"
            ],
            champion_metrics,
        )

        replication_ok = (
            replication_guard(
                item[
                    "replication"
                ],
                baseline[
                    "replication"
                ],
            )
        )

        robustness_ok = (
            item[
                "robustnessScore"
            ]
            >=
            baseline[
                "robustnessScore"
            ]
        )

        if (
            latest_ok
            and
            replication_ok
            and
            robustness_ok
        ):
            qualified.append(
                item
            )

    if not qualified:
        return None

    qualified.sort(
        key=lambda x:
            x[
                "robustnessScore"
            ],
        reverse=True,
    )

    return qualified[0]


def replace_function(
    text,
    start_name,
    next_name,
    replacement,
):
    start = text.find(
        f"function {start_name}("
    )

    end = text.find(
        f"function {next_name}("
    )

    if (
        start < 0
        or
        end < 0
        or
        end <= start
    ):
        raise RuntimeError(
            f"Cannot replace "
            f"{start_name}"
        )

    return (
        text[
            :start
        ]
        +
        replacement.strip()
        +
        "\n\n\n"
        +
        text[
            end:
        ]
    )


def full_live_runtime():
    return r"""
function raceRelativeLiveMaps(
  racers,
  before
){

  const boats =
    racers.map(
      racer =>
        getBeforeBoat(
          before,
          Number(
            racer.lane
          )
        )
    );


  const exhibitionTimes =
    boats.map(
      boat =>
        finite(
          boat?.exTime
          ??
          boat?.exhibitionTime
        )
    );


  const exhibitionStarts =
    boats.map(
      boat =>
        finite(
          boat?.exSt
          ??
          boat?.st
        )
    );


  const courses =
    boats.map(
      boat =>
        finite(
          boat?.exCourse
          ??
          boat?.course
        )
    );


  const weights =
    boats.map(
      boat =>
        finite(
          boat?.weight
          ??
          boat?.bodyWeight
        )
    );


  const tilts =
    boats.map(
      boat =>
        finite(
          boat?.tilt
        )
    );


  const exTimeRel =
    relativeRaceValues(
      exhibitionTimes,
      true
    );


  const exStRel =
    relativeRaceValues(
      exhibitionStarts,
      true
    );


  const weightRel =
    relativeRaceValues(
      weights,
      true
    );


  const tiltRel =
    relativeRaceValues(
      tilts,
      false
    );


  return racers.map(
    (
      racer,
      index
    ) => {

      const lane =
        Number(
          racer.lane
          ??
          index + 1
        );


      const course =
        courses[
          index
        ];


      const exhibitionSt =
        exhibitionStarts[
          index
        ];


      return{

        ex_time_rel:
          exTimeRel[
            index
          ],

        ex_st_rel:
          exStRel[
            index
          ],

        course_gain:
          course !== null
            ?
            (
              lane
              -
              course
            )
            /
            5
            :
            null,

        weight_rel:
          weightRel[
            index
          ],

        tilt_rel:
          tiltRel[
            index
          ],

        ex_flying:
          (
            boats[index]?.exFlying
            ||
            boats[index]?.flying
            ||
            (
              exhibitionSt !== null
              &&
              exhibitionSt < 0
            )
          )
            ? 1
            : 0

      };

    }
  );

}
"""


def patch_runtime(
    index_path,
):
    path = Path(
        index_path
    )

    text = path.read_text(
        encoding="utf-8"
    )

    if (
        "function relativeRaceValues("
        not in text
    ):
        raise RuntimeError(
            "v11 relative engine missing"
        )

    text = replace_function(
        text,
        "raceRelativeLiveMaps",
        "modelLaneProbabilities",
        full_live_runtime(),
    )

    text = text.replace(
        "v11 / AutoML + RACE-RELATIVE LIVE MODEL",
        "AUTO CHAMPION / RACE-RELATIVE LIVE MODEL",
    )

    required = [
        "ex_time_rel",
        "ex_st_rel",
        "course_gain",
        "weight_rel",
        "tilt_rel",
        "ex_flying",
    ]

    for feature in required:

        if feature not in text:
            raise RuntimeError(
                f"Runtime feature missing: "
                f"{feature}"
            )

    path.write_text(
        text,
        encoding="utf-8",
    )


def build_production(
    candidate,
    version,
    generated_at,
):
    model = candidate[
        "latestModel"
    ]

    features = (
        BASE
        +
        candidate[
            "features"
        ]
    )

    if not (
        len(features)
        ==
        len(
            model[
                "mean"
            ]
        )
        ==
        len(
            model[
                "scale"
            ]
        )
        ==
        len(
            model[
                "weights"
            ]
        )
    ):
        raise RuntimeError(
            "Candidate model dimensions invalid"
        )

    return {
        "version":
            version,

        "modelType":
            "conditional-logit-automl",

        "trainedAt":
            generated_at,

        "raceCount":
            candidate[
                "latest"
            ][
                "races"
            ],

        "features":
            features,

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
                "weights"
            ],

        "liveFeatures":
            candidate[
                "features"
            ],

        "liveFeatureMode":
            "race-relative",

        "missingLivePolicy":
            "training-mean-neutral",

        "validation": {
            "top1Accuracy":
                candidate[
                    "latest"
                ][
                    "winnerTop1"
                ],

            "winnerInTop3":
                candidate[
                    "latest"
                ][
                    "winnerTop3"
                ],

            "trifectaTop1":
                candidate[
                    "latest"
                ][
                    "trifectaTop1"
                ],

            "trifectaTop3":
                candidate[
                    "latest"
                ][
                    "trifectaTop3"
                ],

            "trifectaTop5":
                candidate[
                    "latest"
                ][
                    "trifectaTop5"
                ],

            "logLoss":
                candidate[
                    "latest"
                ][
                    "logLoss"
                ],

            "brier":
                candidate[
                    "latest"
                ][
                    "brier"
                ],
        },

        "replicationValidation":
            candidate[
                "replication"
            ],

        "automl": {
            "lr":
                candidate[
                    "lr"
                ],

            "l2":
                candidate[
                    "l2"
                ],

            "epochs":
                candidate[
                    "epochs"
                ],

            "robustnessScore":
                candidate[
                    "robustnessScore"
                ],
        },

        "source":
            "weekly-auto-cycle",
    }


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--report",
        default=
            "model/automl-search.json",
    )

    parser.add_argument(
        "--champion",
        default=
            "model/model.json",
    )

    parser.add_argument(
        "--challenger",
        default=
            "model/automl-challenger.json",
    )

    parser.add_argument(
        "--backup",
        default=
            "model/model.previous.json",
    )

    parser.add_argument(
        "--manifest",
        default=
            "model/production-manifest.json",
    )

    parser.add_argument(
        "--cycle-report",
        default=
            "model/auto-cycle.json",
    )

    parser.add_argument(
        "--index",
        default=
            "index.html",
    )

    args = parser.parse_args()

    report = load(
        args.report
    )

    champion = load(
        args.champion
    )

    latest_period = report[
        "latestPeriod"
    ][
        "test"
    ]

    test_start = date.fromisoformat(
        latest_period[0]
    )

    test_end = date.fromisoformat(
        latest_period[1]
    )

    champion_metrics = (
        evaluate_champion(
            champion,
            test_start,
            test_end,
        )
    )

    candidate = choose_candidate(
        report,
        champion_metrics,
    )

    generated_at = (
        datetime.now(
            timezone.utc
        ).isoformat()
    )

    if candidate is None:

        cycle = {
            "generatedAt":
                generated_at,

            "promoted":
                False,

            "champion":
                champion.get(
                    "version"
                ),

            "championLatest":
                champion_metrics,

            "reason":
                (
                    "No finalist clearly "
                    "beat current Champion"
                ),
        }

        write_json(
            args.cycle_report,
            cycle,
        )

        print(
            json.dumps(
                cycle,
                ensure_ascii=False,
                indent=2,
            )
        )

        return

    version = (
        "v12-auto-"
        +
        datetime.now(
            timezone.utc
        ).strftime(
            "%Y%m%d-%H%M"
        )
    )

    challenger = {
        "version":
            version,

        "status":
            "automl-validated-challenger",

        "generatedAt":
            generated_at,

        "productionPromoted":
            True,

        "features":
            BASE
            +
            candidate[
                "features"
            ],

        "liveFeatures":
            candidate[
                "features"
            ],

        "lr":
            candidate[
                "lr"
            ],

        "l2":
            candidate[
                "l2"
            ],

        "epochs":
            candidate[
                "epochs"
            ],

        "mean":
            candidate[
                "latestModel"
            ][
                "mean"
            ],

        "scale":
            candidate[
                "latestModel"
            ][
                "scale"
            ],

        "coefficients":
            candidate[
                "latestModel"
            ][
                "weights"
            ],

        "latestOOS":
            candidate[
                "latest"
            ],

        "replicationOOS":
            candidate[
                "replication"
            ],

        "robustnessScore":
            candidate[
                "robustnessScore"
            ],

        "comparedChampion":
            champion.get(
                "version"
            ),

        "championLatestOOS":
            champion_metrics,
    }

    write_json(
        args.challenger,
        challenger,
    )

    patch_runtime(
        args.index
    )

    shutil.copyfile(
        args.champion,
        args.backup,
    )

    production = build_production(
        candidate,
        version,
        generated_at,
    )

    write_json(
        args.champion,
        production,
    )

    manifest = {
        "promotedAt":
            generated_at,

        "active":
            version,

        "previous":
            champion.get(
                "version"
            ),

        "rollbackFile":
            args.backup,

        "liveFeatures":
            candidate[
                "features"
            ],

        "automaticRollbackReady":
            True,
    }

    write_json(
        args.manifest,
        manifest,
    )

    cycle = {
        "generatedAt":
            generated_at,

        "promoted":
            True,

        "previousChampion":
            champion.get(
                "version"
            ),

        "newChampion":
            version,

        "liveFeatures":
            candidate[
                "features"
            ],

        "championLatest":
            champion_metrics,

        "challengerLatest":
            candidate[
                "latest"
            ],

        "challengerReplication":
            candidate[
                "replication"
            ],

        "robustnessScore":
            candidate[
                "robustnessScore"
            ],
    }

    write_json(
        args.cycle_report,
        cycle,
    )

    print(
        json.dumps(
            cycle,
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

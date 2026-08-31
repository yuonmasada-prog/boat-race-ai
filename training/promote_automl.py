from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path


def load(path: Path):
    return json.loads(
        path.read_text(
            encoding="utf-8"
        )
    )


def write_json(path: Path, data):
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


def replace_function_block(
    text: str,
    start_name: str,
    next_name: str,
    replacement: str,
):
    start = text.find(
        f"function {start_name}("
    )

    end = text.find(
        f"function {next_name}("
    )

    if start < 0 or end < 0 or end <= start:
        raise RuntimeError(
            f"cannot replace "
            f"{start_name} -> {next_name}"
        )

    return (
        text[:start]
        +
        replacement.rstrip()
        +
        "\n\n\n"
        +
        text[end:]
    )


def patch_before_js(path: Path):
    text = path.read_text(
        encoding="utf-8"
    )

    if "weight:null" not in text:
        old = """    exTime:null,

    tilt:null,"""

        new = """    exTime:null,

    weight:null,

    tilt:null,"""

        if old not in text:
            raise RuntimeError(
                "before.js emptyBoat target missing"
            )

        text = text.replace(
            old,
            new,
            1,
        )

    if "boat.weight=" not in text:
        marker = """      const tiltCandidates=[];"""

        block = r"""      // v11 body weight
      const weightMatch=
        rowText.match(
          /\b([4-6]\d(?:\.\d+)?)\s*kg\b/i
        );

      if(weightMatch){
        boat.weight=
          Number(
            weightMatch[1]
          );
      }


"""

        if marker not in text:
            raise RuntimeError(
                "before.js weight insertion target missing"
            )

        text = text.replace(
            marker,
            block + marker,
            1,
        )

    path.write_text(
        text,
        encoding="utf-8",
    )


def v11_helpers():
    return r"""
function relativeRaceValues(
  values,
  lowerIsBetter = false
){

  const parsed =
    values.map(
      value =>
        finite(
          value
        )
    );

  const available =
    parsed.filter(
      value =>
        value !== null
    );

  if(
    available.length < 2
  ){
    return parsed.map(
      () => null
    );
  }


  const mean =
    available.reduce(
      (sum,value) =>
        sum + value,
      0
    )
    /
    available.length;


  const variance =
    available.reduce(
      (
        sum,
        value
      ) =>
        sum
        +
        Math.pow(
          value - mean,
          2
        ),
      0
    )
    /
    available.length;


  const sd =
    Math.sqrt(
      variance
    );


  if(
    sd < 1e-8
  ){
    return parsed.map(
      value =>
        value === null
          ? null
          : 0
    );
  }


  return parsed.map(
    value => {

      if(
        value === null
      ){
        return null;
      }

      return lowerIsBetter
        ?
        (
          mean - value
        )
        /
        sd
        :
        (
          value - mean
        )
        /
        sd;

    }
  );

}


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


  const weights =
    boats.map(
      boat =>
        finite(
          boat?.weight
          ??
          boat?.bodyWeight
        )
    );


  const exTimeRel =
    relativeRaceValues(
      exhibitionTimes,
      true
    );


  const weightRel =
    relativeRaceValues(
      weights,
      true
    );


  return racers.map(
    (
      racer,
      index
    ) => {

      const boat =
        boats[index];


      const exhibitionSt =
        finite(
          boat?.exSt
          ??
          boat?.st
        );


      return{

        ex_time_rel:
          exTimeRel[index],

        weight_rel:
          weightRel[index],

        ex_flying:
          (
            boat?.exFlying
            ||
            boat?.flying
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


def v11_model_function():
    return r"""
function modelLaneProbabilities(
  racers,
  before = null,
  useLive = false
){

  if(
    !trainedModel
  ){
    throw new Error(
      'model-not-loaded'
    );
  }


  const relativeLive =
    (
      useLive
      &&
      trainedModel.liveFeatureMode
      ===
      'race-relative'
    )
      ?
      raceRelativeLiveMaps(
        racers,
        before
      )
      :
      racers.map(
        () => ({})
      );


  const scores =
    racers.map(
      (
        racer,
        racerIndex
      ) => {

        const raw = {
          ...rawFeatureMap(
            racer
          ),

          ...relativeLive[
            racerIndex
          ]
        };


        let score = 0;


        trainedModel.features
          .forEach(
            (
              name,
              index
            ) => {

              let value =
                finite(
                  raw[name]
                );


              if(
                value === null
              ){
                value =
                  trainedModel.mean[
                    index
                  ];
              }


              const scale =
                Math.abs(
                  trainedModel.scale[
                    index
                  ]
                )
                >
                1e-9
                  ?
                  trainedModel.scale[
                    index
                  ]
                  :
                  1;


              const z =
                (
                  value
                  -
                  trainedModel.mean[
                    index
                  ]
                )
                /
                scale;


              score +=
                z
                *
                trainedModel.coefficients[
                  index
                ];

            }
          );


        return score;

      }
    );


  return softmax(
    scores
  );

}
"""


def v11_adjusted_function():
    return r"""
function adjustedLaneProbabilities(
  racers,
  before,
  useLive
){

  const raceRelativeModel =
    trainedModel?.liveFeatureMode
    ===
    'race-relative';


  // v11+
  //
  // 展示特徴量はモデル内部で学習済み。
  // 旧6.80秒固定補正を二重適用しない。
  if(
    raceRelativeModel
  ){

    return modelLaneProbabilities(
      racers,
      before,
      useLive
    );

  }


  // legacy model
  const base =
    modelLaneProbabilities(
      racers
    );


  if(
    !useLive
  ){
    return base;
  }


  const scores =
    base.map(
      (
        probability,
        index
      ) => {

        const lane =
          Number(
            racers[index].lane
            ||
            index + 1
          );


        return(
          Math.log(
            Math.max(
              probability,
              1e-9
            )
          )

          +

          liveAdjustment(
            racers[index],
            getBeforeBoat(
              before,
              lane
            )
          )
        );

      }
    );


  return softmax(
    scores
  );

}
"""


def patch_index_html(path: Path):
    text = path.read_text(
        encoding="utf-8"
    )

    if (
        "function relativeRaceValues("
        not in text
    ):
        marker = (
            "function modelLaneProbabilities("
        )

        position = text.find(
            marker
        )

        if position < 0:
            raise RuntimeError(
                "model function target missing"
            )

        text = (
            text[:position]
            +
            v11_helpers().strip()
            +
            "\n\n\n"
            +
            text[position:]
        )

    text = replace_function_block(
        text,
        "modelLaneProbabilities",
        "getBeforeBoat",
        v11_model_function(),
    )

    text = replace_function_block(
        text,
        "adjustedLaneProbabilities",
        "trifectaProbabilities",
        v11_adjusted_function(),
    )

    text = text.replace(
        "<title>BOAT RACE AI v8.5</title>",
        "<title>BOAT RACE AI v11</title>",
    )

    text = text.replace(
        "v8.5 / PREDICTION + BUY DECISION",
        (
            "v11 / AutoML + "
            "RACE-RELATIVE LIVE MODEL"
        ),
    )

    required = [
        "ex_time_rel",
        "weight_rel",
        "ex_flying",
        "relativeRaceValues",
        "raceRelativeLiveMaps",
        "raceRelativeModel",
    ]

    missing = [
        item
        for item in required
        if item not in text
    ]

    if missing:
        raise RuntimeError(
            "index v11 support missing: "
            +
            ", ".join(
                missing
            )
        )

    path.write_text(
        text,
        encoding="utf-8",
    )


def validate_challenger(
    report,
    challenger,
):
    if (
        report.get(
            "productionChanged"
        )
        is not False
    ):
        raise RuntimeError(
            "invalid AutoML report state"
        )

    if not report.get(
        "promotionCandidate"
    ):
        raise RuntimeError(
            "not a promotion candidate"
        )

    if (
        challenger.get(
            "status"
        )
        !=
        "automl-validated-challenger"
    ):
        raise RuntimeError(
            "challenger is not validated"
        )

    features = (
        challenger.get(
            "features"
        )
        or []
    )

    mean = (
        challenger.get(
            "mean"
        )
        or []
    )

    scale = (
        challenger.get(
            "scale"
        )
        or []
    )

    coefficients = (
        challenger.get(
            "coefficients"
        )
        or []
    )

    if not (
        len(features)
        ==
        len(mean)
        ==
        len(scale)
        ==
        len(coefficients)
        ==
        18
    ):
        raise RuntimeError(
            "v11 model dimension invalid"
        )

    required = {
        "ex_time_rel",
        "weight_rel",
        "ex_flying",
    }

    if not required.issubset(
        set(features)
    ):
        raise RuntimeError(
            "v11 live features missing"
        )


def create_production_model(
    challenger,
    promoted_at,
):
    latest = (
        challenger.get(
            "latestOOS"
        )
        or {}
    )

    replication = (
        challenger.get(
            "replicationOOS"
        )
        or {}
    )

    return {
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
            challenger[
                "features"
            ],

        "mean":
            challenger[
                "mean"
            ],

        "scale":
            challenger[
                "scale"
            ],

        "coefficients":
            challenger[
                "coefficients"
            ],

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
                challenger.get(
                    "lr"
                ),

            "l2":
                challenger.get(
                    "l2"
                ),

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


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--report",
        default=
            "model/automl-search.json",
    )

    parser.add_argument(
        "--challenger",
        default=
            "model/automl-challenger.json",
    )

    parser.add_argument(
        "--production",
        default=
            "model/model.json",
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
        "--index",
        default=
            "index.html",
    )

    parser.add_argument(
        "--before",
        default=
            "api/before.js",
    )

    args = parser.parse_args()

    report_path = Path(
        args.report
    )

    challenger_path = Path(
        args.challenger
    )

    production_path = Path(
        args.production
    )

    backup_path = Path(
        args.backup
    )

    manifest_path = Path(
        args.manifest
    )

    index_path = Path(
        args.index
    )

    before_path = Path(
        args.before
    )

    report = load(
        report_path
    )

    challenger = load(
        challenger_path
    )

    current = load(
        production_path
    )

    validate_challenger(
        report,
        challenger,
    )

    # runtime first
    patch_before_js(
        before_path
    )

    patch_index_html(
        index_path
    )

    # backup current champion
    backup_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    shutil.copyfile(
        production_path,
        backup_path,
    )

    promoted_at = (
        datetime.now(
            timezone.utc
        ).isoformat()
    )

    production = (
        create_production_model(
            challenger,
            promoted_at,
        )
    )

    write_json(
        production_path,
        production,
    )

    manifest = {
        "promotedAt":
            promoted_at,

        "active":
            production[
                "version"
            ],

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
            production[
                "validation"
            ],

        "replicationOOS":
            production[
                "replicationValidation"
            ],

        "automaticRollbackReady":
            True,
    }

    write_json(
        manifest_path,
        manifest,
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

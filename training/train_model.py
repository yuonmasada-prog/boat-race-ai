from __future__ import annotations

import argparse
import io
import json
import math
import re
from datetime import (
    date,
    datetime,
    timedelta,
    timezone,
)
from pathlib import Path

import numpy as np
import pandas as pd
import requests


BASE = "https://boatracecsv.github.io/data"

DEFAULT_MODEL_PATH = Path(
    "model/model.json"
)

DEFAULT_HOLDOUT_DAYS = 45

FEATURES = [
    "lane1",
    "lane2",
    "lane3",
    "lane4",
    "lane5",
    "lane6",
    "avg_st",
    "national_win",
    "national2",
    "local_win",
    "local2",
    "motor2",
    "boat2",
    "meet_avg_finish",
    "meet_avg_st",
]

HEADERS = {
    "User-Agent":
        "boat-race-ai-v9-trainer",

    "Accept":
        "text/csv,text/plain,*/*",
}


def args():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--mode",
        choices=[
            "evaluation",
            "production",
        ],
        default="evaluation",
        help=(
            "evaluation reserves the external "
            "45-day holdout. production trains "
            "through the latest completed data."
        ),
    )

    parser.add_argument(
        "--days",
        type=int,
        default=120,
    )

    parser.add_argument(
        "--end-offset",
        type=int,
        default=None,
        help=(
            "Optional manual number of recent "
            "completed days to exclude."
        ),
    )

    parser.add_argument(
        "--holdout-days",
        type=int,
        default=DEFAULT_HOLDOUT_DAYS,
        help=(
            "Minimum external holdout used "
            "by evaluation mode."
        ),
    )

    parser.add_argument(
        "--output",
        type=str,
        default=str(
            DEFAULT_MODEL_PATH
        ),
    )

    parser.add_argument(
        "--min-races",
        type=int,
        default=500,
    )

    parser.add_argument(
        "--epochs",
        type=int,
        default=300,
    )

    parser.add_argument(
        "--lr",
        type=float,
        default=0.035,
    )

    parser.add_argument(
        "--l2",
        type=float,
        default=0.002,
    )

    # 旧workflow互換。
    # 現在の取得処理は直列なので
    # worker値そのものは使用しない。
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
    )

    parser.add_argument(
        "--smoke-test",
        action="store_true",
    )

    return parser.parse_args()


def csv(kind, target):
    url = (
        f"{BASE}/"
        f"{kind}/"
        f"{target:%Y/%m/%d}.csv"
    )

    response = requests.get(
        url,
        headers=HEADERS,
        timeout=20,
    )

    if (
        response.status_code == 404
        or not response.text.strip()
    ):
        return None

    response.raise_for_status()

    return pd.read_csv(
        io.StringIO(
            response.text
        ),
        dtype=str,
    )


def number(value):
    if value is None:
        return np.nan

    text = (
        str(value)
        .replace(",", "")
        .strip()
    )

    match = re.search(
        r"-?\d+(?:\.\d+)?",
        text,
    )

    if not match:
        return np.nan

    return float(
        match.group()
    )


def value(
    row,
    lane,
    names,
):
    for name in names:
        key = (
            f"艇{lane}_{name}"
        )

        if key in row.index:
            return row.get(key)

    return None


def by_code(frame):
    if (
        frame is None
        or frame.empty
        or "レースコード"
        not in frame.columns
    ):
        return {}

    result = {}

    for index in range(
        len(frame)
    ):
        row = frame.iloc[index]

        code = str(
            row.get(
                "レースコード",
                "",
            )
        ).strip()

        if code:
            result[code] = row

    return result


def meet(
    card,
    lane,
):
    finishes = []
    starts = []

    for day_no in range(
        1,
        8,
    ):
        for run in range(
            1,
            3,
        ):
            prefix = (
                f"艇{lane}_"
                f"節D{day_no}"
                f"走{run}_"
            )

            finish = number(
                card.get(
                    prefix + "着順"
                )
            )

            start = number(
                card.get(
                    prefix + "ST"
                )
            )

            if (
                np.isfinite(finish)
                and 1 <= finish <= 6
            ):
                finishes.append(
                    finish
                )

            if np.isfinite(start):
                starts.append(
                    start
                )

    meet_finish = (
        float(
            np.mean(
                finishes
            )
        )
        if finishes
        else np.nan
    )

    meet_start = (
        float(
            np.mean(
                starts
            )
        )
        if starts
        else np.nan
    )

    return (
        meet_finish,
        meet_start,
    )


def features(
    card,
    lane,
):
    (
        meet_finish,
        meet_st,
    ) = meet(
        card,
        lane,
    )

    return np.array(
        [
            *[
                float(
                    lane == n
                )
                for n in range(
                    1,
                    7,
                )
            ],

            number(
                value(
                    card,
                    lane,
                    [
                        "全国平均ST",
                        "平均ST",
                    ],
                )
            ),

            number(
                value(
                    card,
                    lane,
                    [
                        "全国勝率",
                    ],
                )
            ),

            number(
                value(
                    card,
                    lane,
                    [
                        "全国2連対率",
                        "全国2連率",
                    ],
                )
            ),

            number(
                value(
                    card,
                    lane,
                    [
                        "当地勝率",
                    ],
                )
            ),

            number(
                value(
                    card,
                    lane,
                    [
                        "当地2連対率",
                        "当地2連率",
                    ],
                )
            ),

            number(
                value(
                    card,
                    lane,
                    [
                        "モーター2連対率",
                        "モーター2連率",
                    ],
                )
            ),

            number(
                value(
                    card,
                    lane,
                    [
                        "ボート2連対率",
                        "ボート2連率",
                    ],
                )
            ),

            meet_finish,
            meet_st,
        ],
        dtype=float,
    )


def winner(row):
    for lane in range(
        1,
        7,
    ):
        key = (
            f"艇{lane}_着順"
        )

        if key not in row.index:
            continue

        place = number(
            row.get(key)
        )

        if (
            np.isfinite(place)
            and int(place) == 1
        ):
            return lane - 1

    for key in (
        "1着_艇番",
        "1着艇番",
        "1着_枠",
        "1着枠",
    ):
        if key not in row.index:
            continue

        lane = number(
            row.get(key)
        )

        if (
            np.isfinite(lane)
            and 1 <= lane <= 6
        ):
            return int(lane) - 1

    return None


def load_day(target):
    try:
        cards = csv(
            "programs/race_cards",
            target,
        )

        results = csv(
            "results/realtime",
            target,
        )

    except Exception as exc:
        print(
            f"WARN {target}: "
            f"{exc}",
            flush=True,
        )

        return []

    if (
        cards is None
        or results is None
    ):
        return []

    result_map = by_code(
        results
    )

    races = []

    for index in range(
        len(cards)
    ):
        card = cards.iloc[index]

        code = str(
            card.get(
                "レースコード",
                "",
            )
        ).strip()

        if not code:
            continue

        result = (
            result_map.get(
                code
            )
        )

        if result is None:
            continue

        first = winner(
            result
        )

        if first is None:
            continue

        matrix = np.vstack(
            [
                features(
                    card,
                    lane,
                )
                for lane
                in range(
                    1,
                    7,
                )
            ]
        )

        races.append(
            (
                code,
                target.isoformat(),
                matrix,
                first,
            )
        )

    return races


def collect(
    days,
    end_offset,
):
    end = (
        date.today()
        - timedelta(
            days=(
                1
                + end_offset
            )
        )
    )

    races = []

    for offset in range(
        days
    ):
        target = (
            end
            - timedelta(
                days=offset
            )
        )

        day_races = (
            load_day(
                target
            )
        )

        races.extend(
            day_races
        )

        print(
            f"{target}: "
            f"+{len(day_races)} "
            f"total={len(races)}",
            flush=True,
        )

    races.sort(
        key=lambda race: (
            race[1],
            race[0],
        )
    )

    return races


def smoke():
    end = (
        date.today()
        - timedelta(days=1)
    )

    for offset in range(
        7
    ):
        target = (
            end
            - timedelta(
                days=offset
            )
        )

        races = load_day(
            target
        )

        print(
            f"Smoke {target}: "
            f"{len(races)} races",
            flush=True,
        )

        if not races:
            continue

        matrix = races[0][2]

        expected = (
            6,
            len(FEATURES),
        )

        if (
            matrix.shape
            != expected
        ):
            raise SystemExit(
                "bad feature shape "
                f"{matrix.shape}"
            )

        print(
            "SMOKE TEST PASSED",
            flush=True,
        )

        return

    raise SystemExit(
        "SMOKE TEST FAILED: "
        "no usable race in 7 days"
    )


def resolve_end_offset(
    config,
):
    """
    evaluation:
      外部検証45日を絶対に保護する。

    production:
      デフォルト0。
      --end-offsetを明示した場合のみ
      その値を使用する。
    """

    if (
        config.mode
        == "evaluation"
    ):
        requested = (
            0
            if config.end_offset
            is None
            else config.end_offset
        )

        return max(
            requested,
            config.holdout_days,
            DEFAULT_HOLDOUT_DAYS,
        )

    if (
        config.end_offset
        is None
    ):
        return 0

    return config.end_offset


def prepare(
    train_raw,
    validation_raw,
):
    flat = np.vstack(
        [
            race[2]
            for race
            in train_raw
        ]
    )

    with np.errstate(
        all="ignore"
    ):
        mean = np.nanmean(
            flat,
            axis=0,
        )

    mean = np.where(
        np.isfinite(mean),
        mean,
        0.0,
    )

    filled = np.where(
        np.isfinite(flat),
        flat,
        mean,
    )

    scale = np.std(
        filled,
        axis=0,
    )

    scale = np.where(
        scale > 1e-8,
        scale,
        1.0,
    )

    def transform(dataset):
        output = []

        for race in dataset:
            matrix = np.where(
                np.isfinite(
                    race[2]
                ),
                race[2],
                mean,
            )

            matrix = (
                matrix - mean
            ) / scale

            output.append(
                (
                    race[0],
                    race[1],
                    matrix,
                    race[3],
                )
            )

        return output

    return (
        transform(
            train_raw
        ),

        transform(
            validation_raw
        ),

        mean,
        scale,
    )


def softmax(scores):
    scores = (
        scores
        - np.max(scores)
    )

    exp_scores = np.exp(
        scores
    )

    total = np.sum(
        exp_scores
    )

    if total <= 0:
        return np.full(
            len(scores),
            1.0 / len(scores),
        )

    return (
        exp_scores
        / total
    )


def train(
    dataset,
    epochs,
    lr,
    l2,
):
    weights = np.zeros(
        len(FEATURES),
        dtype=float,
    )

    for epoch in range(
        epochs
    ):
        gradient = (
            np.zeros_like(
                weights
            )
        )

        loss = 0.0

        for race in dataset:
            matrix = race[2]
            target = race[3]

            probabilities = (
                softmax(
                    matrix
                    @ weights
                )
            )

            loss -= math.log(
                max(
                    probabilities[
                        target
                    ],
                    1e-12,
                )
            )

            gradient += (
                probabilities
                @ matrix
                - matrix[target]
            )

        gradient /= len(
            dataset
        )

        gradient += (
            l2
            * weights
        )

        weights -= (
            lr
            * gradient
        )

        if (
            epoch == 0
            or (
                epoch + 1
            ) % 50 == 0
            or (
                epoch + 1
                == epochs
            )
        ):
            print(
                f"epoch="
                f"{epoch + 1} "
                f"loss="
                f"{loss / len(dataset):.6f}",
                flush=True,
            )

    return weights


def evaluate(
    dataset,
    weights,
):
    if not dataset:
        return {
            "races": 0,
            "top1Accuracy": 0.0,
            "winnerInTop3": 0.0,
            "logLoss": 0.0,
            "brierScore": 0.0,
        }

    hits = 0
    top3 = 0

    log_loss = 0.0
    brier = 0.0

    for race in dataset:
        matrix = race[2]
        target = race[3]

        probabilities = (
            softmax(
                matrix
                @ weights
            )
        )

        order = np.argsort(
            -probabilities
        )

        hits += int(
            order[0]
            == target
        )

        top3 += int(
            target
            in order[:3]
        )

        log_loss -= math.log(
            max(
                probabilities[
                    target
                ],
                1e-12,
            )
        )

        truth = np.zeros(6)

        truth[target] = 1.0

        brier += np.mean(
            (
                probabilities
                - truth
            ) ** 2
        )

    count = len(
        dataset
    )

    return {
        "races":
            count,

        "top1Accuracy":
            hits / count,

        "winnerInTop3":
            top3 / count,

        "logLoss":
            log_loss / count,

        "brierScore":
            brier / count,
    }


def main():
    config = args()

    if config.smoke_test:
        smoke()
        return

    if config.days < 1:
        raise SystemExit(
            "days must be >= 1"
        )

    if config.holdout_days < 0:
        raise SystemExit(
            "holdout-days must "
            "be >= 0"
        )

    if (
        config.end_offset
        is not None
        and config.end_offset < 0
    ):
        raise SystemExit(
            "end-offset must "
            "be >= 0"
        )

    effective_end_offset = (
        resolve_end_offset(
            config
        )
    )

    if (
        config.mode
        == "evaluation"
        and effective_end_offset
        < DEFAULT_HOLDOUT_DAYS
    ):
        raise SystemExit(
            "evaluation mode must "
            "reserve at least "
            f"{DEFAULT_HOLDOUT_DAYS} days"
        )

    print(
        "\n=== BOAT RACE AI v9 TRAIN ===",
        flush=True,
    )

    print(
        "mode               : "
        f"{config.mode}",
        flush=True,
    )

    print(
        "lookback days      : "
        f"{config.days}",
        flush=True,
    )

    print(
        "requested offset   : "
        f"{config.end_offset}",
        flush=True,
    )

    print(
        "holdout days       : "
        f"{config.holdout_days}",
        flush=True,
    )

    print(
        "effective offset   : "
        f"{effective_end_offset}",
        flush=True,
    )

    races = collect(
        config.days,
        effective_end_offset,
    )

    if (
        len(races)
        < config.min_races
    ):
        raise SystemExit(
            "not enough races: "
            f"{len(races)} "
            f"< {config.min_races}"
        )

    # モデル内部の時間順validation。
    #
    # これは外部15日validationとは別。
    # 外部45日はevaluation modeでは
    # collect段階で完全に除外されている。
    split = int(
        len(races)
        * 0.82
    )

    if (
        split <= 0
        or split >= len(races)
    ):
        raise SystemExit(
            "invalid internal split"
        )

    train_raw = (
        races[:split]
    )

    validation_raw = (
        races[split:]
    )

    (
        train_set,
        validation_set,
        mean,
        scale,
    ) = prepare(
        train_raw,
        validation_raw,
    )

    weights = train(
        train_set,
        config.epochs,
        config.lr,
        config.l2,
    )

    training = evaluate(
        train_set,
        weights,
    )

    internal_validation = (
        evaluate(
            validation_set,
            weights,
        )
    )

    if (
        config.mode
        == "evaluation"
    ):
        version = (
            "v9.1-conditional-logit-"
            "evaluation-holdout45"
        )

        external_holdout = {
            "enabled": True,
            "days":
                effective_end_offset,

            "strategyValidationDays":
                15,

            "finalTestDays":
                30,

            "purpose":
                "untouched external "
                "strategy evaluation",
        }

    else:
        version = (
            "v9.1-conditional-logit-"
            "production-latest"
        )

        external_holdout = {
            "enabled": False,
            "days":
                effective_end_offset,

            "purpose":
                "production model after "
                "external evaluation",
        }

    model = {
        "version":
            version,

        "mode":
            config.mode,

        "trainedAt":
            datetime.now(
                timezone.utc
            ).isoformat(),

        "lookbackDays":
            config.days,

        "requestedEndOffsetDays":
            config.end_offset,

        "holdoutDays":
            config.holdout_days,

        "endOffsetDays":
            effective_end_offset,

        "dataStartDate":
            races[0][1],

        "dataEndDate":
            races[-1][1],

        "raceCount":
            len(races),

        "trainRaceCount":
            len(train_set),

        "validationRaceCount":
            len(
                validation_set
            ),

        "features":
            FEATURES,

        "mean":
            mean.tolist(),

        "scale":
            scale.tolist(),

        "coefficients":
            weights.tolist(),

        "training":
            training,

        # 既存UI/APIとの互換用。
        "validation":
            internal_validation,

        "internalValidation":
            internal_validation,

        "externalHoldout":
            external_holdout,

        "evaluationDesign": {
            "modelInternalValidation":
                "chronological final 18% "
                "of collected training period",

            "evaluationModel":
                "excludes at least "
                "45 recent completed days",

            "strategyValidation":
                "first 15 days "
                "of external holdout",

            "finalTest":
                "last 30 days "
                "of external holdout",

            "productionModel":
                "may retrain through "
                "latest completed data "
                "only after evaluation",
        },
    }

    output_path = Path(
        config.output
    )

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    output_path.write_text(
        json.dumps(
            model,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        "\n=== MODEL SUMMARY ===",
        flush=True,
    )

    print(
        json.dumps(
            {
                "version":
                    model[
                        "version"
                    ],

                "mode":
                    model[
                        "mode"
                    ],

                "dataStartDate":
                    model[
                        "dataStartDate"
                    ],

                "dataEndDate":
                    model[
                        "dataEndDate"
                    ],

                "raceCount":
                    model[
                        "raceCount"
                    ],

                "endOffsetDays":
                    model[
                        "endOffsetDays"
                    ],

                "training":
                    training,

                "internalValidation":
                    internal_validation,

                "externalHoldout":
                    external_holdout,
            },
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()

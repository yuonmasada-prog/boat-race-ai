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
DEFAULT_MODEL_PATH = Path("model/model.json")

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

# v9の外部評価期間。
#
# 昨日
# ├─ final test 30日
# ├─ validation 15日
# └─ それ以前だけをモデル学習に利用
DEFAULT_HOLDOUT_DAYS = 45


def args():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--days",
        type=int,
        default=120,
    )

    parser.add_argument(
        "--end-offset",
        type=int,
        default=DEFAULT_HOLDOUT_DAYS,
        help=(
            "Completed recent days excluded "
            "from model training. "
            "v9 requires at least 45."
        ),
    )

    parser.add_argument(
        "--holdout-days",
        type=int,
        default=DEFAULT_HOLDOUT_DAYS,
        help=(
            "Minimum untouched period reserved "
            "for strategy validation/final test."
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

    # 旧workflowとの互換性用。
    # 現コードは直列収集なので値は保持のみ。
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

    return (
        float(match.group())
        if match
        else np.nan
    )


def value(
    row,
    lane,
    names,
):
    for name in names:
        key = f"艇{lane}_{name}"

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

    for day_no in range(1, 8):
        for run in range(1, 3):
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

    return (
        float(np.mean(finishes))
        if finishes
        else np.nan,

        float(np.mean(starts))
        if starts
        else np.nan,
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
                float(lane == n)
                for n
                in range(1, 7)
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
    for lane in range(1, 7):
        key = f"艇{lane}_着順"

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
            f"WARN {target}: {exc}",
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
            result_map.get(code)
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
                in range(1, 7)
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
    # 例:
    # 8/30実行・45日holdoutの場合
    # 最新学習日は7/15。
    #
    # 7/16〜7/30 validation
    # 7/31〜8/29 final test
    end = (
        date.today()
        - timedelta(
            days=1 + end_offset
        )
    )

    races = []

    for offset in range(days):
        target = (
            end
            - timedelta(
                days=offset
            )
        )

        day_races = load_day(
            target
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

    for offset in range(7):
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

        if matrix.shape != expected:
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


def prepare(
    train_raw,
    internal_validation_raw,
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
            internal_validation_raw
        ),
        mean,
        scale,
    )


def softmax(scores):
    scores = (
        scores
        - np.max(scores)
    )

    exp = np.exp(
        scores
    )

    total = np.sum(
        exp
    )

    if total <= 0:
        return np.full(
            len(scores),
            1.0 / len(scores),
        )

    return exp / total


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
        gradient = np.zeros_like(
            weights
        )

        loss = 0.0

        for race in dataset:
            matrix = race[2]
            target = race[3]

            probabilities = (
                softmax(
                    matrix @ weights
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
            l2 * weights
        )

        weights -= (
            lr * gradient
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
                f"epoch={epoch + 1} "
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

        probabilities = softmax(
            matrix @ weights
        )

        order = np.argsort(
            -probabilities
        )

        hits += int(
            order[0] == target
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

    if (
        config.days < 1
        or config.end_offset < 0
        or config.holdout_days < 1
    ):
        raise SystemExit(
            "days must be >= 1; "
            "offset must be >= 0; "
            "holdout must be >= 1"
        )

    # workflow側に古い --end-offset 30 等が
    # 残っていても、最低45日を必ず確保する。
    effective_end_offset = max(
        config.end_offset,
        config.holdout_days,
        DEFAULT_HOLDOUT_DAYS,
    )

    print(
        "\n=== BOAT RACE AI v9 TRAIN ===",
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
        "external holdout   : "
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

    # これは外部15日validationとは別物。
    #
    # 学習対象となる古いデータの中だけで
    # モデル自体の汎化性能を確認するための
    # internal validation。
    split = int(
        len(races) * 0.82
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

    internal_validation_raw = (
        races[split:]
    )

    (
        train_set,
        internal_validation_set,
        mean,
        scale,
    ) = prepare(
        train_raw,
        internal_validation_raw,
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
            internal_validation_set,
            weights,
        )
    )

    model = {
        "version":
            "v9.0-conditional-logit-"
            "holdout45",

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

        "externalValidationDays":
            15,

        "externalFinalTestDays":
            30,

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
                internal_validation_set
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

        # index.htmlとの互換性維持。
        # これは学習期間内のinternal validation。
        "validation":
            internal_validation,

        "evaluationDesign": {
            "internalValidation":
                "chronological 18% "
                "within training-period data",

            "externalHoldout":
                "45 untouched recent "
                "completed days",

            "strategyValidationDays":
                15,

            "finalTestDays":
                30,

            "finalTestUsage":
                "frozen strategy evaluation only",
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
                    model["version"],

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

                "effectiveEndOffsetDays":
                    model[
                        "endOffsetDays"
                    ],

                "training":
                    training,

                "internalValidation":
                    internal_validation,
            },
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import io
import json
import math
import re
from dataclasses import dataclass
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

HEADERS = {
    "User-Agent":
        "boat-race-ai-v10-feature-experiment",

    "Accept":
        "text/csv,text/plain,*/*",
}


BASE_FEATURES = [
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


LIVE_FEATURES = [
    "ex_time_rel",
    "ex_st_rel",
    "course_gain",
    "weight_rel",
    "tilt_rel",
    "ex_flying",
]


ALL_FEATURES = (
    BASE_FEATURES
    +
    LIVE_FEATURES
)


@dataclass
class Race:
    code: str
    race_date: str

    base: np.ndarray
    enhanced: np.ndarray

    winner: int

    finish: (
        tuple[int, int, int]
        | None
    )


def parse_args():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--train-days",
        type=int,
        default=120,
    )

    parser.add_argument(
        "--validation-days",
        type=int,
        default=15,
    )

    parser.add_argument(
        "--test-days",
        type=int,
        default=30,
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

    parser.add_argument(
        "--min-train-races",
        type=int,
        default=500,
    )

    parser.add_argument(
        "--min-test-races",
        type=int,
        default=300,
    )

    parser.add_argument(
        "--output",
        default=(
            "model/"
            "experiment-v10-features.json"
        ),
    )

    return parser.parse_args()


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


def fetch_csv(
    kind: str,
    target: date,
):
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
        or
        not response.text.strip()
    ):
        return None

    response.raise_for_status()

    return pd.read_csv(
        io.StringIO(
            response.text
        ),
        dtype=str,
    )


def by_code(frame):
    if (
        frame is None
        or
        frame.empty
        or
        "レースコード"
        not in frame.columns
    ):
        return {}

    result = {}

    for _, row in frame.iterrows():
        code = str(
            row.get(
                "レースコード",
                "",
            )
        ).strip()

        if code:
            result[code] = row

    return result


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


def meet_stats(
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
                and
                1 <= finish <= 6
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


def base_matrix(card):
    rows = []

    for lane in range(
        1,
        7,
    ):
        (
            meet_finish,
            meet_st,
        ) = meet_stats(
            card,
            lane,
        )

        rows.append(
            [
                *[
                    float(
                        lane == n
                    )
                    for n
                    in range(
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
            ]
        )

    return np.asarray(
        rows,
        dtype=float,
    )


def relative(
    values,
    lower_is_better=False,
):
    array = np.asarray(
        values,
        dtype=float,
    )

    finite_mask = np.isfinite(
        array
    )

    output = np.full(
        len(array),
        np.nan,
        dtype=float,
    )

    if finite_mask.sum() < 2:
        return output

    mean = float(
        np.mean(
            array[
                finite_mask
            ]
        )
    )

    sd = float(
        np.std(
            array[
                finite_mask
            ]
        )
    )

    if sd < 1e-8:
        output[
            finite_mask
        ] = 0.0

        return output

    if lower_is_better:
        output[
            finite_mask
        ] = (
            mean
            -
            array[
                finite_mask
            ]
        ) / sd

    else:
        output[
            finite_mask
        ] = (
            array[
                finite_mask
            ]
            -
            mean
        ) / sd

    return output


def live_matrix(
    tkz,
    stt,
):
    if (
        tkz is None
        or
        stt is None
    ):
        return None

    exhibition_times = []
    exhibition_starts = []
    courses = []
    weights = []
    tilts = []

    for lane in range(
        1,
        7,
    ):
        exhibition_times.append(
            number(
                tkz.get(
                    f"艇{lane}_展示タイム"
                )
            )
        )

        exhibition_starts.append(
            number(
                stt.get(
                    f"艇{lane}_スタート展示"
                )
            )
        )

        courses.append(
            number(
                stt.get(
                    f"艇{lane}_コース"
                )
            )
        )

        weights.append(
            number(
                tkz.get(
                    f"艇{lane}_体重(kg)"
                )
            )
        )

        tilts.append(
            number(
                tkz.get(
                    f"艇{lane}_チルト"
                )
            )
        )

    # --------------------------------------------------
    # v10の重要変更
    #
    # 6.80秒などの固定絶対基準を使わない。
    #
    # 同一レース6艇の中で
    # どの程度良いかを相対化する。
    #
    # これにより、
    # 場・気温・水面状態による
    # 展示時計そのものの水準差を軽減する。
    # --------------------------------------------------

    exhibition_time_relative = (
        relative(
            exhibition_times,
            lower_is_better=True,
        )
    )

    exhibition_st_relative = (
        relative(
            exhibition_starts,
            lower_is_better=True,
        )
    )

    weight_relative = (
        relative(
            weights,
            lower_is_better=True,
        )
    )

    tilt_relative = (
        relative(
            tilts,
            lower_is_better=False,
        )
    )

    rows = []

    for lane in range(
        1,
        7,
    ):
        course = (
            courses[
                lane - 1
            ]
        )

        course_gain = (
            (
                lane
                -
                course
            )
            /
            5.0

            if np.isfinite(
                course
            )

            else np.nan
        )

        exhibition_start = (
            exhibition_starts[
                lane - 1
            ]
        )

        rows.append(
            [
                exhibition_time_relative[
                    lane - 1
                ],

                exhibition_st_relative[
                    lane - 1
                ],

                course_gain,

                weight_relative[
                    lane - 1
                ],

                tilt_relative[
                    lane - 1
                ],

                (
                    1.0
                    if (
                        np.isfinite(
                            exhibition_start
                        )
                        and
                        exhibition_start < 0
                    )
                    else 0.0
                ),
            ]
        )

    matrix = np.asarray(
        rows,
        dtype=float,
    )

    # 比較品質を一定にするため、
    # 展示タイムと展示STが6艇揃った
    # レースだけを実験対象にする。

    if not np.isfinite(
        matrix[:, 0]
    ).all():
        return None

    if not np.isfinite(
        matrix[:, 1]
    ).all():
        return None

    return matrix


def finish_order(row):
    direct = []

    for place in (
        1,
        2,
        3,
    ):
        found = None

        for key in (
            f"{place}着_艇番",
            f"{place}着艇番",
            f"{place}着_枠",
            f"{place}着枠",
        ):
            if key not in row.index:
                continue

            lane = number(
                row.get(key)
            )

            if (
                np.isfinite(lane)
                and
                1 <= lane <= 6
            ):
                found = int(
                    lane
                )

                break

        if found is None:
            direct = []
            break

        direct.append(
            found
        )

    if (
        len(direct) == 3
        and
        len(set(direct)) == 3
    ):
        return tuple(
            direct
        )

    placed = []

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
            and
            1 <= place <= 3
        ):
            placed.append(
                (
                    int(place),
                    lane,
                )
            )

    placed.sort()

    if (
        len(placed) >= 3
        and
        [
            item[0]
            for item
            in placed[:3]
        ]
        ==
        [
            1,
            2,
            3,
        ]
    ):
        return tuple(
            item[1]
            for item
            in placed[:3]
        )

    return None


def load_day(target):
    try:
        cards = fetch_csv(
            "programs/race_cards",
            target,
        )

        results = fetch_csv(
            "results/realtime",
            target,
        )

        tkz = fetch_csv(
            "previews/tkz",
            target,
        )

        stt = fetch_csv(
            "previews/stt",
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
        or
        results is None
        or
        tkz is None
        or
        stt is None
    ):
        return []

    result_map = by_code(
        results
    )

    tkz_map = by_code(
        tkz
    )

    stt_map = by_code(
        stt
    )

    races = []

    for _, card in cards.iterrows():
        code = str(
            card.get(
                "レースコード",
                "",
            )
        ).strip()

        if not code:
            continue

        result = result_map.get(
            code
        )

        tkz_row = tkz_map.get(
            code
        )

        stt_row = stt_map.get(
            code
        )

        if (
            result is None
            or
            tkz_row is None
            or
            stt_row is None
        ):
            continue

        order = finish_order(
            result
        )

        if order is None:
            continue

        base = base_matrix(
            card
        )

        live = live_matrix(
            tkz_row,
            stt_row,
        )

        if live is None:
            continue

        enhanced = np.concatenate(
            [
                base,
                live,
            ],
            axis=1,
        )

        races.append(
            Race(
                code=code,

                race_date=(
                    target.isoformat()
                ),

                base=base,

                enhanced=enhanced,

                winner=(
                    order[0]
                    -
                    1
                ),

                finish=order,
            )
        )

    return races


def collect(
    start: date,
    end: date,
):
    races = []

    target = start

    while target <= end:
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

        target += timedelta(
            days=1
        )

    races.sort(
        key=lambda race: (
            race.race_date,
            race.code,
        )
    )

    return races


def fit_transformer(
    train_races,
    attribute,
):
    flat = np.vstack(
        [
            getattr(
                race,
                attribute,
            )
            for race
            in train_races
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

    return (
        mean,
        scale,
    )


def transform(
    races,
    attribute,
    mean,
    scale,
):
    output = []

    for race in races:
        matrix = getattr(
            race,
            attribute,
        )

        matrix = np.where(
            np.isfinite(
                matrix
            ),
            matrix,
            mean,
        )

        matrix = (
            matrix
            -
            mean
        ) / scale

        output.append(
            matrix
        )

    return output


def softmax(scores):
    scores = (
        scores
        -
        np.max(scores)
    )

    exponentials = np.exp(
        scores
    )

    total = float(
        np.sum(
            exponentials
        )
    )

    if total <= 0:
        return np.full(
            len(scores),
            1.0 / len(scores),
        )

    return (
        exponentials
        /
        total
    )


def train_model(
    matrices,
    races,
    feature_count,
    epochs,
    lr,
    l2,
):
    weights = np.zeros(
        feature_count,
        dtype=float,
    )

    for epoch in range(
        epochs
    ):
        gradient = np.zeros_like(
            weights
        )

        loss = 0.0

        for (
            matrix,
            race,
        ) in zip(
            matrices,
            races,
        ):
            probabilities = softmax(
                matrix
                @
                weights
            )

            target = race.winner

            loss -= math.log(
                max(
                    float(
                        probabilities[
                            target
                        ]
                    ),
                    1e-12,
                )
            )

            gradient += (
                probabilities
                @
                matrix
                -
                matrix[
                    target
                ]
            )

        gradient /= len(
            races
        )

        gradient += (
            l2
            *
            weights
        )

        weights -= (
            lr
            *
            gradient
        )

        if (
            epoch == 0
            or
            (
                epoch + 1
            ) % 50 == 0
            or
            (
                epoch + 1
            ) == epochs
        ):
            print(
                "epoch="
                f"{epoch + 1} "
                "loss="
                f"{loss / len(races):.6f}",
                flush=True,
            )

    return weights


def pl_trifecta(
    lane_probabilities,
):
    scores = {}

    for first in range(
        6
    ):
        for second in range(
            6
        ):
            if second == first:
                continue

            for third in range(
                6
            ):
                if third in (
                    first,
                    second,
                ):
                    continue

                p1 = (
                    lane_probabilities[
                        first
                    ]
                )

                p2 = (
                    lane_probabilities[
                        second
                    ]
                    /
                    max(
                        1
                        -
                        p1,
                        1e-12,
                    )
                )

                p3 = (
                    lane_probabilities[
                        third
                    ]
                    /
                    max(
                        1
                        -
                        lane_probabilities[
                            first
                        ]
                        -
                        lane_probabilities[
                            second
                        ],
                        1e-12,
                    )
                )

                combo = (
                    f"{first + 1}"
                    f"{second + 1}"
                    f"{third + 1}"
                )

                scores[
                    combo
                ] = float(
                    p1
                    *
                    p2
                    *
                    p3
                )

    total = sum(
        scores.values()
    )

    if total > 0:
        scores = {
            combo:
                probability
                /
                total

            for (
                combo,
                probability,
            )
            in scores.items()
        }

    return scores


def evaluate(
    matrices,
    races,
    weights,
):
    winner_top1 = 0
    winner_top3 = 0

    log_loss = 0.0
    brier = 0.0

    trifecta_top1 = 0
    trifecta_top3 = 0
    trifecta_top5 = 0

    for (
        matrix,
        race,
    ) in zip(
        matrices,
        races,
    ):
        probabilities = softmax(
            matrix
            @
            weights
        )

        order = np.argsort(
            -probabilities
        )

        winner_top1 += int(
            order[0]
            ==
            race.winner
        )

        winner_top3 += int(
            race.winner
            in
            order[:3]
        )

        log_loss -= math.log(
            max(
                float(
                    probabilities[
                        race.winner
                    ]
                ),
                1e-12,
            )
        )

        truth = np.zeros(
            6
        )

        truth[
            race.winner
        ] = 1.0

        brier += float(
            np.mean(
                (
                    probabilities
                    -
                    truth
                )
                **
                2
            )
        )

        ranked = sorted(
            pl_trifecta(
                probabilities
            ).items(),
            key=lambda item:
                -item[1],
        )

        actual = "".join(
            str(lane)
            for lane
            in race.finish
        )

        combos = [
            item[0]
            for item
            in ranked
        ]

        trifecta_top1 += int(
            actual
            in
            combos[:1]
        )

        trifecta_top3 += int(
            actual
            in
            combos[:3]
        )

        trifecta_top5 += int(
            actual
            in
            combos[:5]
        )

    count = len(
        races
    )

    if count == 0:
        return {
            "races": 0,

            "winnerTop1": 0.0,
            "winnerTop3": 0.0,

            "logLoss": 0.0,
            "brier": 0.0,

            "trifectaTop1": 0.0,
            "trifectaTop3": 0.0,
            "trifectaTop5": 0.0,
        }

    return {
        "races":
            count,

        "winnerTop1":
            winner_top1
            /
            count,

        "winnerTop3":
            winner_top3
            /
            count,

        "logLoss":
            log_loss
            /
            count,

        "brier":
            brier
            /
            count,

        "trifectaTop1":
            trifecta_top1
            /
            count,

        "trifectaTop3":
            trifecta_top3
            /
            count,

        "trifectaTop5":
            trifecta_top5
            /
            count,
    }


def main():
    config = parse_args()

    if (
        config.train_days < 1
        or
        config.validation_days < 1
        or
        config.test_days < 1
    ):
        raise SystemExit(
            "all period lengths "
            "must be >= 1"
        )

    completed_end = (
        date.today()
        -
        timedelta(
            days=1
        )
    )

    test_end = (
        completed_end
    )

    test_start = (
        test_end
        -
        timedelta(
            days=(
                config.test_days
                -
                1
            )
        )
    )

    validation_end = (
        test_start
        -
        timedelta(
            days=1
        )
    )

    validation_start = (
        validation_end
        -
        timedelta(
            days=(
                config.validation_days
                -
                1
            )
        )
    )

    train_end = (
        validation_start
        -
        timedelta(
            days=1
        )
    )

    train_start = (
        train_end
        -
        timedelta(
            days=(
                config.train_days
                -
                1
            )
        )
    )

    print(
        "=== BOAT RACE AI "
        "v10 FEATURE EXPERIMENT ===",
        flush=True,
    )

    print(
        "train      : "
        f"{train_start} "
        "-> "
        f"{train_end}",
        flush=True,
    )

    print(
        "validation : "
        f"{validation_start} "
        "-> "
        f"{validation_end}",
        flush=True,
    )

    print(
        "final test : "
        f"{test_start} "
        "-> "
        f"{test_end}",
        flush=True,
    )

    all_races = collect(
        train_start,
        test_end,
    )

    train_races = [
        race
        for race
        in all_races
        if (
            train_start
            <=
            date.fromisoformat(
                race.race_date
            )
            <=
            train_end
        )
    ]

    validation_races = [
        race
        for race
        in all_races
        if (
            validation_start
            <=
            date.fromisoformat(
                race.race_date
            )
            <=
            validation_end
        )
    ]

    test_races = [
        race
        for race
        in all_races
        if (
            test_start
            <=
            date.fromisoformat(
                race.race_date
            )
            <=
            test_end
        )
    ]

    if (
        len(train_races)
        <
        config.min_train_races
    ):
        raise SystemExit(
            "too few training races: "
            f"{len(train_races)}"
        )

    if (
        len(test_races)
        <
        config.min_test_races
    ):
        raise SystemExit(
            "too few final-test races: "
            f"{len(test_races)}"
        )

    # --------------------------------------------------
    # 同じレース集合を使用して
    # baseline と enhanced を比較する。
    #
    # 「対象レースが違うため数字が良く見える」
    # 問題を防ぐ。
    # --------------------------------------------------

    (
        base_mean,
        base_scale,
    ) = fit_transformer(
        train_races,
        "base",
    )

    (
        enhanced_mean,
        enhanced_scale,
    ) = fit_transformer(
        train_races,
        "enhanced",
    )

    base_train = transform(
        train_races,
        "base",
        base_mean,
        base_scale,
    )

    base_validation = transform(
        validation_races,
        "base",
        base_mean,
        base_scale,
    )

    base_test = transform(
        test_races,
        "base",
        base_mean,
        base_scale,
    )

    enhanced_train = transform(
        train_races,
        "enhanced",
        enhanced_mean,
        enhanced_scale,
    )

    enhanced_validation = transform(
        validation_races,
        "enhanced",
        enhanced_mean,
        enhanced_scale,
    )

    enhanced_test = transform(
        test_races,
        "enhanced",
        enhanced_mean,
        enhanced_scale,
    )

    print(
        "\n--- baseline training ---",
        flush=True,
    )

    base_weights = train_model(
        base_train,
        train_races,
        len(
            BASE_FEATURES
        ),
        config.epochs,
        config.lr,
        config.l2,
    )

    print(
        "\n--- enhanced training ---",
        flush=True,
    )

    enhanced_weights = train_model(
        enhanced_train,
        train_races,
        len(
            ALL_FEATURES
        ),
        config.epochs,
        config.lr,
        config.l2,
    )

    base_validation_metrics = (
        evaluate(
            base_validation,
            validation_races,
            base_weights,
        )
    )

    enhanced_validation_metrics = (
        evaluate(
            enhanced_validation,
            validation_races,
            enhanced_weights,
        )
    )

    base_test_metrics = evaluate(
        base_test,
        test_races,
        base_weights,
    )

    enhanced_test_metrics = (
        evaluate(
            enhanced_test,
            test_races,
            enhanced_weights,
        )
    )

    comparison = {
        key:
            (
                enhanced_test_metrics[
                    key
                ]
                -
                base_test_metrics[
                    key
                ]
            )

        for key
        in (
            "winnerTop1",
            "winnerTop3",

            "logLoss",
            "brier",

            "trifectaTop1",
            "trifectaTop3",
            "trifectaTop5",
        )
    }

    # --------------------------------------------------
    # 本番昇格「候補」条件
    #
    # final testを見て閾値調整はしない。
    #
    # 勝者Top1
    # 3連単Top3
    # logLoss
    # Brier
    #
    # の主要4項目が悪化しないこと。
    #
    # この時点ではあくまで候補。
    # 本番変更はまだしない。
    # --------------------------------------------------

    promotion_candidate = bool(
        (
            enhanced_test_metrics[
                "winnerTop1"
            ]
            >=
            base_test_metrics[
                "winnerTop1"
            ]
        )

        and

        (
            enhanced_test_metrics[
                "trifectaTop3"
            ]
            >=
            base_test_metrics[
                "trifectaTop3"
            ]
        )

        and

        (
            enhanced_test_metrics[
                "logLoss"
            ]
            <=
            base_test_metrics[
                "logLoss"
            ]
        )

        and

        (
            enhanced_test_metrics[
                "brier"
            ]
            <=
            base_test_metrics[
                "brier"
            ]
        )
    )

    output = {
        "version":
            "v10-live-relative-"
            "feature-experiment",

        "generatedAt":
            datetime.now(
                timezone.utc
            ).isoformat(),

        "design": {
            "productionChanged":
                False,

            "pairedRaceComparison":
                True,

            "dataLeakageGuard":
                True,

            "trainingDays":
                config.train_days,

            "validationDays":
                config.validation_days,

            "finalTestDays":
                config.test_days,

            "baselineFeatures":
                BASE_FEATURES,

            "addedFeatures":
                LIVE_FEATURES,

            "liveFeaturePolicy":
                (
                    "within-race "
                    "relative normalization"
                ),

            "fixedExhibitionBaseline680Used":
                False,

            "purchaseLogicChanged":
                False,

            "probabilitiesCalibrated":
                False,
        },

        "periods": {
            "train": {
                "start":
                    str(
                        train_start
                    ),

                "end":
                    str(
                        train_end
                    ),

                "races":
                    len(
                        train_races
                    ),
            },

            "validation": {
                "start":
                    str(
                        validation_start
                    ),

                "end":
                    str(
                        validation_end
                    ),

                "races":
                    len(
                        validation_races
                    ),
            },

            "finalTest": {
                "start":
                    str(
                        test_start
                    ),

                "end":
                    str(
                        test_end
                    ),

                "races":
                    len(
                        test_races
                    ),
            },
        },

        "validation": {
            "baseline":
                base_validation_metrics,

            "enhanced":
                enhanced_validation_metrics,
        },

        "finalTest": {
            "baseline":
                base_test_metrics,

            "enhanced":
                enhanced_test_metrics,

            "enhancedMinusBaseline":
                comparison,
        },

        "promotionCandidate":
            promotion_candidate,

        "enhancedModel": {
            "features":
                ALL_FEATURES,

            "mean":
                enhanced_mean.tolist(),

            "scale":
                enhanced_scale.tolist(),

            "coefficients":
                enhanced_weights.tolist(),
        },

        "baselineModel": {
            "features":
                BASE_FEATURES,

            "mean":
                base_mean.tolist(),

            "scale":
                base_scale.tolist(),

            "coefficients":
                base_weights.tolist(),
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
            output,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        "\n=== V10 EXPERIMENT RESULT ===",
        flush=True,
    )

    print(
        json.dumps(
            {
                "validation":
                    output[
                        "validation"
                    ],

                "finalTest":
                    output[
                        "finalTest"
                    ],

                "promotionCandidate":
                    promotion_candidate,
            },
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()

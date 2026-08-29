from __future__ import annotations

import argparse
import io
import json
import math
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests


BASE = "https://boatracecsv.github.io/data"
OUT = Path("model/model.json")

FEATURES = [
    "lane1", "lane2", "lane3", "lane4", "lane5", "lane6",
    "grade_a1", "grade_a2", "grade_b1", "grade_b2",
    "avg_st",
    "national_win", "national2", "national3",
    "local_win", "local2", "local3",
    "motor2", "motor3",
    "boat2", "boat3",
    "f_count", "l_count",
    "meet_avg_finish", "meet_avg_st", "meet_count",
    "ex_time", "ex_st", "ex_course_shift",
    "wind", "wave", "temperature", "water_temperature",
]

HEADERS = {
    "User-Agent": "boat-race-ai-v7-trainer/2.0",
    "Accept": "text/csv,text/plain,*/*",
}


def parse_args():
    p = argparse.ArgumentParser()

    p.add_argument(
        "--days",
        type=int,
        default=120,
    )

    p.add_argument(
        "--min-races",
        type=int,
        default=500,
    )

    p.add_argument(
        "--epochs",
        type=int,
        default=300,
    )

    p.add_argument(
        "--lr",
        type=float,
        default=0.035,
    )

    p.add_argument(
        "--l2",
        type=float,
        default=0.002,
    )

    p.add_argument(
        "--workers",
        type=int,
        default=4,
    )

    return p.parse_args()


def fetch_csv(
    kind: str,
    day: date,
):
    url = (
        f"{BASE}/"
        f"{kind}/"
        f"{day:%Y/%m/%d}.csv"
    )

    try:
        response = requests.get(
            url,
            headers=HEADERS,
            timeout=20,
        )

        if response.status_code == 404:
            return None

        response.raise_for_status()

        if not response.text.strip():
            return None

        return pd.read_csv(
            io.StringIO(
                response.text
            ),
            dtype=str,
        )

    except Exception as exc:
        print(
            f"WARN fetch failed "
            f"{kind} {day}: {exc}",
            flush=True,
        )

        return None


def num(value):
    if value is None:
        return np.nan

    text = (
        str(value)
        .strip()
        .replace(",", "")
    )

    if (
        not text
        or
        text.lower() == "nan"
    ):
        return np.nan

    match = re.search(
        r"-?\d+(?:\.\d+)?",
        text,
    )

    if not match:
        return np.nan

    return float(
        match.group(0)
    )


def boat_value(
    row,
    lane: int,
    *suffixes,
):
    for suffix in suffixes:
        key = (
            f"艇{lane}_"
            f"{suffix}"
        )

        if key in row.index:
            return row.get(key)

    return None


def first_value(
    row,
    *names,
):
    for name in names:
        if name in row.index:
            return row.get(name)

    return None


def grade_flags(value):
    grade = (
        str(value or "")
        .strip()
        .upper()
    )

    return [
        float(
            grade == candidate
        )
        for candidate in (
            "A1",
            "A2",
            "B1",
            "B2",
        )
    ]


def meet_features(
    row,
    lane: int,
):
    finishes = []
    starts = []
    count = 0

    for day_number in range(
        1,
        8,
    ):
        for run_number in range(
            1,
            3,
        ):
            prefix = (
                f"艇{lane}_"
                f"節D{day_number}"
                f"走{run_number}_"
            )

            values = [
                row.get(
                    prefix + key
                )
                for key in (
                    "R番号",
                    "進入",
                    "枠",
                    "ST",
                    "着順",
                )
            ]

            has_data = any(
                value is not None
                and
                str(value).strip()
                not in (
                    "",
                    "nan",
                )
                for value
                in values
            )

            if has_data:
                count += 1

            finish = num(
                row.get(
                    prefix
                    +
                    "着順"
                )
            )

            start = num(
                row.get(
                    prefix
                    +
                    "ST"
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

    return (
        float(
            np.mean(finishes)
        )
        if finishes
        else np.nan,

        float(
            np.mean(starts)
        )
        if starts
        else np.nan,

        float(count),
    )


def build_feature(
    card,
    stt,
    tkz,
    sui,
    lane: int,
):
    (
        meet_finish,
        meet_st,
        meet_count,
    ) = meet_features(
        card,
        lane,
    )

    ex_course = num(
        boat_value(
            stt,
            lane,
            "コース",
            "進入",
        )
    )

    ex_st = num(
        boat_value(
            stt,
            lane,
            "スタート展示",
            "展示ST",
        )
    )

    ex_time = num(
        boat_value(
            tkz,
            lane,
            "展示タイム",
        )
    )

    values = [
        *[
            float(
                lane == number
            )
            for number
            in range(
                1,
                7,
            )
        ],

        *grade_flags(
            boat_value(
                card,
                lane,
                "級別",
                "級",
            )
        ),

        num(
            boat_value(
                card,
                lane,
                "全国平均ST",
                "平均ST",
            )
        ),

        num(
            boat_value(
                card,
                lane,
                "全国勝率",
            )
        ),

        num(
            boat_value(
                card,
                lane,
                "全国2連対率",
                "全国2連率",
            )
        ),

        num(
            boat_value(
                card,
                lane,
                "全国3連対率",
                "全国3連率",
            )
        ),

        num(
            boat_value(
                card,
                lane,
                "当地勝率",
            )
        ),

        num(
            boat_value(
                card,
                lane,
                "当地2連対率",
                "当地2連率",
            )
        ),

        num(
            boat_value(
                card,
                lane,
                "当地3連対率",
                "当地3連率",
            )
        ),

        num(
            boat_value(
                card,
                lane,
                "モーター2連対率",
                "モーター2連率",
            )
        ),

        num(
            boat_value(
                card,
                lane,
                "モーター3連対率",
                "モーター3連率",
            )
        ),

        num(
            boat_value(
                card,
                lane,
                "ボート2連対率",
                "ボート2連率",
            )
        ),

        num(
            boat_value(
                card,
                lane,
                "ボート3連対率",
                "ボート3連率",
            )
        ),

        num(
            boat_value(
                card,
                lane,
                "F本数",
                "F",
            )
        ),

        num(
            boat_value(
                card,
                lane,
                "L本数",
                "L",
            )
        ),

        meet_finish,
        meet_st,
        meet_count,

        ex_time,
        ex_st,

        (
            ex_course
            -
            lane
        )
        if np.isfinite(
            ex_course
        )
        else np.nan,

        num(
            first_value(
                sui,
                "風速(m)",
                "風速",
            )
        ),

        num(
            first_value(
                sui,
                "波の高さ(cm)",
                "波高",
                "波の高さ",
            )
        ),

        num(
            first_value(
                sui,
                "気温(℃)",
                "気温",
            )
        ),

        num(
            first_value(
                sui,
                "水温(℃)",
                "水温",
            )
        ),
    ]

    array = np.asarray(
        values,
        dtype=float,
    )

    if (
        array.shape[0]
        !=
        len(FEATURES)
    ):
        raise RuntimeError(
            "feature length mismatch: "
            f"{array.shape[0]} "
            f"!= {len(FEATURES)}"
        )

    return array


def latest_by_code(df):
    if (
        df is None
        or
        df.empty
        or
        "レースコード"
        not in df.columns
    ):
        return {}

    result = {}

    for _, row in df.iterrows():
        code = str(
            row.get(
                "レースコード",
                "",
            )
        ).strip()

        if code:
            result[code] = row

    return result


def detect_winner(row):
    for name in (
        "1着_艇番",
        "1着艇番",
        "1着_枠",
        "1着枠",
    ):
        if name not in row.index:
            continue

        value = num(
            row.get(name)
        )

        if (
            np.isfinite(value)
            and
            1 <= value <= 6
        ):
            return int(value)

    for lane in range(
        1,
        7,
    ):
        for suffix in (
            "着順",
            "順位",
            "結果",
        ):
            key = (
                f"艇{lane}_"
                f"{suffix}"
            )

            if key not in row.index:
                continue

            value = num(
                row.get(key)
            )

            if (
                np.isfinite(value)
                and
                int(value) == 1
            ):
                return lane

    for column in row.index:
        name = str(column)

        if (
            "1着" not in name
            or
            (
                "艇" not in name
                and
                "枠" not in name
            )
        ):
            continue

        value = num(
            row.get(column)
        )

        if (
            np.isfinite(value)
            and
            1 <= value <= 6
        ):
            return int(value)

    return None


def load_day(day: date):
    kinds = {
        "cards":
            "programs/race_cards",

        "results":
            "results/realtime",

        "stt":
            "previews/stt",

        "tkz":
            "previews/tkz",

        "sui":
            "previews/sui",
    }

    data = {
        name:
            fetch_csv(
                kind,
                day,
            )

        for name, kind
        in kinds.items()
    }

    cards = data["cards"]
    results = data["results"]

    if (
        cards is None
        or
        results is None
    ):
        return (
            day,
            [],
        )

    result_map = latest_by_code(
        results
    )

    stt_map = latest_by_code(
        data["stt"]
    )

    tkz_map = latest_by_code(
        data["tkz"]
    )

    sui_map = latest_by_code(
        data["sui"]
    )

    empty = pd.Series(
        dtype=object
    )

    races = []

    for _, card in cards.iterrows():
        code = str(
            card.get(
                "レースコード",
                "",
            )
        ).strip()

        result = result_map.get(
            code
        )

        if result is None:
            continue

        winner = detect_winner(
            result
        )

        if winner is None:
            continue

        features = np.vstack(
            [
                build_feature(
                    card,
                    stt_map.get(
                        code,
                        empty,
                    ),
                    tkz_map.get(
                        code,
                        empty,
                    ),
                    sui_map.get(
                        code,
                        empty,
                    ),
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
                day.isoformat(),
                features,
                winner - 1,
            )
        )

    return (
        day,
        races,
    )


def collect(
    days: int,
    workers: int,
):
    end = (
        date.today()
        -
        timedelta(
            days=1
        )
    )

    dates = [
        end
        -
        timedelta(
            days=index
        )

        for index
        in range(days)
    ]

    all_races = []

    with ThreadPoolExecutor(
        max_workers=max(
            1,
            workers,
        )
    ) as executor:

        futures = {
            executor.submit(
                load_day,
                target_day,
            ):
                target_day

            for target_day
            in dates
        }

        for future in as_completed(
            futures
        ):
            target_day = futures[
                future
            ]

            try:
                _,
                races = future.result()

                all_races.extend(
                    races
                )

                print(
                    (
                        f"{target_day}: "
                        f"+{len(races)} races "
                        f"/ total="
                        f"{len(all_races)}"
                    ),
                    flush=True,
                )

            except Exception as exc:
                print(
                    (
                        "WARN day failed "
                        f"{target_day}: "
                        f"{exc}"
                    ),
                    flush=True,
                )

    all_races.sort(
        key=lambda item:
            item[0]
    )

    return all_races


def impute_and_scale(
    train_races,
    test_races,
):
    flat = np.vstack(
        [
            race[2]
            for race
            in train_races
        ]
    )

    means = np.nanmean(
        flat,
        axis=0,
    )

    means = np.where(
        np.isfinite(means),
        means,
        0.0,
    )

    filled = np.where(
        np.isfinite(flat),
        flat,
        means,
    )

    scales = np.std(
        filled,
        axis=0,
    )

    scales = np.where(
        scales > 1e-8,
        scales,
        1.0,
    )

    def transform(races):
        output = []

        for (
            code,
            race_date,
            values,
            winner,
        ) in races:

            values = np.where(
                np.isfinite(values),
                values,
                means,
            )

            values = (
                values
                -
                means
            ) / scales

            output.append(
                (
                    code,
                    race_date,
                    values,
                    winner,
                )
            )

        return output

    return (
        transform(
            train_races
        ),
        transform(
            test_races
        ),
        means,
        scales,
    )


def softmax(values):
    centered = (
        values
        -
        np.max(values)
    )

    exp_values = np.exp(
        centered
    )

    return (
        exp_values
        /
        np.sum(exp_values)
    )


def train_conditional_logit(
    races,
    epochs,
    learning_rate,
    l2,
):
    weights = np.zeros(
        len(FEATURES),
        dtype=float,
    )

    first_moment = np.zeros_like(
        weights
    )

    second_moment = np.zeros_like(
        weights
    )

    beta1 = 0.9
    beta2 = 0.999
    epsilon = 1e-8

    random = np.random.default_rng(
        42
    )

    for epoch in range(
        1,
        epochs + 1,
    ):
        gradient = np.zeros_like(
            weights
        )

        loss = 0.0

        order = random.permutation(
            len(races)
        )

        for index in order:
            (
                _,
                _,
                values,
                winner,
            ) = races[index]

            probabilities = softmax(
                values
                @
                weights
            )

            loss -= math.log(
                max(
                    probabilities[
                        winner
                    ],
                    1e-12,
                )
            )

            gradient += (
                probabilities
                @
                values
                -
                values[
                    winner
                ]
            )

        gradient = (
            gradient
            /
            len(races)
            +
            l2
            *
            weights
        )

        loss = (
            loss
            /
            len(races)
            +
            0.5
            *
            l2
            *
            float(
                weights
                @
                weights
            )
        )

        first_moment = (
            beta1
            *
            first_moment
            +
            (
                1
                -
                beta1
            )
            *
            gradient
        )

        second_moment = (
            beta2
            *
            second_moment
            +
            (
                1
                -
                beta2
            )
            *
            (
                gradient
                *
                gradient
            )
        )

        first_corrected = (
            first_moment
            /
            (
                1
                -
                beta1 ** epoch
            )
        )

        second_corrected = (
            second_moment
            /
            (
                1
                -
                beta2 ** epoch
            )
        )

        weights -= (
            learning_rate
            *
            first_corrected
            /
            (
                np.sqrt(
                    second_corrected
                )
                +
                epsilon
            )
        )

        if (
            epoch == 1
            or
            epoch % 50 == 0
            or
            epoch == epochs
        ):
            print(
                (
                    f"epoch="
                    f"{epoch} "
                    f"loss="
                    f"{loss:.6f}"
                ),
                flush=True,
            )

    return weights


def evaluate(
    races,
    weights,
):
    if not races:
        return {}

    hits = 0
    top3 = 0
    loss = 0.0
    brier = 0.0

    for (
        _,
        _,
        values,
        winner,
    ) in races:

        probabilities = softmax(
            values
            @
            weights
        )

        order = np.argsort(
            -probabilities
        )

        hits += int(
            order[0]
            ==
            winner
        )

        top3 += int(
            winner
            in
            order[:3]
        )

        loss -= math.log(
            max(
                probabilities[
                    winner
                ],
                1e-12,
            )
        )

        target = np.zeros(
            6
        )

        target[
            winner
        ] = 1.0

        brier += float(
            np.mean(
                (
                    probabilities
                    -
                    target
                )
                **
                2
            )
        )

    race_count = len(
        races
    )

    return {
        "races":
            race_count,

        "top1Accuracy":
            hits
            /
            race_count,

        "winnerInTop3":
            top3
            /
            race_count,

        "logLoss":
            loss
            /
            race_count,

        "brierScore":
            brier
            /
            race_count,
    }


def main():
    args = parse_args()

    races = collect(
        args.days,
        args.workers,
    )

    if (
        len(races)
        <
        args.min_races
    ):
        raise SystemExit(
            (
                "not enough races: "
                f"{len(races)} "
                "< "
                f"{args.min_races}"
            )
        )

    split = min(
        len(races) - 1,
        max(
            1,
            int(
                len(races)
                *
                0.82
            ),
        ),
    )

    train_raw = races[
        :split
    ]

    test_raw = races[
        split:
    ]

    (
        train_races,
        test_races,
        means,
        scales,
    ) = impute_and_scale(
        train_raw,
        test_raw,
    )

    weights = train_conditional_logit(
        train_races,
        args.epochs,
        args.lr,
        args.l2,
    )

    model = {
        "version":
            "v7-conditional-logit-2",

        "trainedAt":
            datetime.now(
                timezone.utc
            ).isoformat(),

        "lookbackDays":
            args.days,

        "raceCount":
            len(races),

        "trainRaceCount":
            len(train_races),

        "validationRaceCount":
            len(test_races),

        "features":
            FEATURES,

        "mean":
            means.tolist(),

        "scale":
            scales.tolist(),

        "coefficients":
            weights.tolist(),

        "training":
            evaluate(
                train_races,
                weights,
            ),

        "validation":
            evaluate(
                test_races,
                weights,
            ),

        "notes":
            (
                "Chronological split. "
                "Winner conditional-logit model "
                "with race-wise softmax. "
                "Trifecta inference can use "
                "Plackett-Luce ordering."
            ),
    }

    OUT.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    OUT.write_text(
        json.dumps(
            model,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        json.dumps(
            model[
                "validation"
            ],
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()

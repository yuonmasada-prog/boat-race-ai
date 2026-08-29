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


BASE_URL = "https://boatracecsv.github.io/data"
MODEL_PATH = Path("model/model.json")

FEATURES = [
    "lane1",
    "lane2",
    "lane3",
    "lane4",
    "lane5",
    "lane6",
    "grade_a1",
    "grade_a2",
    "grade_b1",
    "grade_b2",
    "avg_st",
    "national_win",
    "national2",
    "national3",
    "local_win",
    "local2",
    "local3",
    "motor2",
    "motor3",
    "boat2",
    "boat3",
    "f_count",
    "l_count",
    "meet_avg_finish",
    "meet_avg_st",
    "meet_count",
    "ex_time",
    "ex_st",
    "ex_course_shift",
    "wind",
    "wave",
    "temperature",
    "water_temperature",
]

HEADERS = {
    "User-Agent": "boat-race-ai-v7.3-trainer",
    "Accept": "text/csv,text/plain,*/*",
}


def parse_args():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--days",
        type=int,
        default=120,
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


def fetch_csv(kind: str, target_date: date):
    url = (
        f"{BASE_URL}/"
        f"{kind}/"
        f"{target_date:%Y/%m/%d}.csv"
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

        text = response.text

        if not text.strip():
            return None

        return pd.read_csv(
            io.StringIO(text),
            dtype=str,
        )

    except Exception as exc:
        print(
            f"WARN fetch {kind} "
            f"{target_date}: {exc}",
            flush=True,
        )

        return None


def number(value):
    if value is None:
        return np.nan

    text = (
        str(value)
        .strip()
        .replace(",", "")
    )

    if (
        not text
        or text.lower() == "nan"
    ):
        return np.nan

    match = re.search(
        r"-?\d+(?:\.\d+)?",
        text,
    )

    if match is None:
        return np.nan

    return float(
        match.group(0)
    )


def first_value(row, names):
    for name in names:
        if name in row.index:
            return row.get(name)

    return None


def boat_value(
    row,
    lane: int,
    names,
):
    for name in names:
        key = f"艇{lane}_{name}"

        if key in row.index:
            return row.get(key)

    return None


def grade_features(value):
    grade = (
        str(value or "")
        .strip()
        .upper()
    )

    return [
        float(grade == "A1"),
        float(grade == "A2"),
        float(grade == "B1"),
        float(grade == "B2"),
    ]


def current_meet_features(
    row,
    lane: int,
):
    finishes = []
    starts = []
    count = 0

    for meet_day in range(1, 8):
        for run in range(1, 3):
            prefix = (
                f"艇{lane}_"
                f"節D{meet_day}"
                f"走{run}_"
            )

            raw_values = [
                row.get(prefix + "R番号"),
                row.get(prefix + "進入"),
                row.get(prefix + "枠"),
                row.get(prefix + "ST"),
                row.get(prefix + "着順"),
            ]

            has_data = any(
                value is not None
                and str(value).strip()
                not in ("", "nan")
                for value in raw_values
            )

            if has_data:
                count += 1

            finish = number(
                row.get(
                    prefix + "着順"
                )
            )

            start = number(
                row.get(
                    prefix + "ST"
                )
            )

            if (
                np.isfinite(finish)
                and 1 <= finish <= 6
            ):
                finishes.append(finish)

            if np.isfinite(start):
                starts.append(start)

    avg_finish = (
        float(np.mean(finishes))
        if finishes
        else np.nan
    )

    avg_start = (
        float(np.mean(starts))
        if starts
        else np.nan
    )

    return (
        avg_finish,
        avg_start,
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
    ) = current_meet_features(
        card,
        lane,
    )

    exhibition_course = number(
        boat_value(
            stt,
            lane,
            ["コース", "進入"],
        )
    )

    exhibition_st = number(
        boat_value(
            stt,
            lane,
            [
                "スタート展示",
                "展示ST",
                "ST",
            ],
        )
    )

    exhibition_time = number(
        boat_value(
            tkz,
            lane,
            ["展示タイム"],
        )
    )

    feature = [
        float(lane == 1),
        float(lane == 2),
        float(lane == 3),
        float(lane == 4),
        float(lane == 5),
        float(lane == 6),

        *grade_features(
            boat_value(
                card,
                lane,
                ["級別", "級"],
            )
        ),

        number(
            boat_value(
                card,
                lane,
                [
                    "全国平均ST",
                    "平均ST",
                ],
            )
        ),

        number(
            boat_value(
                card,
                lane,
                ["全国勝率"],
            )
        ),

        number(
            boat_value(
                card,
                lane,
                [
                    "全国2連対率",
                    "全国2連率",
                ],
            )
        ),

        number(
            boat_value(
                card,
                lane,
                [
                    "全国3連対率",
                    "全国3連率",
                ],
            )
        ),

        number(
            boat_value(
                card,
                lane,
                ["当地勝率"],
            )
        ),

        number(
            boat_value(
                card,
                lane,
                [
                    "当地2連対率",
                    "当地2連率",
                ],
            )
        ),

        number(
            boat_value(
                card,
                lane,
                [
                    "当地3連対率",
                    "当地3連率",
                ],
            )
        ),

        number(
            boat_value(
                card,
                lane,
                [
                    "モーター2連対率",
                    "モーター2連率",
                ],
            )
        ),

        number(
            boat_value(
                card,
                lane,
                [
                    "モーター3連対率",
                    "モーター3連率",
                ],
            )
        ),

        number(
            boat_value(
                card,
                lane,
                [
                    "ボート2連対率",
                    "ボート2連率",
                ],
            )
        ),

        number(
            boat_value(
                card,
                lane,
                [
                    "ボート3連対率",
                    "ボート3連率",
                ],
            )
        ),

        number(
            boat_value(
                card,
                lane,
                ["F本数", "F"],
            )
        ),

        number(
            boat_value(
                card,
                lane,
                ["L本数", "L"],
            )
        ),

        meet_finish,
        meet_st,
        meet_count,

        exhibition_time,
        exhibition_st,

        (
            exhibition_course - lane
            if np.isfinite(
                exhibition_course
            )
            else np.nan
        ),

        number(
            first_value(
                sui,
                ["風速(m)", "風速"],
            )
        ),

        number(
            first_value(
                sui,
                [
                    "波の高さ(cm)",
                    "波高",
                    "波の高さ",
                ],
            )
        ),

        number(
            first_value(
                sui,
                ["気温(℃)", "気温"],
            )
        ),

        number(
            first_value(
                sui,
                ["水温(℃)", "水温"],
            )
        ),
    ]

    array = np.asarray(
        feature,
        dtype=float,
    )

    if len(array) != len(FEATURES):
        raise RuntimeError(
            "feature count mismatch: "
            f"{len(array)} != "
            f"{len(FEATURES)}"
        )

    return array


def rows_by_race_code(df):
    if df is None:
        return {}

    if df.empty:
        return {}

    if "レースコード" not in df.columns:
        return {}

    output = {}

    for row_index in range(len(df)):
        row = df.iloc[row_index]

        code = str(
            row.get(
                "レースコード",
                "",
            )
        ).strip()

        if code:
            output[code] = row

    return output


def detect_winner(row):
    direct_columns = [
        "1着_艇番",
        "1着艇番",
        "1着_枠",
        "1着枠",
    ]

    for column in direct_columns:
        if column not in row.index:
            continue

        value = number(
            row.get(column)
        )

        if (
            np.isfinite(value)
            and 1 <= value <= 6
        ):
            return int(value)

    for lane in range(1, 7):
        for suffix in (
            "着順",
            "順位",
            "結果",
        ):
            column = (
                f"艇{lane}_"
                f"{suffix}"
            )

            if column not in row.index:
                continue

            value = number(
                row.get(column)
            )

            if (
                np.isfinite(value)
                and int(value) == 1
            ):
                return lane

    return None


def load_day(target_date: date):
    cards = fetch_csv(
        "programs/race_cards",
        target_date,
    )

    results = fetch_csv(
        "results/realtime",
        target_date,
    )

    if (
        cards is None
        or results is None
    ):
        return target_date, []

    stt = fetch_csv(
        "previews/stt",
        target_date,
    )

    tkz = fetch_csv(
        "previews/tkz",
        target_date,
    )

    sui = fetch_csv(
        "previews/sui",
        target_date,
    )

    result_map = rows_by_race_code(
        results
    )

    stt_map = rows_by_race_code(
        stt
    )

    tkz_map = rows_by_race_code(
        tkz
    )

    sui_map = rows_by_race_code(
        sui
    )

    empty = pd.Series(
        dtype=object
    )

    races = []

    for card_index in range(
        len(cards)
    ):
        card = cards.iloc[
            card_index
        ]

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

        if result is None:
            continue

        winner = detect_winner(
            result
        )

        if winner is None:
            continue

        lane_features = []

        for lane in range(1, 7):
            lane_features.append(
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
            )

        features = np.vstack(
            lane_features
        )

        races.append(
            (
                code,
                target_date.isoformat(),
                features,
                winner - 1,
            )
        )

    return target_date, races


def collect(
    days: int,
    workers: int,
):
    yesterday = (
        date.today()
        - timedelta(days=1)
    )

    target_dates = [
        yesterday
        - timedelta(days=offset)
        for offset in range(days)
    ]

    all_races = []

    with ThreadPoolExecutor(
        max_workers=max(
            1,
            workers,
        )
    ) as executor:

        futures = {}

        for target_date in target_dates:
            future = executor.submit(
                load_day,
                target_date,
            )

            futures[
                future
            ] = target_date

        for future in as_completed(
            futures
        ):
            requested_date = futures[
                future
            ]

            try:
                result_tuple = (
                    future.result()
                )

                completed_date = (
                    result_tuple[0]
                )

                races = (
                    result_tuple[1]
                )

                all_races.extend(
                    races
                )

                print(
                    f"{completed_date}: "
                    f"+{len(races)} races "
                    f"/ total="
                    f"{len(all_races)}",
                    flush=True,
                )

            except Exception as exc:
                print(
                    f"WARN day failed "
                    f"{requested_date}: "
                    f"{exc}",
                    flush=True,
                )

    all_races.sort(
        key=lambda race:
            (
                race[1],
                race[0],
            )
    )

    return all_races


def smoke_test():
    print(
        "Running real-data smoke test...",
        flush=True,
    )

    yesterday = (
        date.today()
        - timedelta(days=1)
    )

    found = []

    for offset in range(7):
        target_date = (
            yesterday
            - timedelta(days=offset)
        )

        completed_date, races = (
            load_day(
                target_date
            )
        )

        print(
            f"Smoke {completed_date}: "
            f"{len(races)} races",
            flush=True,
        )

        if races:
            found = races
            break

    if not found:
        raise SystemExit(
            "SMOKE TEST FAILED: "
            "no usable completed race "
            "found in previous 7 days"
        )

    first_race = found[0]

    features = first_race[2]

    if features.shape != (
        6,
        len(FEATURES),
    ):
        raise SystemExit(
            "SMOKE TEST FAILED: "
            f"feature shape="
            f"{features.shape}"
        )

    if not (
        0 <= first_race[3] <= 5
    ):
        raise SystemExit(
            "SMOKE TEST FAILED: "
            "invalid winner index"
        )

    print(
        "SMOKE TEST PASSED "
        f"race={first_race[0]} "
        f"shape={features.shape}",
        flush=True,
    )


def impute_and_scale(
    train_r

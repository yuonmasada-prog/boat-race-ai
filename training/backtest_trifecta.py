from __future__ import annotations

import argparse
import io
import json
import re
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import requests


BASE = "https://boatracecsv.github.io/data"
MODEL_PATH = Path("model/model.json")
OUTPUT_PATH = Path("model/backtest.json")

HEADERS = {
    "User-Agent": "boat-race-ai-v8-backtest",
    "Accept": "text/csv,text/plain,*/*",
}


def parse_args():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--days",
        type=int,
        default=30,
    )

    parser.add_argument(
        "--min-races",
        type=int,
        default=500,
    )

    return parser.parse_args()


def load_csv(kind: str, target: date):
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
        io.StringIO(response.text),
        dtype=str,
    )


def number(value):
    match = re.search(
        r"-?\d+(?:\.\d+)?",
        str(value or "").strip(),
    )

    if not match:
        return np.nan

    return float(match.group())


def racer_value(
    row,
    lane,
    names,
):
    for name in names:
        key = f"艇{lane}_{name}"

        if key in row.index:
            return row.get(key)

    return None


def rows_by_code(frame):
    if (
        frame is None
        or frame.empty
        or "レースコード" not in frame
    ):
        return {}

    output = {}

    for _, row in frame.iterrows():
        code = str(
            row.get(
                "レースコード",
                "",
            )
        ).strip()

        if code:
            output[code] = row

    return output


def current_meet_stats(
    card,
    lane,
):
    finishes = []
    starts = []

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

    mean_finish = (
        float(
            np.mean(finishes)
        )
        if finishes
        else np.nan
    )

    mean_start = (
        float(
            np.mean(starts)
        )
        if starts
        else np.nan
    )

    return (
        mean_finish,
        mean_start,
    )


def build_features(
    card,
    lane,
):
    meet_finish, meet_start = (
        current_meet_stats(
            card,
            lane,
        )
    )

    return np.array(
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
                racer_value(
                    card,
                    lane,
                    [
                        "全国平均ST",
                        "平均ST",
                    ],
                )
            ),

            number(
                racer_value(
                    card,
                    lane,
                    [
                        "全国勝率",
                    ],
                )
            ),

            number(
                racer_value(
                    card,
                    lane,
                    [
                        "全国2連対率",
                        "全国2連率",
                    ],
                )
            ),

            number(
                racer_value(
                    card,
                    lane,
                    [
                        "当地勝率",
                    ],
                )
            ),

            number(
                racer_value(
                    card,
                    lane,
                    [
                        "当地2連対率",
                        "当地2連率",
                    ],
                )
            ),

            number(
                racer_value(
                    card,
                    lane,
                    [
                        "モーター2連対率",
                        "モーター2連率",
                    ],
                )
            ),

            number(
                racer_value(
                    card,
                    lane,
                    [
                        "ボート2連対率",
                        "ボート2連率",
                    ],
                )
            ),

            meet_finish,
            meet_start,
        ],
        dtype=float,
    )


def finish_order(row):
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

        position = number(
            row.get(key)
        )

        if (
            np.isfinite(position)
            and 1 <= position <= 6
        ):
            placed.append(
                (
                    int(position),
                    lane,
                )
            )

    if len(placed) >= 3:
        placed.sort()

        return [
            lane
            for _, lane
            in placed[:3]
        ]

    order = []

    for position in (
        1,
        2,
        3,
    ):
        found = None

        possible_keys = [
            f"{position}着_艇番",
            f"{position}着艇番",
            f"{position}着_枠",
            f"{position}着枠",
        ]

        for key in possible_keys:
            if key not in row.index:
                continue

            lane = number(
                row.get(key)
            )

            if (
                np.isfinite(lane)
                and 1 <= lane <= 6
            ):
                found = int(lane)
                break

        if found is None:
            return None

        order.append(found)

    if len(set(order)) != 3:
        return None

    return order


def payout_for(row):
    if row is None:
        return np.nan

    candidates = [
        "3連単_払戻金",
        "3連単払戻金",
        "3連単_払戻",
        "3連単払戻",
    ]

    for key in candidates:
        if key not in row.index:
            continue

        payout = number(
            row.get(key)
        )

        if (
            np.isfinite(payout)
            and payout > 0
        ):
            return float(payout)

    for key in row.index:
        text = str(key)

        if (
            "3連単" not in text
            or (
                "払戻" not in text
                and "配当" not in text
            )
        ):
            continue

        payout = number(
            row.get(key)
        )

        if (
            np.isfinite(payout)
            and payout > 0
        ):
            return float(payout)

    return np.nan


def softmax(scores):
    scores = (
        scores
        - np.max(scores)
    )

    exp_scores = np.exp(
        scores
    )

    return (
        exp_scores
        / np.sum(exp_scores)
    )


def trifecta_probabilities(
    lane_probabilities,
):
    output = {}

    for first in range(6):
        for second in range(6):
            if second == first:
                continue

            for third in range(6):
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

                remaining_after_first = (
                    1.0 - p1
                )

                p2 = (
                    lane_probabilities[
                        second
                    ]
                    /
                    max(
                        remaining_after_first,
                        1e-12,
                    )
                )

                remaining_after_second = (
                    1.0
                    - lane_probabilities[
                        first
                    ]
                    - lane_probabilities[
                        second
                    ]
                )

                p3 = (
                    lane_probabilities[
                        third
                    ]
                    /
                    max(
                        remaining_after_second,
                        1e-12,
                    )
                )

                combination = (
                    f"{first + 1}"
                    f"{second + 1}"
                    f"{third + 1}"
                )

                output[
                    combination
                ] = (
                    p1
                    * p2
                    * p3
                )

    total = sum(
        output.values()
    )

    if total > 0:
        output = {
            key: value / total
            for key, value
            in output.items()
        }

    return output


def venue_from_code(code):
    if len(code) < 12:
        return "??"

    return code[8:10]


def summarize(
    rows,
    top_n,
):
    race_count = 0
    hits = 0

    stake = 0.0
    returns = 0.0

    payout_known = 0

    for row in rows:
        picks = (
            row["ranked"][
                :top_n
            ]
        )

        race_count += 1

        stake += (
            100 * top_n
        )

        if (
            row["actual"]
            in picks
        ):
            hits += 1

            if np.isfinite(
                row["payout"]
            ):
                returns += (
                    row["payout"]
                )

        if np.isfinite(
            row["payout"]
        ):
            payout_known += 1

    return {
        "races":
            race_count,

        "ticketsPerRace":
            top_n,

        "hits":
            hits,

        "hitRate":
            (
                hits / race_count
                if race_count
                else 0.0
            ),

        "stake":
            stake,

        "return":
            returns,

        "roi":
            (
                returns / stake
                if stake
                else 0.0
            ),

        "payoutCoverage":
            (
                payout_known
                / race_count
                if race_count
                else 0.0
            ),
    }


def main():
    config = parse_args()

    model = json.loads(
        MODEL_PATH.read_text(
            encoding="utf-8"
        )
    )

    mean = np.array(
        model["mean"],
        dtype=float,
    )

    scale = np.array(
        model["scale"],
        dtype=float,
    )

    coefficients = np.array(
        model["coefficients"],
        dtype=float,
    )

    if not (
        len(mean)
        == len(scale)
        == len(coefficients)
        == len(model["features"])
    ):
        raise SystemExit(
            "model dimensions do not match"
        )

    end_date = (
        date.today()
        - timedelta(days=1)
    )

    rows = []

    for offset in range(
        config.days
    ):
        target = (
            end_date
            - timedelta(
                days=offset
            )
        )

        try:
            cards = load_csv(
                "programs/race_cards",
                target,
            )

            results = load_csv(
                "results/realtime",
                target,
            )

            payouts = load_csv(
                "results/payouts",
                target,
            )

        except Exception as error:
            print(
                f"WARN {target}: "
                f"{error}",
                flush=True,
            )

            continue

        if (
            cards is None
            or results is None
        ):
            continue

        result_map = (
            rows_by_code(
                results
            )
        )

        payout_map = (
            rows_by_code(
                payouts
            )
        )

        added = 0

        for _, card in (
            cards.iterrows()
        ):
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

            order = (
                finish_order(
                    result
                )
            )

            if not order:
                continue

            feature_matrix = (
                np.vstack(
                    [
                        build_features(
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
            )

            feature_matrix = (
                np.where(
                    np.isfinite(
                        feature_matrix
                    ),
                    feature_matrix,
                    mean,
                )
            )

            normalized = (
                (
                    feature_matrix
                    - mean
                )
                / scale
            )

            lane_scores = (
                normalized
                @ coefficients
            )

            lane_probabilities = (
                softmax(
                    lane_scores
                )
            )

            trifecta = (
                trifecta_probabilities(
                    lane_probabilities
                )
            )

            ranked = [
                combination
                for (
                    combination,
                    _
                )
                in sorted(
                    trifecta.items(),
                    key=lambda item:
                        item[1],
                    reverse=True,
                )
            ]

            actual = "".join(
                map(
                    str,
                    order,
                )
            )

            payout_row = (
                payout_map.get(
                    code
                )
            )

            if payout_row is None:
                payout_row = result

            payout = payout_for(
                payout_row
            )

            actual_rank = (
                ranked.index(
                    actual
                ) + 1
                if actual in ranked
                else None
            )

            rows.append(
                {
                    "code":
                        code,

                    "date":
                        target.isoformat(),

                    "venue":
                        venue_from_code(
                            code
                        ),

                    "actual":
                        actual,

                    "payout":
                        payout,

                    "winnerLane":
                        order[0],

                    "top1":
                        ranked[0],

                    "ranked":
                        ranked,

                    "actualRank":
                        actual_rank,

                    "actualProbability":
                        trifecta.get(
                            actual,
                            0.0,
                        ),
                }
            )

            added += 1

        print(
            f"{target}: "
            f"+{added} "
            f"total={len(rows)}",
            flush=True,
        )

    if (
        len(rows)
        < config.min_races
    ):
        raise SystemExit(
            "not enough races: "
            f"{len(rows)} "
            f"< {config.min_races}"
        )

    venue_groups = (
        defaultdict(list)
    )

    for row in rows:
        venue_groups[
            row["venue"]
        ].append(row)

    actual_ranks = [
        row["actualRank"]
        for row in rows
        if row["actualRank"]
        is not None
    ]

    lane1_winner_rows = [
        row
        for row in rows
        if row["winnerLane"] == 1
    ]

    non_lane1_winner_rows = [
        row
        for row in rows
        if row["winnerLane"] != 1
    ]

    rank_array = np.array(
        actual_ranks,
        dtype=float,
    )

    report = {
        "version":
            "v8-trifecta-backtest-1",

        "modelVersion":
            model.get(
                "version"
            ),

        "days":
            config.days,

        "raceCount":
            len(rows),

        "note":
            (
                "ROI uses official payout "
                "where available and assumes "
                "100 yen per selected ticket. "
                "This evaluates historical "
                "model ranking and does not "
                "prove future profitability."
            ),

        "top1":
            summarize(
                rows,
                1,
            ),

        "top3":
            summarize(
                rows,
                3,
            ),

        "top5":
            summarize(
                rows,
                5,
            ),

        "actualRank": {
            "median":
                float(
                    np.median(
                        rank_array
                    )
                ),

            "mean":
                float(
                    np.mean(
                        rank_array
                    )
                ),

            "within1":
                float(
                    np.mean(
                        rank_array <= 1
                    )
                ),

            "within3":
                float(
                    np.mean(
                        rank_array <= 3
                    )
                ),

            "within5":
                float(
                    np.mean(
                        rank_array <= 5
                    )
                ),

            "within10":
                float(
                    np.mean(
                        rank_array <= 10
                    )
                ),
        },

        "winnerLane1": {
            "raceCount":
                len(
                    lane1_winner_rows
                ),

            "top1":
                summarize(
                    lane1_winner_rows,
                    1,
                ),

            "top3":
                summarize(
                    lane1_winner_rows,
                    3,
                ),
        },

        "winnerNotLane1": {
            "raceCount":
                len(
                    non_lane1_winner_rows
                ),

            "top1":
                summarize(
                    non_lane1_winner_rows,
                    1,
                ),

            "top3":
                summarize(
                    non_lane1_winner_rows,
                    3,
                ),
        },

        "byVenue": {
            venue: {
                "raceCount":
                    len(group),

                "top1":
                    summarize(
                        group,
                        1,
                    ),

                "top3":
                    summarize(
                        group,
                        3,
                    ),
            }

            for venue, group
            in sorted(
                venue_groups.items()
            )

            if len(group) >= 20
        },
    }

    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    OUTPUT_PATH.write_text(
        json.dumps(
            report,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(
        json.dumps(
            report,
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()

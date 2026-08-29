from __future__ import annotations

import argparse
import io
import json
import re
from datetime import date, timedelta
from itertools import permutations
from pathlib import Path

import numpy as np
import pandas as pd
import requests


BASE = "https://boatracecsv.github.io/data"

DEFAULT_MODEL_PATH = Path(
    "model/model.json"
)

DEFAULT_OUTPUT_PATH = Path(
    "model/backtest.json"
)

HEADERS = {
    "User-Agent":
        "boat-race-ai-v8.1-backtest",

    "Accept":
        "text/csv,text/plain,*/*",
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

    parser.add_argument(
        "--model",
        type=str,
        default=str(
            DEFAULT_MODEL_PATH
        ),
    )

    parser.add_argument(
        "--output",
        type=str,
        default=str(
            DEFAULT_OUTPUT_PATH
        ),
    )

    return parser.parse_args()


def load_csv(
    kind,
    target,
):
    url = (
        f"{BASE}/"
        f"{kind}/"
        f"{target:%Y/%m/%d}.csv"
    )

    response = requests.get(
        url,
        headers=HEADERS,
        timeout=25,
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
    match = re.search(
        r"-?\d+(?:\.\d+)?",
        str(
            value
            if value is not None
            else ""
        ),
    )

    if not match:
        return np.nan

    return float(
        match.group()
    )


def racer_value(
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


def rows_by_code(frame):
    if (
        frame is None
        or frame.empty
        or "レースコード"
        not in frame.columns
    ):
        return {}

    result = {}

    for _, row in (
        frame.iterrows()
    ):
        code = str(
            row.get(
                "レースコード",
                "",
            )
        ).strip()

        if code:
            result[code] = row

    return result


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
    (
        meet_finish,
        meet_start,
    ) = current_meet_stats(
        card,
        lane,
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

        order = [
            lane
            for _, lane
            in placed[:3]
        ]

        if len(set(order)) == 3:
            return order

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

        if "3連単" not in text:
            continue

        if (
            "払戻" not in text
            and "配当" not in text
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
    result = {}

    for (
        first,
        second,
        third,
    ) in permutations(
        range(6),
        3,
    ):
        p1 = (
            lane_probabilities[
                first
            ]
        )

        denominator2 = max(
            1.0 - p1,
            1e-12,
        )

        p2 = (
            lane_probabilities[
                second
            ]
            / denominator2
        )

        denominator3 = max(
            1.0
            - lane_probabilities[
                first
            ]
            - lane_probabilities[
                second
            ],
            1e-12,
        )

        p3 = (
            lane_probabilities[
                third
            ]
            / denominator3
        )

        combination = (
            f"{first + 1}"
            f"{second + 1}"
            f"{third + 1}"
        )

        result[combination] = (
            p1 * p2 * p3
        )

    total = sum(
        result.values()
    )

    if total > 0:
        result = {
            key:
                value / total
            for key, value
            in result.items()
        }

    return result


def venue_from_code(code):
    if len(code) < 12:
        return "??"

    return code[8:10]


def normalize_combo(text):
    digits = re.findall(
        r"[1-6]",
        str(text),
    )

    if len(digits) < 3:
        return None

    combo = "".join(
        digits[:3]
    )

    if len(set(combo)) != 3:
        return None

    return combo


def extract_odds(row):
    if row is None:
        return {}

    odds = {}

    for key in row.index:
        key_text = str(key)

        combo = normalize_combo(
            key_text
        )

        if combo is None:
            continue

        value = number(
            row.get(key)
        )

        if (
            np.isfinite(value)
            and value > 1.0
        ):
            odds[combo] = float(
                value
            )

    if len(odds) >= 100:
        return odds

    values = []

    for key in row.index:
        value = number(
            row.get(key)
        )

        if (
            np.isfinite(value)
            and value > 1.0
        ):
            values.append(
                float(value)
            )

    order = [
        "".join(
            map(str, combo)
        )
        for combo
        in permutations(
            range(1, 7),
            3,
        )
    ]

    if len(values) == 120:
        return dict(
            zip(
                order,
                values,
            )
        )

    return odds


def market_probabilities(
    odds,
):
    raw = {}

    for combo, price in (
        odds.items()
    ):
        if price <= 1:
            continue

        raw[combo] = (
            1.0 / price
        )

    total = sum(
        raw.values()
    )

    if total <= 0:
        return {}

    return {
        combo:
            value / total
        for combo, value
        in raw.items()
    }


def blended_probabilities(
    model_probabilities,
    market_probabilities_map,
    model_weight=0.67,
):
    if not market_probabilities_map:
        return dict(
            model_probabilities
        )

    market_weight = (
        1.0 - model_weight
    )

    blended = {}

    for combo, model_p in (
        model_probabilities.items()
    ):
        market_p = (
            market_probabilities_map.get(
                combo
            )
        )

        if (
            market_p is None
            or model_p <= 0
            or market_p <= 0
        ):
            blended[combo] = (
                model_p
            )
            continue

        blended[combo] = (
            model_p
            ** model_weight
        ) * (
            market_p
            ** market_weight
        )

    total = sum(
        blended.values()
    )

    if total <= 0:
        return dict(
            model_probabilities
        )

    return {
        combo:
            value / total
        for combo, value
        in blended.items()
    }


def evaluate_strategy(
    rows,
    strategy,
):
    bets = 0
    races_bet = 0
    hits = 0

    stake = 0.0
    returns = 0.0

    for row in rows:
        selections = strategy(
            row
        )

        if not selections:
            continue

        races_bet += 1

        hit_this_race = False

        for combo in selections:
            bets += 1
            stake += 100.0

            if combo != row["actual"]:
                continue

            hit_this_race = True

            if np.isfinite(
                row["payout"]
            ):
                returns += (
                    row["payout"]
                )

        if hit_this_race:
            hits += 1

    return {
        "racesBet":
            races_bet,

        "tickets":
            bets,

        "hits":
            hits,

        "hitRate":
            (
                hits / races_bet
                if races_bet
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
    }


def top_n_strategy(n):
    def strategy(row):
        return (
            row["ranked"][:n]
        )

    return strategy


def value_strategy(
    edge_threshold,
    min_probability,
    max_tickets,
):
    def strategy(row):
        candidates = []

        for combo, probability in (
            row[
                "blended_probabilities"
            ].items()
        ):
            price = (
                row["odds"].get(
                    combo
                )
            )

            if (
                price is None
                or price <= 1
            ):
                continue

            if (
                probability
                < min_probability
            ):
                continue

            market_implied = (
                1.0 / price
            )

            edge = (
                probability
                - market_implied
            )

            if edge < edge_threshold:
                continue

            score = (
                probability
                * price
            )

            candidates.append(
                (
                    score,
                    combo,
                )
            )

        candidates.sort(
            reverse=True
        )

        return [
            combo
            for _, combo
            in candidates[
                :max_tickets
            ]
        ]

    return strategy


def main():
    config = parse_args()

    model_path = Path(
        config.model
    )

    output_path = Path(
        config.output
    )

    model = json.loads(
        model_path.read_text(
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

    feature_count = len(
        model["features"]
    )

    if not (
        len(mean)
        == len(scale)
        == len(coefficients)
        == feature_count
    ):
        raise SystemExit(
            "model dimensions "
            "do not match"
        )

    model_end_text = (
        model.get(
            "dataEndDate"
        )
    )

    if not model_end_text:
        raise SystemExit(
            "Model does not contain "
            "dataEndDate. "
            "Train v8.1 model first."
        )

    model_end_date = (
        date.fromisoformat(
            model_end_text
        )
    )

    test_end_date = (
        date.today()
        - timedelta(days=1)
    )

    test_start_date = (
        test_end_date
        - timedelta(
            days=config.days - 1
        )
    )

    if (
        model_end_date
        >= test_start_date
    ):
        raise SystemExit(
            "DATA LEAKAGE DETECTED: "
            f"model data ends "
            f"{model_end_date}, "
            f"but test starts "
            f"{test_start_date}. "
            "Train with --end-offset "
            f"{config.days} or greater."
        )

    rows = []

    for offset in range(
        config.days
    ):
        target = (
            test_end_date
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

            odds_frame = load_csv(
                "previews/od3",
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

        result_map = rows_by_code(
            results
        )

        payout_map = rows_by_code(
            payouts
        )

        odds_map = rows_by_code(
            odds_frame
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
                result_map.get(code)
            )

            if result is None:
                continue

            order = finish_order(
                result
            )

            if not order:
                continue

            matrix = np.vstack(
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

            matrix = np.where(
                np.isfinite(matrix),
                matrix,
                mean,
            )

            normalized = (
                (matrix - mean)
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

            model_trifecta = (
                trifecta_probabilities(
                    lane_probabilities
                )
            )

            odds_row = (
                odds_map.get(code)
            )

            odds = extract_odds(
                odds_row
            )

            market = (
                market_probabilities(
                    odds
                )
            )

            blended = (
                blended_probabilities(
                    model_trifecta,
                    market,
                )
            )

            ranked = [
                combo
                for combo, _
                in sorted(
                    blended.items(),
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
                payout_map.get(code)
            )

            if payout_row is None:
                payout_row = result

            payout = payout_for(
                payout_row
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

                    "odds":
                        odds,

                    "model_probabilities":
                        model_trifecta,

                    "market_probabilities":
                        market,

                    "blended_probabilities":
                        blended,

                    "ranked":
                        ranked,
                }
            )

            added += 1

        print(
            f"{target}: "
            f"+{added} races "
            f"total={len(rows)}",
            flush=True,
        )

    if len(rows) < config.min_races:
        raise SystemExit(
            f"not enough test races: "
            f"{len(rows)} "
            f"< {config.min_races}"
        )

    odds_covered = sum(
        bool(row["odds"])
        for row in rows
    )

    top1 = evaluate_strategy(
        rows,
        top_n_strategy(1),
    )

    top3 = evaluate_strategy(
        rows,
        top_n_strategy(3),
    )

    top5 = evaluate_strategy(
        rows,
        top_n_strategy(5),
    )

    candidate_settings = []

    for edge in (
        0.005,
        0.010,
        0.015,
        0.020,
        0.030,
    ):
        for minimum_probability in (
            0.015,
            0.020,
            0.025,
            0.030,
            0.040,
        ):
            for max_tickets in (
                1,
                2,
                3,
            ):
                result = evaluate_strategy(
                    rows,
                    value_strategy(
                        edge,
                        minimum_probability,
                        max_tickets,
                    ),
                )

                candidate_settings.append(
                    {
                        "edgeThreshold":
                            edge,

                        "minProbability":
                            minimum_probability,

                        "maxTickets":
                            max_tickets,

                        **result,
                    }
                )

    eligible = [
        item
        for item
        in candidate_settings
        if item["racesBet"] >= 100
    ]

    if eligible:
        best = max(
            eligible,
            key=lambda item: (
                item["roi"],
                item["hits"],
            ),
        )
    else:
        best = None

    venue_rows = {}

    for row in rows:
        venue_rows.setdefault(
            row["venue"],
            [],
        ).append(row)

    by_venue = {}

    for venue, subset in (
        venue_rows.items()
    ):
        if len(subset) < 20:
            continue

        by_venue[venue] = {
            "races":
                len(subset),

            "top1":
                evaluate_strategy(
                    subset,
                    top_n_strategy(1),
                ),

            "top3":
                evaluate_strategy(
                    subset,
                    top_n_strategy(3),
                ),
        }

    output = {
        "version":
            "v8.1-held-out-odds",

        "modelVersion":
            model.get(
                "version"
            ),

        "modelDataStartDate":
            model.get(
                "dataStartDate"
            ),

        "modelDataEndDate":
            model.get(
                "dataEndDate"
            ),

        "testStartDate":
            test_start_date.isoformat(),

        "testEndDate":
            test_end_date.isoformat(),

        "days":
            config.days,

        "raceCount":
            len(rows),

        "oddsCoverage":
            (
                odds_covered
                / len(rows)
            ),

        "top1":
            top1,

        "top3":
            top3,

        "top5":
            top5,

        "bestValueStrategy":
            best,

        "strategySearch":
            candidate_settings,

        "byVenue":
            by_venue,
    }

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
        json.dumps(
            {
                "version":
                    output["version"],

                "modelVersion":
                    output[
                        "modelVersion"
                    ],

                "modelDataEndDate":
                    output[
                        "modelDataEndDate"
                    ],

                "testStartDate":
                    output[
                        "testStartDate"
                    ],

                "testEndDate":
                    output[
                        "testEndDate"
                    ],

                "raceCount":
                    output[
                        "raceCount"
                    ],

                "oddsCoverage":
                    output[
                        "oddsCoverage"
                    ],

                "top1":
                    top1,

                "top3":
                    top3,

                "top5":
                    top5,

                "bestValueStrategy":
                    best,
            },
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()

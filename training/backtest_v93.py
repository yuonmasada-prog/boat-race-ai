from __future__ import annotations

import argparse
import io
import json
import math
import re
from datetime import date, datetime, timedelta, timezone
from itertools import permutations
from pathlib import Path

import numpy as np
import pandas as pd
import requests


BASE = "https://boatracecsv.github.io/data"

HEADERS = {
    "User-Agent": "boat-race-ai-v9.3-backtest",
    "Accept": "text/csv,text/plain,*/*",
}

ODDS_COLUMN = re.compile(
    r"^3連単[_\s]*"
    r"([1-6])[-‐-‒–—−]"
    r"([1-6])[-‐-‒–—−]"
    r"([1-6])$"
)

FEATURE_NAMES = [
    "confidence",
    "margin",
    "odds_quality",
    "market_gap",
    "lane1_strength",
    "field_spread",
    "meet_quality",
    "venue_prior",
]


def parse_args():
    parser = argparse.ArgumentParser()

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
        "--min-races",
        type=int,
        default=500,
    )

    parser.add_argument(
        "--model",
        default="model/eval-model.json",
    )

    parser.add_argument(
        "--output",
        default="model/backtest-v93.json",
    )

    return parser.parse_args()


def number(value):
    if value is None:
        return np.nan

    text = str(value).replace(",", "").strip()

    match = re.search(
        r"-?\d+(?:\.\d+)?",
        text,
    )

    if not match:
        return np.nan

    return float(match.group())


def load_csv(kind, target):
    url = (
        f"{BASE}/{kind}/"
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
        io.StringIO(response.text),
        dtype=str,
    )


def rows_by_code(frame):
    if (
        frame is None
        or frame.empty
        or "レースコード" not in frame.columns
    ):
        return {}

    output = {}

    for _, row in frame.iterrows():
        code = str(
            row.get("レースコード", "")
        ).strip()

        if code:
            output[code] = row

    return output


def racer_value(row, lane, names):
    for name in names:
        key = f"艇{lane}_{name}"

        if key in row.index:
            return row.get(key)

    return None


def meet_stats(card, lane):
    finishes = []
    starts = []

    for day_no in range(1, 8):
        for run_no in range(1, 3):
            prefix = (
                f"艇{lane}_節D"
                f"{day_no}走{run_no}_"
            )

            finish = number(
                card.get(prefix + "着順")
            )

            start = number(
                card.get(prefix + "ST")
            )

            if (
                np.isfinite(finish)
                and 1 <= finish <= 6
            ):
                finishes.append(finish)

            if np.isfinite(start):
                starts.append(start)

    return (
        float(np.mean(finishes))
        if finishes
        else np.nan,
        float(np.mean(starts))
        if starts
        else np.nan,
    )


def build_features(card, lane):
    meet_finish, meet_start = meet_stats(
        card,
        lane,
    )

    return np.array(
        [
            *[
                float(lane == n)
                for n in range(1, 7)
            ],
            number(
                racer_value(
                    card,
                    lane,
                    ["全国平均ST", "平均ST"],
                )
            ),
            number(
                racer_value(
                    card,
                    lane,
                    ["全国勝率"],
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
                    ["当地勝率"],
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

    for lane in range(1, 7):
        key = f"艇{lane}_着順"

        if key not in row.index:
            continue

        position = number(row.get(key))

        if (
            np.isfinite(position)
            and 1 <= position <= 6
        ):
            placed.append(
                (int(position), lane)
            )

    if len(placed) >= 3:
        placed.sort()

        result = [
            lane
            for _, lane in placed[:3]
        ]

        if len(set(result)) == 3:
            return result

    return None


def payout_for(row):
    if row is None:
        return np.nan

    for key in (
        "3連単_払戻金",
        "3連単払戻金",
        "3連単_払戻",
        "3連単払戻",
    ):
        if key not in row.index:
            continue

        value = number(row.get(key))

        if (
            np.isfinite(value)
            and value > 0
        ):
            return float(value)

    return np.nan


def extract_odds(row):
    if row is None:
        return {}, 0

    odds = {}
    recognized = set()

    for key in row.index:
        match = ODDS_COLUMN.fullmatch(
            str(key).strip()
        )

        if not match:
            continue

        combo = "".join(
            match.groups()
        )

        if len(set(combo)) != 3:
            continue

        recognized.add(combo)

        price = number(row.get(key))

        if (
            np.isfinite(price)
            and price > 1
        ):
            odds[combo] = float(price)

    return odds, len(recognized)


def softmax(scores):
    scores = scores - np.max(scores)

    values = np.exp(scores)

    total = values.sum()

    if total <= 0:
        return np.full(6, 1 / 6)

    return values / total


def trifecta_probabilities(lane_prob):
    probabilities = {}

    for first, second, third in permutations(
        range(6),
        3,
    ):
        p1 = lane_prob[first]

        p2 = (
            lane_prob[second]
            / max(1 - p1, 1e-12)
        )

        p3 = (
            lane_prob[third]
            / max(
                1
                - lane_prob[first]
                - lane_prob[second],
                1e-12,
            )
        )

        combo = (
            f"{first + 1}"
            f"{second + 1}"
            f"{third + 1}"
        )

        probabilities[combo] = (
            p1 * p2 * p3
        )

    total = sum(
        probabilities.values()
    )

    return {
        combo: value / total
        for combo, value
        in probabilities.items()
    }


def market_probabilities(odds):
    raw = {
        combo: 1 / price
        for combo, price in odds.items()
        if price > 1
    }

    total = sum(raw.values())

    if total <= 0:
        return {}

    return {
        combo: value / total
        for combo, value
        in raw.items()
    }


def blend_probabilities(
    model_prob,
    market_prob,
):
    if not market_prob:
        return dict(model_prob)

    output = {}

    for combo, model_p in model_prob.items():
        market_p = market_prob.get(combo)

        if (
            market_p is None
            or market_p <= 0
        ):
            output[combo] = model_p
            continue

        output[combo] = (
            model_p ** 0.67
            * market_p ** 0.33
        )

    total = sum(output.values())

    return {
        combo: value / total
        for combo, value
        in output.items()
    }


def rank_probabilities(probabilities):
    return sorted(
        probabilities.items(),
        key=lambda item: item[1],
        reverse=True,
    )


def venue_from_code(code):
    if len(code) < 10:
        return "??"

    return code[8:10]


def field_metrics(
    lane_probabilities,
    card,
):
    sorted_lane = sorted(
        lane_probabilities,
        reverse=True,
    )

    lane1_strength = float(
        lane_probabilities[0]
    )

    field_spread = float(
        sorted_lane[0]
        - sorted_lane[1]
    )

    meet_values = []

    for lane in range(1, 7):
        finish, _ = meet_stats(
            card,
            lane,
        )

        if np.isfinite(finish):
            meet_values.append(finish)

    if meet_values:
        meet_quality = (
            1.0
            - min(
                max(
                    (
                        np.mean(meet_values)
                        - 1.0
                    ) / 5.0,
                    0.0,
                ),
                1.0,
            )
        )
    else:
        meet_quality = 0.5

    return {
        "lane1_strength":
            lane1_strength,
        "field_spread":
            field_spread,
        "meet_quality":
            float(meet_quality),
    }


def build_race(
    card,
    result,
    payout_row,
    odds_row,
    target,
    mean,
    scale,
    coefficients,
):
    code = str(
        card.get("レースコード", "")
    ).strip()

    order = finish_order(result)

    if not code or not order:
        return None

    matrix = np.vstack(
        [
            build_features(card, lane)
            for lane in range(1, 7)
        ]
    )

    matrix = np.where(
        np.isfinite(matrix),
        matrix,
        mean,
    )

    safe_scale = np.where(
        np.abs(scale) > 1e-12,
        scale,
        1.0,
    )

    normalized = (
        matrix - mean
    ) / safe_scale

    lane_prob = softmax(
        normalized @ coefficients
    )

    model_prob = (
        trifecta_probabilities(
            lane_prob
        )
    )

    odds, column_count = (
        extract_odds(odds_row)
    )

    strict_odds = (
        column_count == 120
    )

    if not strict_odds:
        odds = {}

    market_prob = (
        market_probabilities(odds)
    )

    blended = blend_probabilities(
        model_prob,
        market_prob,
    )

    ranked = rank_probabilities(
        blended
    )

    if not ranked:
        return None

    main_combo, main_p = ranked[0]

    second_p = (
        ranked[1][1]
        if len(ranked) > 1
        else 0.0
    )

    main_odds = odds.get(
        main_combo,
        np.nan,
    )

    market_main = market_prob.get(
        main_combo,
        0.0,
    )

    margin = max(
        main_p - second_p,
        0.0,
    )

    odds_quality = 0.0

    if np.isfinite(main_odds):
        # 低すぎる配当も極端な高配当も
        # 購入スコアを下げる。
        log_odds = math.log(
            max(main_odds, 1.01)
        )

        ideal = math.log(15.0)

        distance = abs(
            log_odds - ideal
        )

        odds_quality = max(
            0.0,
            1.0 - distance / 3.5,
        )

    market_gap = max(
        main_p - market_main,
        0.0,
    )

    field = field_metrics(
        lane_prob,
        card,
    )

    actual = "".join(
        map(str, order)
    )

    return {
        "code":
            code,
        "date":
            target.isoformat(),
        "venue":
            venue_from_code(code),
        "actual":
            actual,
        "payout":
            payout_for(
                payout_row
                if payout_row is not None
                else result
            ),
        "odds":
            odds,
        "strictOddsOk":
            strict_odds,
        "prediction": {
            "main":
                ranked[0][0],
            "second":
                (
                    ranked[1][0]
                    if len(ranked) > 1
                    else None
                ),
            "third":
                (
                    ranked[2][0]
                    if len(ranked) > 2
                    else None
                ),
        },
        "blended":
            blended,
        "model":
            model_prob,
        "market":
            market_prob,
        "rawScoreFeatures": {
            "confidence":
                float(main_p),
            "margin":
                float(margin),
            "odds_quality":
                float(odds_quality),
            "market_gap":
                float(market_gap),
            "lane1_strength":
                field[
                    "lane1_strength"
                ],
            "field_spread":
                field[
                    "field_spread"
                ],
            "meet_quality":
                field[
                    "meet_quality"
                ],
        },
    }


def collect_period(
    start,
    end,
    mean,
    scale,
    coefficients,
):
    races = []

    target = start

    while target <= end:
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
            odds = load_csv(
                "previews/od3",
                target,
            )

        except Exception as exc:
            print(
                f"WARN {target}: {exc}",
                flush=True,
            )
            target += timedelta(days=1)
            continue

        if cards is None or results is None:
            target += timedelta(days=1)
            continue

        result_map = rows_by_code(results)
        payout_map = rows_by_code(payouts)
        odds_map = rows_by_code(odds)

        added = 0

        for _, card in cards.iterrows():
            code = str(
                card.get(
                    "レースコード",
                    "",
                )
            ).strip()

            result = result_map.get(code)

            if result is None:
                continue

            race = build_race(
                card,
                result,
                payout_map.get(code),
                odds_map.get(code),
                target,
                mean,
                scale,
                coefficients,
            )

            if race is not None:
                races.append(race)
                added += 1

        print(
            f"{target}: +{added} "
            f"total={len(races)}",
            flush=True,
        )

        target += timedelta(days=1)

    return races


def venue_statistics(rows):
    stats = {}

    for row in rows:
        venue = row["venue"]

        item = stats.setdefault(
            venue,
            {
                "races": 0,
                "mainHits": 0,
            },
        )

        item["races"] += 1

        if (
            row["prediction"]["main"]
            == row["actual"]
        ):
            item["mainHits"] += 1

    total_races = len(rows)

    total_hits = sum(
        item["mainHits"]
        for item in stats.values()
    )

    global_rate = (
        total_hits / total_races
        if total_races
        else 0.0
    )

    output = {}

    # 会場特性は「買う/買わない」ではなく
    # 0〜1の弱い連続値として使う。
    prior_strength = 200.0

    for venue, item in stats.items():
        races = item["races"]
        hits = item["mainHits"]

        shrunk_rate = (
            hits
            + prior_strength * global_rate
        ) / (
            races + prior_strength
        )

        if global_rate > 0:
            ratio = (
                shrunk_rate / global_rate
            )
        else:
            ratio = 1.0

        # 0.25〜0.75に圧縮。
        # 会場だけで購入判定が決まらない。
        normalized = (
            0.5
            + 0.25
            * math.tanh(
                (ratio - 1.0) * 2.0
            )
        )

        output[venue] = {
            "races":
                races,
            "mainHits":
                hits,
            "rawMainHitRate":
                (
                    hits / races
                    if races
                    else 0.0
                ),
            "shrunkMainHitRate":
                shrunk_rate,
            "score":
                normalized,
        }

    return output, global_rate


def normalize_feature(
    value,
    low,
    high,
):
    if high <= low:
        return 0.5

    result = (
        value - low
    ) / (
        high - low
    )

    return float(
        min(
            max(result, 0.0),
            1.0,
        )
    )


def feature_ranges(rows):
    ranges = {}

    for name in FEATURE_NAMES:
        if name == "venue_prior":
            continue

        values = [
            row[
                "rawScoreFeatures"
            ][name]
            for row in rows
            if np.isfinite(
                row[
                    "rawScoreFeatures"
                ][name]
            )
        ]

        if not values:
            ranges[name] = (
                0.0,
                1.0,
            )
            continue

        low = float(
            np.quantile(
                values,
                0.10,
            )
        )

        high = float(
            np.quantile(
                values,
                0.90,
            )
        )

        ranges[name] = (
            low,
            high,
        )

    return ranges


def attach_scores(
    rows,
    ranges,
    venue_stats,
    weights,
):
    for row in rows:
        raw = row[
            "rawScoreFeatures"
        ]

        normalized = {}

        for name in (
            "confidence",
            "margin",
            "odds_quality",
            "market_gap",
            "lane1_strength",
            "field_spread",
            "meet_quality",
        ):
            low, high = ranges[name]

            normalized[name] = (
                normalize_feature(
                    raw[name],
                    low,
                    high,
                )
            )

        venue = venue_stats.get(
            row["venue"]
        )

        normalized[
            "venue_prior"
        ] = (
            venue["score"]
            if venue
            else 0.5
        )

        weighted = 0.0
        weight_sum = 0.0

        for name, weight in weights.items():
            weighted += (
                normalized[name]
                * weight
            )
            weight_sum += weight

        score = (
            100.0
            * weighted
            / weight_sum
            if weight_sum
            else 0.0
        )

        row["purchaseScore"] = float(
            score
        )

        row["scoreFeatures"] = (
            normalized
        )


def prediction_accuracy(rows):
    top1 = 0
    top3 = 0
    top5 = 0

    for row in rows:
        ranked = [
            combo
            for combo, _
            in rank_probabilities(
                row["blended"]
            )
        ]

        actual = row["actual"]

        top1 += int(
            actual in ranked[:1]
        )
        top3 += int(
            actual in ranked[:3]
        )
        top5 += int(
            actual in ranked[:5]
        )

    count = len(rows)

    return {
        "races":
            count,
        "top1HitRate":
            top1 / count
            if count else 0.0,
        "top3HitRate":
            top3 / count
            if count else 0.0,
        "top5HitRate":
            top5 / count
            if count else 0.0,
    }


def evaluate_threshold(
    rows,
    threshold,
    max_tickets,
):
    races_bet = 0
    hits = 0
    tickets = 0

    stake = 0.0
    returns = 0.0

    for row in rows:
        if (
            not row["strictOddsOk"]
            or row["purchaseScore"]
            < threshold
        ):
            continue

        ranked = [
            combo
            for combo, _
            in rank_probabilities(
                row["blended"]
            )
            if combo in row["odds"]
        ]

        selections = (
            ranked[:max_tickets]
        )

        if not selections:
            continue

        races_bet += 1

        race_hit = False

        for combo in selections:
            tickets += 1
            stake += 100.0

            if combo == row["actual"]:
                race_hit = True

                if np.isfinite(
                    row["payout"]
                ):
                    returns += (
                        row["payout"]
                    )

        if race_hit:
            hits += 1

    total = len(rows)

    return {
        "totalRaces":
            total,
        "racesBet":
            races_bet,
        "skippedRaces":
            total - races_bet,
        "betRate":
            races_bet / total
            if total else 0.0,
        "skipRate":
            (
                total - races_bet
            ) / total
            if total else 0.0,
        "tickets":
            tickets,
        "hits":
            hits,
        "hitRate":
            hits / races_bet
            if races_bet else 0.0,
        "stake":
            stake,
        "return":
            returns,
        "profit":
            returns - stake,
        "roi":
            returns / stake
            if stake else 0.0,
    }


def weight_sets():
    """
    validationだけで比較する小さな候補群。

    venueの重みは最大0.10。
    会場だけで買い目を決めない。
    """

    return [
        {
            "confidence": 0.25,
            "margin": 0.15,
            "odds_quality": 0.15,
            "market_gap": 0.15,
            "lane1_strength": 0.10,
            "field_spread": 0.10,
            "meet_quality": 0.05,
            "venue_prior": 0.05,
        },
        {
            "confidence": 0.30,
            "margin": 0.15,
            "odds_quality": 0.10,
            "market_gap": 0.15,
            "lane1_strength": 0.10,
            "field_spread": 0.10,
            "meet_quality": 0.05,
            "venue_prior": 0.05,
        },
        {
            "confidence": 0.25,
            "margin": 0.10,
            "odds_quality": 0.20,
            "market_gap": 0.15,
            "lane1_strength": 0.10,
            "field_spread": 0.10,
            "meet_quality": 0.05,
            "venue_prior": 0.05,
        },
        {
            "confidence": 0.25,
            "margin": 0.15,
            "odds_quality": 0.15,
            "market_gap": 0.20,
            "lane1_strength": 0.05,
            "field_spread": 0.10,
            "meet_quality": 0.05,
            "venue_prior": 0.05,
        },
    ]


def select_strategy(
    validation_rows,
    ranges,
    venue_stats,
):
    candidates = []

    minimum_bets = max(
        100,
        int(
            len(validation_rows)
            * 0.08
        ),
    )

    for weights in weight_sets():
        attach_scores(
            validation_rows,
            ranges,
            venue_stats,
            weights,
        )

        for threshold in (
            55,
            60,
            65,
            70,
            72,
            75,
            78,
            80,
            82,
            85,
        ):
            for max_tickets in (
                1,
                2,
            ):
                result = (
                    evaluate_threshold(
                        validation_rows,
                        threshold,
                        max_tickets,
                    )
                )

                candidate = {
                    "weights":
                        weights,
                    "threshold":
                        threshold,
                    "maxTickets":
                        max_tickets,
                    **result,
                }

                candidates.append(
                    candidate
                )

    eligible = [
        item
        for item in candidates
        if (
            item["racesBet"]
            >= minimum_bets
            and item["betRate"]
            >= 0.08
        )
    ]

    if not eligible:
        raise SystemExit(
            "No v9.3 strategy "
            "met validation sample limits."
        )

    # ROIだけを極端に最大化すると
    # validationへの過適合が起きやすい。
    #
    # ROI + サンプル安定性を評価。
    for item in eligible:
        sample_factor = min(
            item["racesBet"]
            / 500.0,
            1.0,
        )

        item[
            "selectionScore"
        ] = (
            item["roi"]
            * (
                0.75
                + 0.25
                * sample_factor
            )
        )

    best = max(
        eligible,
        key=lambda item: (
            item[
                "selectionScore"
            ],
            item["roi"],
            item["profit"],
        ),
    )

    return best, candidates


def score_distribution(rows):
    values = [
        row["purchaseScore"]
        for row in rows
    ]

    if not values:
        return {}

    return {
        "min":
            float(np.min(values)),
        "p25":
            float(
                np.quantile(
                    values,
                    0.25,
                )
            ),
        "median":
            float(np.median(values)),
        "p75":
            float(
                np.quantile(
                    values,
                    0.75,
                )
            ),
        "p90":
            float(
                np.quantile(
                    values,
                    0.90,
                )
            ),
        "max":
            float(np.max(values)),
    }


def main():
    args = parse_args()

    model_path = Path(args.model)

    if not model_path.exists():
        raise SystemExit(
            f"Model not found: "
            f"{model_path}"
        )

    model = json.loads(
        model_path.read_text(
            encoding="utf-8"
        )
    )

    if (
        model.get("mode")
        != "evaluation"
    ):
        raise SystemExit(
            "v9.3 backtest requires "
            "evaluation model"
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

    test_end = (
        date.today()
        - timedelta(days=1)
    )

    test_start = (
        test_end
        - timedelta(
            days=args.test_days - 1
        )
    )

    validation_end = (
        test_start
        - timedelta(days=1)
    )

    validation_start = (
        validation_end
        - timedelta(
            days=(
                args.validation_days - 1
            )
        )
    )

    model_end = date.fromisoformat(
        model["dataEndDate"]
    )

    if model_end >= validation_start:
        raise SystemExit(
            "DATA LEAKAGE: "
            f"model={model_end}, "
            f"validation="
            f"{validation_start}"
        )

    print(
        "=== BOAT RACE AI v9.3 ===",
        flush=True,
    )

    print(
        f"model: {model_end}",
        flush=True,
    )

    print(
        "validation: "
        f"{validation_start} "
        f"-> {validation_end}",
        flush=True,
    )

    print(
        "final test: "
        f"{test_start} "
        f"-> {test_end}",
        flush=True,
    )

    validation_rows = collect_period(
        validation_start,
        validation_end,
        mean,
        scale,
        coefficients,
    )

    test_rows = collect_period(
        test_start,
        test_end,
        mean,
        scale,
        coefficients,
    )

    if (
        len(validation_rows)
        < args.min_races
    ):
        raise SystemExit(
            "Too few validation races"
        )

    if len(test_rows) < args.min_races:
        raise SystemExit(
            "Too few test races"
        )

    # ここから先、購入条件は
    # validationだけで作る。
    ranges = feature_ranges(
        validation_rows
    )

    venue_stats, global_hit_rate = (
        venue_statistics(
            validation_rows
        )
    )

    best, search = select_strategy(
        validation_rows,
        ranges,
        venue_stats,
    )

    frozen_weights = best["weights"]

    # final testにvalidationで決めた
    # 正規化範囲・会場prior・重みを固定適用。
    attach_scores(
        test_rows,
        ranges,
        venue_stats,
        frozen_weights,
    )

    # validation側も最終設定で再計算。
    attach_scores(
        validation_rows,
        ranges,
        venue_stats,
        frozen_weights,
    )

    final_result = evaluate_threshold(
        test_rows,
        best["threshold"],
        best["maxTickets"],
    )

    validation_result = (
        evaluate_threshold(
            validation_rows,
            best["threshold"],
            best["maxTickets"],
        )
    )

    validation_prediction = (
        prediction_accuracy(
            validation_rows
        )
    )

    test_prediction = (
        prediction_accuracy(
            test_rows
        )
    )

    strict_validation = sum(
        row["strictOddsOk"]
        for row in validation_rows
    ) / len(validation_rows)

    strict_test = sum(
        row["strictOddsOk"]
        for row in test_rows
    ) / len(test_rows)

    output = {
        "version":
            "v9.3-continuous-purchase-score",

        "generatedAt":
            datetime.now(
                timezone.utc
            ).isoformat(),

        "modelVersion":
            model.get("version"),

        "modelDataStartDate":
            model.get(
                "dataStartDate"
            ),

        "modelDataEndDate":
            model.get(
                "dataEndDate"
            ),

        "design": {
            "predictEveryRace":
                True,

            "predictWhenSkipped":
                True,

            "venueHardFilter":
                False,

            "venueContinuousPrior":
                True,

            "purchaseScoreRange":
                "0-100",

            "strategySelectedOn":
                "validation only",

            "finalTestFrozen":
                True,

            "probabilitiesCalibrated":
                False,
        },

        "validation": {
            "startDate":
                validation_start.isoformat(),

            "endDate":
                validation_end.isoformat(),

            "days":
                args.validation_days,

            "raceCount":
                len(validation_rows),

            "strictOddsCoverage":
                strict_validation,

            "prediction":
                validation_prediction,

            "purchase":
                validation_result,

            "scoreDistribution":
                score_distribution(
                    validation_rows
                ),
        },

        "finalTest": {
            "startDate":
                test_start.isoformat(),

            "endDate":
                test_end.isoformat(),

            "days":
                args.test_days,

            "raceCount":
                len(test_rows),

            "strictOddsCoverage":
                strict_test,

            "prediction":
                test_prediction,

            "purchase":
                final_result,

            "scoreDistribution":
                score_distribution(
                    test_rows
                ),
        },

        "frozenStrategy": {
            "threshold":
                best["threshold"],

            "maxTickets":
                best["maxTickets"],

            "weights":
                frozen_weights,

            "featureRanges":
                {
                    key: [
                        float(value[0]),
                        float(value[1]),
                    ]
                    for key, value
                    in ranges.items()
                },

            "venuePrior":
                venue_stats,

            "validationGlobalMainHitRate":
                global_hit_rate,
        },

        "validationSearch":
            search,

        "scoreMeaning": {
            "0-54":
                "prediction only / skip",

            "55-69":
                "weak purchase candidate",

            "70-79":
                "purchase candidate",

            "80-100":
                "strong purchase candidate",
        },

        "important":
            (
                "Purchase score is a ranking "
                "score, not a calibrated "
                "probability or guaranteed EV."
            ),
    }

    output_path = Path(args.output)

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
        "\n=== V9.3 RESULT ===",
        flush=True,
    )

    print(
        json.dumps(
            {
                "predictionAllRaces":
                    test_prediction,

                "threshold":
                    best[
                        "threshold"
                    ],

                "maxTickets":
                    best[
                        "maxTickets"
                    ],

                "validationPurchase":
                    validation_result,

                "finalPurchase":
                    final_result,

                "scoreDistribution":
                    score_distribution(
                        test_rows
                    ),
            },
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()

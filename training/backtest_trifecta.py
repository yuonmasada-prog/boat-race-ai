from __future__ import annotations

import argparse
import io
import json
import re
from datetime import date, datetime, timedelta, timezone
from itertools import permutations
from pathlib import Path

import numpy as np
import pandas as pd
import requests


BASE = "https://boatracecsv.github.io/data"

DEFAULT_MODEL_PATH = Path("model/model.json")
DEFAULT_OUTPUT_PATH = Path("model/backtest.json")

HEADERS = {
    "User-Agent": "boat-race-ai-v9.2-backtest",
    "Accept": "text/csv,text/plain,*/*",
}

ODDS_COLUMN = re.compile(
    r"^3連単[_\s]*"
    r"([1-6])"
    r"[-‐-‒–—−]"
    r"([1-6])"
    r"[-‐-‒–—−]"
    r"([1-6])$"
)

ALL_COMBOS = [
    "".join(map(str, combo))
    for combo in permutations(range(1, 7), 3)
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

    # 旧workflow互換。
    parser.add_argument(
        "--days",
        type=int,
        default=None,
    )

    parser.add_argument(
        "--min-races",
        type=int,
        default=500,
    )

    parser.add_argument(
        "--model",
        type=str,
        default=str(DEFAULT_MODEL_PATH),
    )

    parser.add_argument(
        "--output",
        type=str,
        default=str(DEFAULT_OUTPUT_PATH),
    )

    return parser.parse_args()


def load_csv(kind, target):
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
        io.StringIO(response.text),
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

    return float(match.group())


def racer_value(row, lane, names):
    for name in names:
        key = f"艇{lane}_{name}"

        if key in row.index:
            return row.get(key)

    return None


def rows_by_code(frame):
    if (
        frame is None
        or frame.empty
        or "レースコード" not in frame.columns
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


def current_meet_stats(card, lane):
    finishes = []
    starts = []

    for day_number in range(1, 8):
        for run_number in range(1, 3):
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
    meet_finish, meet_start = (
        current_meet_stats(
            card,
            lane,
        )
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

    for position in (1, 2, 3):
        found = None

        for key in (
            f"{position}着_艇番",
            f"{position}着艇番",
            f"{position}着_枠",
            f"{position}着枠",
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

    for key in (
        "3連単_払戻金",
        "3連単払戻金",
        "3連単_払戻",
        "3連単払戻",
    ):
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

    return np.nan


def softmax(scores):
    scores = (
        scores
        - np.max(scores)
    )

    exp_scores = np.exp(scores)

    total = np.sum(exp_scores)

    if total <= 0:
        return np.full(
            len(scores),
            1.0 / len(scores),
        )

    return (
        exp_scores
        / total
    )


def trifecta_probabilities(
    lane_probabilities,
):
    result = {}

    for first, second, third in permutations(
        range(6),
        3,
    ):
        p1 = lane_probabilities[first]

        denominator2 = max(
            1.0 - p1,
            1e-12,
        )

        p2 = (
            lane_probabilities[second]
            / denominator2
        )

        denominator3 = max(
            1.0
            - lane_probabilities[first]
            - lane_probabilities[second],
            1e-12,
        )

        p3 = (
            lane_probabilities[third]
            / denominator3
        )

        combo = (
            f"{first + 1}"
            f"{second + 1}"
            f"{third + 1}"
        )

        result[combo] = (
            p1 * p2 * p3
        )

    total = sum(
        result.values()
    )

    if total > 0:
        result = {
            combo: probability / total
            for combo, probability
            in result.items()
        }

    return result


def venue_from_code(code):
    if len(code) < 12:
        return "??"

    return code[8:10]


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

        combo = (
            match.group(1)
            + match.group(2)
            + match.group(3)
        )

        if len(set(combo)) != 3:
            continue

        recognized.add(combo)

        value = number(
            row.get(key)
        )

        if (
            np.isfinite(value)
            and value > 1.0
        ):
            odds[combo] = float(value)

    return odds, len(recognized)


def market_probabilities(odds):
    raw = {}

    for combo, price in odds.items():
        if price <= 1:
            continue

        raw[combo] = (
            1.0 / price
        )

    total = sum(raw.values())

    if total <= 0:
        return {}

    return {
        combo: value / total
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
            blended[combo] = model_p
            continue

        blended[combo] = (
            model_p ** model_weight
        ) * (
            market_p ** market_weight
        )

    total = sum(
        blended.values()
    )

    if total <= 0:
        return dict(
            model_probabilities
        )

    return {
        combo: value / total
        for combo, value
        in blended.items()
    }


def rank_probabilities(probabilities):
    return sorted(
        probabilities.items(),
        key=lambda item: item[1],
        reverse=True,
    )


def prediction_report(rows):
    """
    購入する・しないに関係なく、
    全レースを必ず予想した場合の精度。
    """

    top1_hits = 0
    top3_hits = 0
    top5_hits = 0

    for row in rows:
        ranked = [
            combo
            for combo, _
            in rank_probabilities(
                row[
                    "blended_probabilities"
                ]
            )
        ]

        actual = row["actual"]

        top1_hits += int(
            actual in ranked[:1]
        )

        top3_hits += int(
            actual in ranked[:3]
        )

        top5_hits += int(
            actual in ranked[:5]
        )

    count = len(rows)

    return {
        "races": count,

        "top1Hits":
            top1_hits,

        "top1HitRate":
            (
                top1_hits / count
                if count
                else 0.0
            ),

        "top3Hits":
            top3_hits,

        "top3HitRate":
            (
                top3_hits / count
                if count
                else 0.0
            ),

        "top5Hits":
            top5_hits,

        "top5HitRate":
            (
                top5_hits / count
                if count
                else 0.0
            ),
    }


def race_candidates(
    row,
    min_probability,
    min_top_probability,
    max_odds,
    max_tickets,
):
    probabilities = (
        row[
            "blended_probabilities"
        ]
    )

    odds = row["odds"]

    candidates = []

    for combo, probability in (
        probabilities.items()
    ):
        price = odds.get(combo)

        if (
            price is None
            or price <= 1
            or price > max_odds
        ):
            continue

        if (
            probability
            < min_probability
        ):
            continue

        score = (
            probability
            * min(
                np.sqrt(price),
                7.0,
            )
        )

        candidates.append(
            (
                score,
                probability,
                combo,
            )
        )

    candidates.sort(
        reverse=True
    )

    if not candidates:
        return []

    if (
        candidates[0][1]
        < min_top_probability
    ):
        return []

    return [
        combo
        for _, _, combo
        in candidates[:max_tickets]
    ]


def evaluate_purchase_strategy(
    rows,
    settings,
    allowed_venues=None,
):
    races_bet = 0
    tickets = 0
    hits = 0

    stake = 0.0
    returns = 0.0

    venue_filtered = 0
    confidence_filtered = 0

    for row in rows:
        if (
            allowed_venues is not None
            and row["venue"]
            not in allowed_venues
        ):
            venue_filtered += 1
            continue

        selections = race_candidates(
            row=row,
            min_probability=(
                settings[
                    "minProbability"
                ]
            ),
            min_top_probability=(
                settings[
                    "minTopProbability"
                ]
            ),
            max_odds=(
                settings[
                    "maxOdds"
                ]
            ),
            max_tickets=(
                settings[
                    "maxTickets"
                ]
            ),
        )

        if not selections:
            confidence_filtered += 1
            continue

        races_bet += 1

        hit_this_race = False

        for combo in selections:
            tickets += 1
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

    count = len(rows)

    return {
        "totalRaces":
            count,

        "racesBet":
            races_bet,

        "skippedRaces":
            count - races_bet,

        "betRate":
            (
                races_bet / count
                if count
                else 0.0
            ),

        "skipRate":
            (
                (
                    count - races_bet
                ) / count
                if count
                else 0.0
            ),

        "venueFiltered":
            venue_filtered,

        "confidenceFiltered":
            confidence_filtered,

        "tickets":
            tickets,

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

        "profit":
            returns - stake,

        "roi":
            (
                returns / stake
                if stake
                else 0.0
            ),
    }


def strategy_grid():
    for min_probability in (
        0.015,
        0.018,
        0.020,
        0.025,
        0.030,
        0.035,
    ):
        for min_top_probability in (
            0.040,
            0.050,
            0.060,
            0.070,
            0.080,
        ):
            for max_odds in (
                30.0,
                50.0,
                70.0,
            ):
                for max_tickets in (
                    1,
                    2,
                ):
                    yield {
                        "minProbability":
                            min_probability,

                        "minTopProbability":
                            min_top_probability,

                        "maxOdds":
                            max_odds,

                        "maxTickets":
                            max_tickets,
                    }


def evaluate_by_venue(
    rows,
    settings,
):
    groups = {}

    for row in rows:
        groups.setdefault(
            row["venue"],
            [],
        ).append(row)

    output = {}

    for venue, subset in groups.items():
        result = (
            evaluate_purchase_strategy(
                subset,
                settings,
            )
        )

        output[venue] = {
            "races":
                len(subset),

            **result,
        }

    return output


def shrunk_venue_roi(
    venue_result,
    global_roi,
    shrinkage_bets=150,
):
    """
    少数レースの偶然の高ROIをそのまま信用しない。

    例:
    venue購入数50なら
    会場実績25% + 全体実績75%程度。

    購入数が増えるほど
    会場固有ROIを強く反映する。
    """

    bets = (
        venue_result[
            "racesBet"
        ]
    )

    if bets <= 0:
        return global_roi

    weight = (
        bets
        / (
            bets
            + shrinkage_bets
        )
    )

    return (
        weight
        * venue_result["roi"]
        + (
            1.0 - weight
        )
        * global_roi
    )


def derive_allowed_venues(
    validation_rows,
    settings,
    min_shrunk_roi,
):
    global_result = (
        evaluate_purchase_strategy(
            validation_rows,
            settings,
        )
    )

    venue_results = (
        evaluate_by_venue(
            validation_rows,
            settings,
        )
    )

    allowed = []
    detail = {}

    for venue, result in (
        venue_results.items()
    ):
        shrunk_roi = (
            shrunk_venue_roi(
                result,
                global_result["roi"],
            )
        )

        # validationで最低30購入未満の場は、
        # 会場別判断の根拠が弱すぎるので
        # 全体判定に依存させる。
        enough_samples = (
            result["racesBet"] >= 30
        )

        accepted = (
            enough_samples
            and shrunk_roi
            >= min_shrunk_roi
        )

        if accepted:
            allowed.append(
                venue
            )

        detail[venue] = {
            **result,

            "shrunkRoi":
                shrunk_roi,

            "enoughSamples":
                enough_samples,

            "allowed":
                accepted,
        }

    return (
        sorted(allowed),
        detail,
        global_result,
    )


def choose_strategy(
    validation_rows,
):
    search_results = []

    minimum_bet_races = max(
        80,
        int(
            len(validation_rows)
            * 0.05
        ),
    )

    for settings in strategy_grid():
        for min_shrunk_roi in (
            0.75,
            0.85,
            0.90,
            0.95,
        ):
            (
                allowed_venues,
                venue_detail,
                global_result,
            ) = derive_allowed_venues(
                validation_rows,
                settings,
                min_shrunk_roi,
            )

            if not allowed_venues:
                continue

            filtered_result = (
                evaluate_purchase_strategy(
                    validation_rows,
                    settings,
                    allowed_venues=set(
                        allowed_venues
                    ),
                )
            )

            candidate = {
                **settings,

                "venueMinShrunkRoi":
                    min_shrunk_roi,

                "allowedVenues":
                    allowed_venues,

                "globalBeforeVenueFilter":
                    global_result,

                "venueValidation":
                    venue_detail,

                **filtered_result,
            }

            search_results.append(
                candidate
            )

    eligible = [
        item
        for item in search_results
        if (
            item["racesBet"]
            >= minimum_bet_races
            and item["betRate"]
            >= 0.03
        )
    ]

    if not eligible:
        return None, search_results

    # validation ROIを主評価。
    # 同率なら利益 → 的中数 → 購入数。
    best = max(
        eligible,
        key=lambda item: (
            item["roi"],
            item["profit"],
            item["hits"],
            item["racesBet"],
        ),
    )

    return best, search_results


def build_row(
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
        card.get(
            "レースコード",
            "",
        )
    ).strip()

    if not code:
        return None

    order = finish_order(
        result
    )

    if not order:
        return None

    matrix = np.vstack(
        [
            build_features(
                card,
                lane,
            )
            for lane in range(
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

    safe_scale = np.where(
        np.abs(scale) > 1e-12,
        scale,
        1.0,
    )

    normalized = (
        (matrix - mean)
        / safe_scale
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

    odds, odds_column_count = (
        extract_odds(
            odds_row
        )
    )

    strict_odds_ok = (
        odds_column_count == 120
    )

    if not strict_odds_ok:
        odds = {}

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

    prediction_ranked = (
        rank_probabilities(
            blended
        )
    )

    actual = "".join(
        map(str, order)
    )

    payout = payout_for(
        payout_row
        if payout_row is not None
        else result
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
            payout,

        "odds":
            odds,

        "strictOddsOk":
            strict_odds_ok,

        "oddsColumnCount":
            odds_column_count,

        "model_probabilities":
            model_trifecta,

        "market_probabilities":
            market,

        "blended_probabilities":
            blended,

        # 購入しないレースでも必ず存在。
        "prediction": {
            "main":
                (
                    prediction_ranked[0][0]
                    if len(
                        prediction_ranked
                    ) >= 1
                    else None
                ),

            "second":
                (
                    prediction_ranked[1][0]
                    if len(
                        prediction_ranked
                    ) >= 2
                    else None
                ),

            "third":
                (
                    prediction_ranked[2][0]
                    if len(
                        prediction_ranked
                    ) >= 3
                    else None
                ),
        },
    }


def collect_range(
    start_date,
    end_date,
    mean,
    scale,
    coefficients,
):
    rows = []

    stats = {
        "daysAttempted": 0,
        "daysLoaded": 0,
        "races": 0,
        "strictOddsRaces": 0,
    }

    target = start_date

    while target <= end_date:
        stats[
            "daysAttempted"
        ] += 1

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

            target += timedelta(
                days=1
            )
            continue

        if (
            cards is None
            or results is None
        ):
            target += timedelta(
                days=1
            )
            continue

        stats[
            "daysLoaded"
        ] += 1

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

        odds_map = (
            rows_by_code(
                odds_frame
            )
        )

        added = 0
        strict_added = 0

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

            item = build_row(
                card=card,
                result=result,
                payout_row=(
                    payout_map.get(
                        code
                    )
                ),
                odds_row=(
                    odds_map.get(
                        code
                    )
                ),
                target=target,
                mean=mean,
                scale=scale,
                coefficients=coefficients,
            )

            if item is None:
                continue

            rows.append(item)

            added += 1

            if item["strictOddsOk"]:
                strict_added += 1

        stats["races"] += added

        stats[
            "strictOddsRaces"
        ] += strict_added

        print(
            f"{target}: "
            f"+{added} races / "
            f"strict_odds={strict_added} / "
            f"total={len(rows)}",
            flush=True,
        )

        target += timedelta(
            days=1
        )

    return rows, stats


def baseline_top_n(
    rows,
    n,
):
    races_bet = len(rows)
    hits = 0
    returns = 0.0

    for row in rows:
        ranked = [
            combo
            for combo, _
            in rank_probabilities(
                row[
                    "model_probabilities"
                ]
            )
        ]

        selections = (
            ranked[:n]
        )

        if (
            row["actual"]
            in selections
        ):
            hits += 1

            if np.isfinite(
                row["payout"]
            ):
                returns += (
                    row["payout"]
                )

    tickets = (
        races_bet * n
    )

    stake = (
        tickets * 100.0
    )

    return {
        "totalRaces":
            len(rows),

        "racesBet":
            races_bet,

        "skippedRaces":
            0,

        "betRate":
            (
                1.0
                if rows
                else 0.0
            ),

        "skipRate":
            0.0,

        "tickets":
            tickets,

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

        "profit":
            returns - stake,

        "roi":
            (
                returns / stake
                if stake
                else 0.0
            ),
    }


def main():
    config = parse_args()

    validation_days = max(
        1,
        int(
            config.validation_days
        ),
    )

    test_days = (
        int(config.days)
        if config.days is not None
        else int(config.test_days)
    )

    test_days = max(
        1,
        test_days,
    )

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
            "model missing dataEndDate"
        )

    model_end_date = (
        date.fromisoformat(
            model_end_text
        )
    )

    final_test_end = (
        date.today()
        - timedelta(days=1)
    )

    final_test_start = (
        final_test_end
        - timedelta(
            days=test_days - 1
        )
    )

    validation_end = (
        final_test_start
        - timedelta(days=1)
    )

    validation_start = (
        validation_end
        - timedelta(
            days=(
                validation_days - 1
            )
        )
    )

    if (
        model_end_date
        >= validation_start
    ):
        raise SystemExit(
            "DATA LEAKAGE DETECTED: "
            f"model ends "
            f"{model_end_date}; "
            f"validation starts "
            f"{validation_start}"
        )

    print(
        "\n=== BOAT RACE AI v9.2 ===",
        flush=True,
    )

    print(
        "model end   : "
        f"{model_end_date}",
        flush=True,
    )

    print(
        "validation  : "
        f"{validation_start} "
        f"to {validation_end}",
        flush=True,
    )

    print(
        "final test  : "
        f"{final_test_start} "
        f"to {final_test_end}",
        flush=True,
    )

    validation_rows, validation_stats = (
        collect_range(
            validation_start,
            validation_end,
            mean,
            scale,
            coefficients,
        )
    )

    test_rows, test_stats = (
        collect_range(
            final_test_start,
            final_test_end,
            mean,
            scale,
            coefficients,
        )
    )

    if (
        len(validation_rows)
        < config.min_races
    ):
        raise SystemExit(
            "not enough validation races: "
            f"{len(validation_rows)}"
        )

    if (
        len(test_rows)
        < config.min_races
    ):
        raise SystemExit(
            "not enough final test races: "
            f"{len(test_rows)}"
        )

    validation_prediction = (
        prediction_report(
            validation_rows
        )
    )

    final_prediction = (
        prediction_report(
            test_rows
        )
    )

    (
        selected,
        search_results,
    ) = choose_strategy(
        validation_rows
    )

    if selected is None:
        raise SystemExit(
            "no purchase strategy "
            "qualified on validation"
        )

    frozen_settings = {
        "minProbability":
            selected[
                "minProbability"
            ],

        "minTopProbability":
            selected[
                "minTopProbability"
            ],

        "maxOdds":
            selected[
                "maxOdds"
            ],

        "maxTickets":
            selected[
                "maxTickets"
            ],

        "venueMinShrunkRoi":
            selected[
                "venueMinShrunkRoi"
            ],

        "allowedVenues":
            selected[
                "allowedVenues"
            ],
    }

    frozen_result = (
        evaluate_purchase_strategy(
            test_rows,
            frozen_settings,
            allowed_venues=set(
                frozen_settings[
                    "allowedVenues"
                ]
            ),
        )
    )

    final_by_venue = (
        evaluate_by_venue(
            test_rows,
            frozen_settings,
        )
    )

    validation_odds_coverage = (
        sum(
            row["strictOddsOk"]
            for row
            in validation_rows
        )
        / len(validation_rows)
    )

    final_odds_coverage = (
        sum(
            row["strictOddsOk"]
            for row
            in test_rows
        )
        / len(test_rows)
    )

    output = {
        "version":
            "v9.2-predict-all-buy-selective",

        "method":
            (
                "predict-every-race-"
                "purchase-filter-"
                "validation-selected-"
                "venue-aware-"
                "30d-frozen-test"
            ),

        "warning":
            (
                "Prediction scores are not "
                "calibrated true probabilities "
                "or guaranteed expected value."
            ),

        "generatedAt":
            datetime.now(
                timezone.utc
            ).isoformat(),

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

        "validation": {
            "startDate":
                validation_start.isoformat(),

            "endDate":
                validation_end.isoformat(),

            "days":
                validation_days,

            "raceCount":
                len(validation_rows),

            "strictOddsCoverage":
                validation_odds_coverage,

            "collection":
                validation_stats,

            # 全レース予想精度。
            "prediction":
                validation_prediction,

            "baseline": {
                "modelOnly": {
                    "top1":
                        baseline_top_n(
                            validation_rows,
                            1,
                        ),

                    "top3":
                        baseline_top_n(
                            validation_rows,
                            3,
                        ),

                    "top5":
                        baseline_top_n(
                            validation_rows,
                            5,
                        ),
                }
            },

            "selectedStrategy":
                selected,
        },

        "finalTest": {
            "startDate":
                final_test_start.isoformat(),

            "endDate":
                final_test_end.isoformat(),

            "days":
                test_days,

            "raceCount":
                len(test_rows),

            "strictOddsCoverage":
                final_odds_coverage,

            "collection":
                test_stats,

            # 見送りを含む全レースで予想する。
            "prediction":
                final_prediction,

            "baseline": {
                "modelOnly": {
                    "top1":
                        baseline_top_n(
                            test_rows,
                            1,
                        ),

                    "top3":
                        baseline_top_n(
                            test_rows,
                            3,
                        ),

                    "top5":
                        baseline_top_n(
                            test_rows,
                            5,
                        ),
                }
            },

            "frozenSettings":
                frozen_settings,

            # 「買うべきレース」だけの実績。
            "frozenStrategyResult":
                frozen_result,

            "byVenue":
                final_by_venue,
        },

        "strategySearchValidationOnly":
            search_results,

        "oddsParser": {
            "mode":
                "strict-column-regex",

            "expectedColumns":
                120,

            "fallbackByNumericPosition":
                False,

            "columnExample":
                "3連単_1-2-3",
        },

        "predictionPolicy": {
            "predictEveryRace":
                True,

            "showPredictionWhenSkipped":
                True,

            "purchaseDecisionSeparated":
                True,

            "skipMeaning":
                (
                    "prediction exists but "
                    "purchase is not recommended"
                ),
        },
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
        "\n=== V9.2 FINAL SUMMARY ===",
        flush=True,
    )

    print(
        json.dumps(
            {
                "version":
                    output["version"],

                "validationPrediction":
                    validation_prediction,

                "finalPrediction":
                    final_prediction,

                "selectedVenues":
                    frozen_settings[
                        "allowedVenues"
                    ],

                "finalPurchaseResult":
                    frozen_result,

                "finalOddsCoverage":
                    final_odds_coverage,
            },
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()

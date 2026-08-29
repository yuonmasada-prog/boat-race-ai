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

DEFAULT_MODEL_PATH = Path("model/model.json")
DEFAULT_OUTPUT_PATH = Path("model/backtest.json")

HEADERS = {
    "User-Agent": "boat-race-ai-v9-backtest",
    "Accept": "text/csv,text/plain,*/*",
}

# 重要:
# 「3連単」の先頭の3を艇番として誤認しない。
# 3連単_1-2-3 の 1,2,3 だけを取得する。
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

    # 旧workflowとの互換用。
    # --days が指定された場合は final test 日数として扱う。
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

    text = str(value).replace(",", "")

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

    mean_finish = (
        float(np.mean(finishes))
        if finishes
        else np.nan
    )

    mean_start = (
        float(np.mean(starts))
        if starts
        else np.nan
    )

    return mean_finish, mean_start


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
            for _, lane in placed[:3]
        ]

        if len(set(order)) == 3:
            return order

    order = []

    for position in (1, 2, 3):
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

    exp_scores = np.exp(scores)

    total = np.sum(exp_scores)

    if total <= 0:
        return np.full(
            len(scores),
            1.0 / len(scores),
        )

    return exp_scores / total


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
            key: value / total
            for key, value
            in result.items()
        }

    return result


def venue_from_code(code):
    if len(code) < 12:
        return "??"

    return code[8:10]


def extract_odds(row):
    """
    BoatraceCSV od3 専用。

    列名そのものを厳密に解析する。
    数値列を位置だけで120個並べ直すfallbackは使用しない。

    戻り値:
      odds:
        実際に価格が存在する組番。
      recognized_columns:
        正規表現で認識できた3連単列数。
    """

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

        first, second, third = (
            match.group(1),
            match.group(2),
            match.group(3),
        )

        combo = (
            first
            + second
            + third
        )

        if len(set(combo)) != 3:
            continue

        recognized.add(combo)

        value = number(
            row.get(key)
        )

        # 0.0 は「欠損」ではなく
        # その時点で投票なしの可能性があるため、
        # 組番認識数には含める。
        # ただし価格としては利用しない。
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

    total = sum(
        raw.values()
    )

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


def ranked_combos(probabilities):
    return [
        combo
        for combo, _
        in sorted(
            probabilities.items(),
            key=lambda item: item[1],
            reverse=True,
        )
    ]


def evaluate_strategy(
    rows,
    strategy,
):
    tickets = 0
    races_bet = 0
    hits = 0

    stake = 0.0
    returns = 0.0

    for row in rows:
        selections = strategy(row)

        if not selections:
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

    total_races = len(rows)

    return {
        "totalRaces": total_races,
        "racesBet": races_bet,
        "skippedRaces": (
            total_races
            - races_bet
        ),
        "betRate": (
            races_bet / total_races
            if total_races
            else 0.0
        ),
        "skipRate": (
            (
                total_races
                - races_bet
            )
            / total_races
            if total_races
            else 0.0
        ),
        "tickets": tickets,
        "hits": hits,
        "hitRate": (
            hits / races_bet
            if races_bet
            else 0.0
        ),
        "stake": stake,
        "return": returns,
        "profit": (
            returns - stake
        ),
        "roi": (
            returns / stake
            if stake
            else 0.0
        ),
    }


def top_n_strategy(
    probability_key,
    n,
):
    def strategy(row):
        ranked = ranked_combos(
            row[probability_key]
        )

        return ranked[:n]

    return strategy


def candidate_strategy(
    min_probability,
    min_top_probability,
    max_odds,
    max_tickets,
):
    """
    本番UIの考え方に近い選択ロジック。

    ※ probability は校正済みの真の的中確率とは扱わない。
    EV最適化とは呼ばない。
    """

    def strategy(row):
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
                or price < 1.0
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

        if not candidates:
            return []

        candidates.sort(
            reverse=True
        )

        top_probability = (
            candidates[0][1]
        )

        if (
            top_probability
            < min_top_probability
        ):
            return []

        return [
            combo
            for _, _, combo
            in candidates[
                :max_tickets
            ]
        ]

    return strategy


def strategy_grid():
    settings = []

    for min_probability in (
        0.015,
        0.018,
        0.020,
        0.025,
        0.030,
    ):
        for min_top_probability in (
            0.025,
            0.030,
            0.035,
            0.040,
            0.050,
        ):
            for max_odds in (
                30.0,
                50.0,
                70.0,
                100.0,
            ):
                for max_tickets in (
                    1,
                    2,
                    3,
                ):
                    settings.append(
                        {
                            "minProbability":
                                min_probability,

                            "minTopProbability":
                                min_top_probability,

                            "maxOdds":
                                max_odds,

                            "maxTickets":
                                max_tickets,
                        }
                    )

    return settings


def choose_validation_strategy(
    rows,
):
    """
    validationだけを使ってルールを選ぶ。

    ROIだけ最大化すると、
    少数レースの偶然当たりを拾いやすいため、
    最低購入レース数と購入率を要求する。
    """

    results = []

    minimum_bet_races = max(
        50,
        int(len(rows) * 0.05),
    )

    for setting in strategy_grid():
        result = evaluate_strategy(
            rows,
            candidate_strategy(
                setting[
                    "minProbability"
                ],
                setting[
                    "minTopProbability"
                ],
                setting[
                    "maxOdds"
                ],
                setting[
                    "maxTickets"
                ],
            ),
        )

        results.append(
            {
                **setting,
                **result,
            }
        )

    eligible = [
        item
        for item in results
        if (
            item["racesBet"]
            >= minimum_bet_races
            and item["betRate"]
            >= 0.05
        )
    ]

    if not eligible:
        return None, results

    # ROIを主評価。
    # 同率ならヒット数→購入数を優先し
    # 極端な少数サンプルを避ける。
    best = max(
        eligible,
        key=lambda item: (
            item["roi"],
            item["hits"],
            item["racesBet"],
        ),
    )

    return best, results


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

    order = finish_order(result)

    if not order:
        return None

    matrix = np.vstack(
        [
            build_features(
                card,
                lane,
            )
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
        (matrix - mean)
        / safe_scale
    )

    lane_scores = (
        normalized
        @ coefficients
    )

    lane_probabilities = softmax(
        lane_scores
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

    # 正規表現で120通りを認識できないod3行は
    # 市場オッズを一切使わない。
    # 誤った列対応でバックテストするより安全。
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

    actual = "".join(
        map(
            str,
            order,
        )
    )

    payout = payout_for(
        payout_row
        if payout_row is not None
        else result
    )

    return {
        "code": code,
        "date": target.isoformat(),
        "venue": venue_from_code(
            code
        ),
        "actual": actual,
        "payout": payout,
        "odds": odds,
        "oddsColumnCount":
            odds_column_count,
        "strictOddsOk":
            strict_odds_ok,
        "model_probabilities":
            model_trifecta,
        "market_probabilities":
            market,
        "blended_probabilities":
            blended,
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
        stats["daysAttempted"] += 1

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

            target += timedelta(days=1)
            continue

        if (
            cards is None
            or results is None
        ):
            target += timedelta(days=1)
            continue

        stats["daysLoaded"] += 1

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
        strict_added = 0

        for _, card in cards.iterrows():
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

            item = build_row(
                card=card,
                result=result,
                payout_row=(
                    payout_map.get(code)
                ),
                odds_row=(
                    odds_map.get(code)
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

        target += timedelta(days=1)

    return rows, stats


def baseline_report(rows):
    return {
        "modelOnly": {
            "top1": evaluate_strategy(
                rows,
                top_n_strategy(
                    "model_probabilities",
                    1,
                ),
            ),
            "top3": evaluate_strategy(
                rows,
                top_n_strategy(
                    "model_probabilities",
                    3,
                ),
            ),
            "top5": evaluate_strategy(
                rows,
                top_n_strategy(
                    "model_probabilities",
                    5,
                ),
            ),
        },

        "modelMarketBlend": {
            "top1": evaluate_strategy(
                rows,
                top_n_strategy(
                    "blended_probabilities",
                    1,
                ),
            ),
            "top3": evaluate_strategy(
                rows,
                top_n_strategy(
                    "blended_probabilities",
                    3,
                ),
            ),
            "top5": evaluate_strategy(
                rows,
                top_n_strategy(
                    "blended_probabilities",
                    5,
                ),
            ),
        },
    }


def venue_report(
    rows,
    frozen_strategy,
):
    groups = {}

    for row in rows:
        groups.setdefault(
            row["venue"],
            [],
        ).append(row)

    result = {}

    for venue, subset in groups.items():
        if len(subset) < 20:
            continue

        data = {
            "races": len(subset),

            "modelTop1":
                evaluate_strategy(
                    subset,
                    top_n_strategy(
                        "model_probabilities",
                        1,
                    ),
                ),
        }

        if frozen_strategy is not None:
            data["frozenStrategy"] = (
                evaluate_strategy(
                    subset,
                    frozen_strategy,
                )
            )

        result[venue] = data

    return result


def main():
    config = parse_args()

    validation_days = max(
        1,
        int(config.validation_days),
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
            "model dimensions do not match"
        )

    model_end_text = (
        model.get(
            "dataEndDate"
        )
    )

    if not model_end_text:
        raise SystemExit(
            "Model does not contain "
            "dataEndDate."
        )

    model_end_date = (
        date.fromisoformat(
            model_end_text
        )
    )

    # 完了済みデータだけを対象にするため昨日まで。
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
            days=validation_days - 1
        )
    )

    # モデル学習期間がvalidationへ1日でも侵入したら停止。
    if model_end_date >= validation_start:
        required_offset = (
            validation_days
            + test_days
        )

        raise SystemExit(
            "DATA LEAKAGE DETECTED: "
            f"model data ends {model_end_date}, "
            f"validation starts "
            f"{validation_start}. "
            "Retrain model so training data "
            "ends before validation. "
            f"Recommended end offset: "
            f"{required_offset} days."
        )

    print(
        "\n=== BOAT RACE AI v9 BACKTEST ===",
        flush=True,
    )

    print(
        f"model training end : "
        f"{model_end_date}",
        flush=True,
    )

    print(
        f"validation         : "
        f"{validation_start} "
        f"to {validation_end}",
        flush=True,
    )

    print(
        f"final test         : "
        f"{final_test_start} "
        f"to {final_test_end}",
        flush=True,
    )

    print(
        "\n--- collecting validation ---",
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

    print(
        "\n--- collecting final test ---",
        flush=True,
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
            f"{len(validation_rows)} "
            f"< {config.min_races}"
        )

    if len(test_rows) < config.min_races:
        raise SystemExit(
            "not enough final test races: "
            f"{len(test_rows)} "
            f"< {config.min_races}"
        )

    validation_baseline = (
        baseline_report(
            validation_rows
        )
    )

    final_baseline = (
        baseline_report(
            test_rows
        )
    )

    best_validation, search_results = (
        choose_validation_strategy(
            validation_rows
        )
    )

    frozen_strategy = None
    final_strategy_result = None

    if best_validation is not None:
        frozen_strategy = candidate_strategy(
            best_validation[
                "minProbability"
            ],
            best_validation[
                "minTopProbability"
            ],
            best_validation[
                "maxOdds"
            ],
            best_validation[
                "maxTickets"
            ],
        )

        # ここでは閾値を変更しない。
        # validationで決めた条件をそのままfinal testへ適用。
        final_strategy_result = (
            evaluate_strategy(
                test_rows,
                frozen_strategy,
            )
        )

    validation_odds_coverage = (
        sum(
            row["strictOddsOk"]
            for row in validation_rows
        )
        / len(validation_rows)
    )

    test_odds_coverage = (
        sum(
            row["strictOddsOk"]
            for row in test_rows
        )
        / len(test_rows)
    )

    frozen_settings = None

    if best_validation is not None:
        frozen_settings = {
            "minProbability":
                best_validation[
                    "minProbability"
                ],

            "minTopProbability":
                best_validation[
                    "minTopProbability"
                ],

            "maxOdds":
                best_validation[
                    "maxOdds"
                ],

            "maxTickets":
                best_validation[
                    "maxTickets"
                ],
        }

    output = {
        "version":
            "v9-strict-45day-holdout",

        "method":
            "train-before-validation-"
            "then-15d-validation-"
            "then-30d-frozen-final-test",

        "warning":
            "Model/blended trifecta "
            "probabilities are not treated "
            "as calibrated true probabilities "
            "or guaranteed EV.",

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

            "baseline":
                validation_baseline,

            "selectedStrategy":
                best_validation,
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
                test_odds_coverage,

            "collection":
                test_stats,

            "baseline":
                final_baseline,

            "frozenSettings":
                frozen_settings,

            "frozenStrategyResult":
                final_strategy_result,

            "byVenue":
                venue_report(
                    test_rows,
                    frozen_strategy,
                ),
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

    summary = {
        "version":
            output["version"],

        "modelVersion":
            output["modelVersion"],

        "modelDataEndDate":
            output[
                "modelDataEndDate"
            ],

        "validationPeriod":
            (
                f"{validation_start}"
                f" -> "
                f"{validation_end}"
            ),

        "finalTestPeriod":
            (
                f"{final_test_start}"
                f" -> "
                f"{final_test_end}"
            ),

        "validationRaces":
            len(validation_rows),

        "finalTestRaces":
            len(test_rows),

        "validationStrictOddsCoverage":
            validation_odds_coverage,

        "finalTestStrictOddsCoverage":
            test_odds_coverage,

        "frozenSettings":
            frozen_settings,

        "validationSelectedResult":
            best_validation,

        "finalFrozenResult":
            final_strategy_result,

        "finalModelOnlyTop1":
            final_baseline[
                "modelOnly"
            ]["top1"],
    }

    print(
        "\n=== FINAL SUMMARY ===",
        flush=True,
    )

    print(
        json.dumps(
            summary,
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()

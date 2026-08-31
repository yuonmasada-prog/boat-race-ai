from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from datetime import (
    date,
    timedelta,
    datetime,
    timezone,
)
from pathlib import Path

import numpy as np

import experiment_v10_features as v10


BET_TYPES = {
    "trifecta": {
        "label": "3連単",
        "prefix": "3連単_",
        "payout_combo": "3連単_組番",
        "payout_yen": "3連単_払戻金",
        "uniform": 1 / 120,
    },
    "trio": {
        "label": "3連複",
        "prefix": "3連複_",
        "payout_combo": "3連複_組番",
        "payout_yen": "3連複_払戻金",
        "uniform": 1 / 20,
    },
    "exacta": {
        "label": "2連単",
        "prefix": "2連単_",
        "payout_combo": "2連単_組番",
        "payout_yen": "2連単_払戻金",
        "uniform": 1 / 30,
    },
    "quinella": {
        "label": "2連複",
        "prefix": "2連複_",
        "payout_combo": "2連複_組番",
        "payout_yen": "2連複_払戻金",
        "uniform": 1 / 15,
    },
}


@dataclass
class RaceMarket:
    code: str
    race_date: str

    probabilities: dict[
        str,
        dict[str, float],
    ]

    odds: dict[
        str,
        dict[str, float],
    ]

    result_combo: dict[
        str,
        str,
    ]

    payout: dict[
        str,
        int,
    ]


def parse_args():

    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--days",
        type=int,
        default=30,
    )

    parser.add_argument(
        "--validation-days",
        type=int,
        default=15,
    )

    parser.add_argument(
        "--min-validation-bets",
        type=int,
        default=80,
    )

    parser.add_argument(
        "--min-test-bets",
        type=int,
        default=80,
    )

    parser.add_argument(
        "--model",
        default="model/model.json",
    )

    parser.add_argument(
        "--output",
        default=(
            "model/"
            "multibet-strategy-oos.json"
        ),
    )

    parser.add_argument(
        "--strategy",
        default=(
            "model/"
            "multibet-strategy.json"
        ),
    )

    return parser.parse_args()


def load_json(path: str):

    return json.loads(
        Path(path).read_text(
            encoding="utf-8"
        )
    )


def normalize_combo(
    value,
    bet_type: str,
):

    text = str(
        value or ""
    ).strip()

    digits = [
        char
        for char in text
        if char in "123456"
    ]

    if bet_type == "trifecta":

        return (
            "".join(
                digits[:3]
            )
            if len(digits) >= 3
            else ""
        )

    if bet_type == "exacta":

        return (
            "".join(
                digits[:2]
            )
            if len(digits) >= 2
            else ""
        )

    if bet_type == "trio":

        if len(digits) < 3:
            return ""

        return "".join(
            sorted(
                digits[:3]
            )
        )

    if bet_type == "quinella":

        if len(digits) < 2:
            return ""

        return "".join(
            sorted(
                digits[:2]
            )
        )

    return ""


def safe_float(value):

    try:

        text = (
            str(value)
            .replace(",", "")
            .replace("¥", "")
            .strip()
        )

        number = float(text)

        return (
            number
            if math.isfinite(number)
            else None
        )

    except Exception:
        return None


def safe_int(value):

    number = safe_float(
        value
    )

    return (
        int(
            round(number)
        )
        if number is not None
        else 0
    )


def softmax(scores):

    scores = np.asarray(
        scores,
        dtype=float,
    )

    shifted = (
        scores
        -
        np.max(scores)
    )

    exponential = np.exp(
        shifted
    )

    total = float(
        np.sum(
            exponential
        )
    )

    return (
        exponential
        /
        total
    )


def lane_probabilities(
    race,
    model,
):

    feature_index = {
        name:
            index

        for index, name
        in enumerate(
            v10.ALL_FEATURES
        )
    }

    features = list(
        model["features"]
    )

    indices = []

    for name in features:

        if name not in feature_index:

            raise RuntimeError(
                "unsupported production "
                f"feature: {name}"
            )

        indices.append(
            feature_index[
                name
            ]
        )

    matrix = (
        race.enhanced[
            :,
            indices
        ]
        .astype(float)
    )

    mean = np.asarray(
        model["mean"],
        dtype=float,
    )

    scale = np.asarray(
        model["scale"],
        dtype=float,
    )

    coefficients = np.asarray(
        model["coefficients"],
        dtype=float,
    )

    if not (
        matrix.shape[1]
        ==
        len(mean)
        ==
        len(scale)
        ==
        len(coefficients)
    ):

        raise RuntimeError(
            "production model "
            "dimension mismatch"
        )

    matrix = np.where(
        np.isfinite(
            matrix
        ),
        matrix,
        mean,
    )

    scale = np.where(
        np.abs(
            scale
        )
        >
        1e-9,
        scale,
        1.0,
    )

    normalized = (
        matrix
        -
        mean
    ) / scale

    return softmax(
        normalized
        @
        coefficients
    )


def trifecta_probabilities(
    lane_probability,
):

    output = {}

    for first in range(
        1,
        7,
    ):

        for second in range(
            1,
            7,
        ):

            if second == first:
                continue

            for third in range(
                1,
                7,
            ):

                if third in (
                    first,
                    second,
                ):
                    continue

                p1 = float(
                    lane_probability[
                        first - 1
                    ]
                )

                p2 = (
                    float(
                        lane_probability[
                            second - 1
                        ]
                    )
                    /
                    max(
                        1 - p1,
                        1e-9,
                    )
                )

                p3 = (
                    float(
                        lane_probability[
                            third - 1
                        ]
                    )
                    /
                    max(
                        1
                        -
                        float(
                            lane_probability[
                                first - 1
                            ]
                        )
                        -
                        float(
                            lane_probability[
                                second - 1
                            ]
                        ),
                        1e-9,
                    )
                )

                output[
                    f"{first}"
                    f"{second}"
                    f"{third}"
                ] = (
                    p1
                    *
                    p2
                    *
                    p3
                )

    total = sum(
        output.values()
    )

    if total > 0:

        output = {
            combo:
                probability
                /
                total

            for combo, probability
            in output.items()
        }

    return output


def aggregate_probabilities(
    trifecta,
):

    trio = {}
    exacta = {}
    quinella = {}

    for (
        combo,
        probability,
    ) in trifecta.items():

        first = int(
            combo[0]
        )

        second = int(
            combo[1]
        )

        third = int(
            combo[2]
        )

        trio_key = "".join(
            map(
                str,
                sorted(
                    (
                        first,
                        second,
                        third,
                    )
                ),
            )
        )

        exacta_key = (
            f"{first}"
            f"{second}"
        )

        quinella_key = "".join(
            map(
                str,
                sorted(
                    (
                        first,
                        second,
                    )
                ),
            )
        )

        trio[
            trio_key
        ] = (
            trio.get(
                trio_key,
                0.0,
            )
            +
            probability
        )

        exacta[
            exacta_key
        ] = (
            exacta.get(
                exacta_key,
                0.0,
            )
            +
            probability
        )

        quinella[
            quinella_key
        ] = (
            quinella.get(
                quinella_key,
                0.0,
            )
            +
            probability
        )

    return {
        "trifecta":
            trifecta,

        "trio":
            trio,

        "exacta":
            exacta,

        "quinella":
            quinella,
    }


def odds_frames(
    target: date,
):

    exacta_frame = v10.fetch_csv(
        "previews/od2",
        target,
    )

    return {
        "trifecta":
            v10.fetch_csv(
                "previews/od3",
                target,
            ),

        "trio":
            v10.fetch_csv(
                "previews/od1",
                target,
            ),

        "exacta":
            exacta_frame,

        "quinella":
            exacta_frame,
    }


def frame_rows_by_code(
    frame,
):

    if (
        frame is None
        or
        frame.empty
        or
        "レースコード"
        not in frame.columns
    ):
        return {}

    return {
        str(
            row[
                "レースコード"
            ]
        ):
            row

        for _, row
        in frame.iterrows()
    }


def parse_odds_from_row(
    row,
    bet_type,
):

    if row is None:
        return {}

    prefix = (
        BET_TYPES[
            bet_type
        ][
            "prefix"
        ]
    )

    output = {}

    for column in row.index:

        column_text = str(
            column
        )

        if not column_text.startswith(
            prefix
        ):
            continue

        combo = normalize_combo(
            column_text[
                len(prefix):
            ],
            bet_type,
        )

        odd = safe_float(
            row[
                column
            ]
        )

        if (
            combo
            and
            odd is not None
            and
            odd >= 1
        ):

            output[
                combo
            ] = odd

    return output


def parse_payout_row(
    row,
):

    result_combo = {}
    payout = {}

    if row is None:

        return (
            result_combo,
            payout,
        )

    for (
        bet_type,
        specification,
    ) in BET_TYPES.items():

        combo = normalize_combo(
            row.get(
                specification[
                    "payout_combo"
                ],
                "",
            ),
            bet_type,
        )

        yen = safe_int(
            row.get(
                specification[
                    "payout_yen"
                ],
                0,
            )
        )

        if combo:

            result_combo[
                bet_type
            ] = combo

            payout[
                bet_type
            ] = yen

    return (
        result_combo,
        payout,
    )


def collect_markets(
    start: date,
    end: date,
    model,
):

    races = v10.collect(
        start,
        end,
    )

    races_by_date = {}

    for race in races:

        races_by_date.setdefault(
            race.race_date,
            [],
        ).append(
            race
        )

    markets = []

    target = start

    while target <= end:

        date_key = (
            target.isoformat()
        )

        day_races = (
            races_by_date.get(
                date_key,
                [],
            )
        )

        if not day_races:

            target += timedelta(
                days=1
            )

            continue

        frames = odds_frames(
            target
        )

        payouts = v10.fetch_csv(
            "results/payouts",
            target,
        )

        indexed = {
            bet_type:
                frame_rows_by_code(
                    frame
                )

            for bet_type, frame
            in frames.items()
        }

        payout_rows = (
            frame_rows_by_code(
                payouts
            )
        )

        for race in day_races:

            lane_probability = (
                lane_probabilities(
                    race,
                    model,
                )
            )

            trifecta = (
                trifecta_probabilities(
                    lane_probability
                )
            )

            probabilities = (
                aggregate_probabilities(
                    trifecta
                )
            )

            odds = {
                bet_type:
                    parse_odds_from_row(
                        indexed[
                            bet_type
                        ].get(
                            race.code
                        ),
                        bet_type,
                    )

                for bet_type
                in BET_TYPES
            }

            (
                result_combo,
                payout,
            ) = parse_payout_row(
                payout_rows.get(
                    race.code
                )
            )

            if result_combo:

                markets.append(
                    RaceMarket(
                        code=
                            race.code,

                        race_date=
                            race.race_date,

                        probabilities=
                            probabilities,

                        odds=
                            odds,

                        result_combo=
                            result_combo,

                        payout=
                            payout,
                    )
                )

        target += timedelta(
            days=1
        )

    return markets


def candidate_space():

    candidates = []

    for bet_type in BET_TYPES:

        for tickets in (
            1,
            2,
            3,
        ):

            for concentration in (
                1.15,
                1.35,
                1.60,
                2.00,
                2.50,
                3.00,
            ):

                for max_odds in (
                    20.0,
                    50.0,
                    100.0,
                    200.0,
                ):

                    candidates.append({
                        "betType":
                            bet_type,

                        "tickets":
                            tickets,

                        "minConcentration":
                            concentration,

                        "maxOdds":
                            max_odds,
                    })

    return candidates


def evaluate_strategy(
    markets,
    strategy,
):

    bet_type = (
        strategy[
            "betType"
        ]
    )

    uniform = (
        BET_TYPES[
            bet_type
        ][
            "uniform"
        ]
    )

    races_bet = 0
    tickets = 0
    hits = 0
    stake = 0
    returned = 0

    for race in markets:

        probability = (
            race.probabilities.get(
                bet_type,
                {},
            )
        )

        odds = (
            race.odds.get(
                bet_type,
                {},
            )
        )

        ranked = sorted(
            probability.items(),
            key=lambda item:
                item[1],
            reverse=True,
        )

        eligible = [
            (
                combo,
                probability_value,
            )

            for (
                combo,
                probability_value,
            )
            in ranked

            if (
                probability_value
                /
                uniform
            )
            >=
            strategy[
                "minConcentration"
            ]

            and

            combo in odds

            and

            odds[
                combo
            ]
            <=
            strategy[
                "maxOdds"
            ]
        ][
            :
            strategy[
                "tickets"
            ]
        ]

        if not eligible:
            continue

        races_bet += 1

        for (
            combo,
            _,
        ) in eligible:

            tickets += 1
            stake += 100

            if (
                race.result_combo.get(
                    bet_type
                )
                ==
                combo
            ):

                hits += 1

                returned += (
                    race.payout.get(
                        bet_type,
                        0,
                    )
                )

    roi = (
        returned
        /
        stake
        *
        100

        if stake
        else 0.0
    )

    ticket_hit_rate = (
        hits
        /
        tickets

        if tickets
        else 0.0
    )

    race_hit_rate = (
        hits
        /
        races_bet

        if races_bet
        else 0.0
    )

    return {
        "racesBet":
            races_bet,

        "tickets":
            tickets,

        "hits":
            hits,

        "stake":
            stake,

        "return":
            returned,

        "profit":
            returned - stake,

        "roi":
            roi,

        "ticketHitRate":
            ticket_hit_rate,

        "raceHitRate":
            race_hit_rate,
    }


def validation_score(
    metrics,
):

    if (
        metrics[
            "tickets"
        ]
        <= 0
    ):
        return -1e9

    # 少数ベットの偶然勝ちを抑制する。
    sample_penalty = (
        35.0
        /
        math.sqrt(
            max(
                metrics[
                    "tickets"
                ],
                1,
            )
        )
    )

    return (
        metrics[
            "roi"
        ]
        -
        sample_penalty
    )


def select_strategy(
    validation,
    min_bets,
):

    results = []

    for strategy in (
        candidate_space()
    ):

        metrics = (
            evaluate_strategy(
                validation,
                strategy,
            )
        )

        if (
            metrics[
                "tickets"
            ]
            <
            min_bets
        ):
            continue

        results.append({
            **strategy,

            "validation":
                metrics,

            "selectionScore":
                validation_score(
                    metrics
                ),
        })

    results.sort(
        key=lambda item:
            item[
                "selectionScore"
            ],
        reverse=True,
    )

    return results


def main():

    args = parse_args()

    if (
        args.validation_days
        >=
        args.days
    ):

        raise SystemExit(
            "validation-days must "
            "be smaller than days"
        )

    completed_end = (
        date.today()
        -
        timedelta(
            days=1
        )
    )

    start = (
        completed_end
        -
        timedelta(
            days=
                args.days
                -
                1
        )
    )

    validation_end = (
        start
        +
        timedelta(
            days=
                args.validation_days
                -
                1
        )
    )

    test_start = (
        validation_end
        +
        timedelta(
            days=1
        )
    )

    model = load_json(
        args.model
    )

    print(
        "=== MultiBet OOS "
        "Strategy Optimizer ==="
    )

    print(
        "period:",
        start,
        "->",
        completed_end,
    )

    print(
        "validation:",
        start,
        "->",
        validation_end,
    )

    print(
        "test:",
        test_start,
        "->",
        completed_end,
    )

    markets = collect_markets(
        start,
        completed_end,
        model,
    )

    validation = [
        item

        for item in markets

        if (
            date.fromisoformat(
                item.race_date
            )
            <=
            validation_end
        )
    ]

    test = [
        item

        for item in markets

        if (
            date.fromisoformat(
                item.race_date
            )
            >=
            test_start
        )
    ]

    if (
        len(validation) < 300
        or
        len(test) < 300
    ):

        raise SystemExit(
            "insufficient market races: "
            f"validation={len(validation)} "
            f"test={len(test)}"
        )

    ranked = select_strategy(
        validation,
        args.min_validation_bets,
    )

    if not ranked:

        raise SystemExit(
            "no strategy passed "
            "validation sample threshold"
        )

    finalists = (
        ranked[:12]
    )

    for item in finalists:

        item[
            "test"
        ] = evaluate_strategy(
            test,
            item,
        )

    # ここで選ぶのはvalidation 1位。
    # testを見てパラメータを選び直さない。
    best = finalists[0]

    test_metrics = (
        best[
            "test"
        ]
    )

    promotion_candidate = (
        test_metrics[
            "tickets"
        ]
        >=
        args.min_test_bets

        and

        test_metrics[
            "roi"
        ]
        >=
        100.0

        and

        test_metrics[
            "profit"
        ]
        >
        0
    )

    report = {
        "version":
            "v12-multibet-oos-strategy",

        "generatedAt":
            datetime.now(
                timezone.utc
            ).isoformat(),

        "productionChanged":
            False,

        "modelVersion":
            model.get(
                "version"
            ),

        "period": {
            "start":
                start.isoformat(),

            "validationEnd":
                validation_end.isoformat(),

            "testStart":
                test_start.isoformat(),

            "end":
                completed_end.isoformat(),

            "validationRaces":
                len(validation),

            "testRaces":
                len(test),
        },

        "methodology": {
            "selection":
                "validation-only",

            "test":
                "frozen-after-selection",

            "stakePerTicket":
                100,

            "note": (
                "Odds are pre-cutoff snapshots. "
                "Model probabilities are relative "
                "model scores, not calibrated true "
                "probabilities; no EV claim is made."
            ),
        },

        "best":
            best,

        "topValidationStrategies":
            finalists,

        "promotionCandidate":
            promotion_candidate,
    }

    output = Path(
        args.output
    )

    output.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    output.write_text(
        json.dumps(
            report,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    if promotion_candidate:

        strategy = {
            "version":
                "v12-multibet-strategy-challenger",

            "status":
                "oos-positive-challenger",

            "generatedAt":
                report[
                    "generatedAt"
                ],

            "productionPromoted":
                False,

            "modelVersion":
                model.get(
                    "version"
                ),

            "betType":
                best[
                    "betType"
                ],

            "betTypeLabel":
                BET_TYPES[
                    best[
                        "betType"
                    ]
                ][
                    "label"
                ],

            "tickets":
                best[
                    "tickets"
                ],

            "minConcentration":
                best[
                    "minConcentration"
                ],

            "maxOdds":
                best[
                    "maxOdds"
                ],

            "validation":
                best[
                    "validation"
                ],

            "test":
                best[
                    "test"
                ],

            "warning": (
                "Historical OOS profitability "
                "is not a guarantee of future profit. "
                "Keep bankroll limits and "
                "forward monitoring."
            ),
        }

        Path(
            args.strategy
        ).write_text(
            json.dumps(
                strategy,
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    print(
        json.dumps(
            {
                "bestBetType":
                    BET_TYPES[
                        best[
                            "betType"
                        ]
                    ][
                        "label"
                    ],

                "validationROI":
                    best[
                        "validation"
                    ][
                        "roi"
                    ],

                "testROI":
                    best[
                        "test"
                    ][
                        "roi"
                    ],

                "testTickets":
                    best[
                        "test"
                    ][
                        "tickets"
                    ],

                "promotionCandidate":
                    promotion_candidate,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

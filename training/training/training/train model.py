from __future__ import annotations

import argparse
import json
import math
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests


BASE = "https://boatracecsv.github.io/data"
OUT = Path("model/model.json")


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


session = requests.Session()

session.headers.update(
    {
        "User-Agent":
            "boat-race-ai-v7-trainer/1.0",

        "Accept":
            "text/csv,text/plain,*/*",
    }
)


def parse_args():

    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--days",
        type=int,
        default=180
    )

    parser.add_argument(
        "--min-races",
        type=int,
        default=500
    )

    parser.add_argument(
        "--epochs",
        type=int,
        default=1800
    )

    parser.add_argument(
        "--lr",
        type=float,
        default=0.035
    )

    parser.add_argument(
        "--l2",
        type=float,
        default=0.002
    )

    return parser.parse_args()


def fetch_csv(
    kind: str,
    day: date
):

    url = (
        f"{BASE}/"
        f"{kind}/"
        f"{day:%Y/%m/%d}.csv"
    )

    try:

        response = session.get(
            url,
            timeout=20
        )

    except requests.RequestException:

        return None


    if response.status_code == 404:

        return None


    response.raise_for_status()


    if not response.text.strip():

        return None


    try:

        return pd.read_csv(
            pd.io.common.StringIO(
                response.text
            ),
            dtype=str
        )

    except Exception:

        return None


def num(value):

    if value is None:

        return np.nan


    if (
        isinstance(value, float)
        and
        math.isnan(value)
    ):

        return np.nan


    text = (
        str(value)
        .strip()
        .replace(",", "")
    )


    match = re.search(
        r"-?\d+(?:\.\d+)?",
        text
    )


    if not match:

        return np.nan


    return float(
        match.group(0)
    )


def first(
    row,
    names
):

    for name in names:

        if name in row.index:

            return row[name]


    return None


def boat_value(
    row,
    lane: int,
    suffixes
):

    for suffix in suffixes:

        key = (
            f"艇{lane}_"
            f"{suffix}"
        )

        if key in row.index:

            return row[key]


    return None


def grade_flags(value):

    grade = (
        str(value or "")
        .strip()
        .upper()
    )

    return [
        float(
            grade == name
        )
        for name
        in (
            "A1",
            "A2",
            "B1",
            "B2"
        )
    ]


def meet_features(
    row,
    lane: int
):

    finishes = []
    starts = []

    count = 0


    for day in range(
        1,
        8
    ):

        for run in range(
            1,
            3
        ):

            prefix = (
                f"艇{lane}_"
                f"節D{day}"
                f"走{run}_"
            )


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


            has_data = False


            for suffix in (
                "R番号",
                "進入",
                "枠",
                "ST",
                "着順"
            ):

                value = row.get(
                    prefix
                    +
                    suffix
                )


                if (
                    value is not None
                    and
                    str(value).strip()
                ):

                    has_data = True

                    break


            if has_data:

                count += 1


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
    lane: int
):

    grade = boat_value(
        card,
        lane,
        [
            "級別",
            "級"
        ]
    )


    grade_values = grade_flags(
        grade
    )


    (
        meet_finish,
        meet_st,
        meet_count
    ) = meet_features(
        card,
        lane
    )


    ex_course = num(
        boat_value(
            stt,
            lane,
            [
                "コース",
                "進入"
            ]
        )
    )


    ex_st = num(
        boat_value(
            stt,
            lane,
            [
                "スタート展示",
                "展示ST"
            ]
        )
    )


    ex_time = num(
        boat_value(
            tkz,
            lane,
            [
                "展示タイム"
            ]
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
                7
            )
        ],

        *grade_values,


        num(
            boat_value(
                card,
                lane,
                [
                    "全国平均ST",
                    "平均ST"
                ]
            )
        ),


        num(
            boat_value(
                card,
                lane,
                [
                    "全国勝率"
                ]
            )
        ),


        num(
            boat_value(
                card,
                lane,
                [
                    "全国2連対率",
                    "全国2連率"
                ]
            )
        ),


        num(
            boat_value(
                card,
                lane,
                [
                    "全国3連対率",
                    "全国3連率"
                ]
            )
        ),


        num(
            boat_value(
                card,
                lane,
                [
                    "当地勝率"
                ]
            )
        ),


        num(
            boat_value(
                card,
                lane,
                [
                    "当地2連対率",
                    "当地2連率"
                ]
            )
        ),


        num(
            boat_value(
                card,
                lane,
                [
                    "当地3連対率",
                    "当地3連率"
                ]
            )
        ),


        num(
            boat_value(
                card,
                lane,
                [
                    "モーター2連対率",
                    "モーター2連率"
                ]
            )
        ),


        num(
            boat_value(
                card,
                lane,
                [
                    "モーター3連対率",
                    "モーター3連率"
                ]
            )
        ),


        num(
            boat_value(
                card,
                lane,
                [
                    "ボート2連対率",
                    "ボート2連率"
                ]
            )
        ),


        num(
            boat_value(
                card,
                lane,
                [
                    "ボート3連対率",
                    "ボート3連率"
                ]
            )
        ),


        num(
            boat_value(
                card,
                lane,
                [
                    "F本数",
                    "F"
                ]
            )
        ),


        num(
            boat_value(
                card,
                lane,
                [
                    "L本数",
                    "L"
                ]
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
            first(
                sui,
                [
                    "風速(m)",
                    "風速"
                ]
            )
        ),


        num(
            first(
                sui,
                [
                    "波の高さ(cm)",
                    "波高",
                    "波の高さ"
                ]
            )
        ),


        num(
            first(
                sui,
                [
                    "気温(℃)",
                    "気温"
                ]
            )
        ),


        num(
            first(
                sui,
                [
                    "水温(℃)",
                    "水温"
                ]
            )
        ),
    ]


    return np.asarray(
        values,
        dtype=float
    )


def map_by_code(df):

    if (
        df is None
        or
        df.empty
        or
        "レースコード"
        not in df.columns
    ):

        return {}


    return {

        str(
            row[
                "レースコード"
            ]
        ):
        row

        for _,
        row
        in df.iterrows()
    }


def collect(days: int):

    races = []


    end = (
        date.today()
        -
        timedelta(
            days=1
        )
    )


    start = (
        end
        -
        timedelta(
            days=days - 1
        )
    )


    for offset in range(
        days
    ):

        day = (
            start
            +
            timedelta(
                days=offset
            )
        )


        cards = fetch_csv(
            "programs/race_cards",
            day
        )


        results = fetch_csv(
            "results/realtime",
            day
        )


        if (
            cards is None
            or
            results is None
        ):

            continue


        stt = fetch_csv(
            "previews/stt",
            day
        )


        tkz = fetch_csv(
            "previews/tkz",
            day
        )


        sui = fetch_csv(
            "previews/sui",
            day
        )


        result_map = map_by_code(
            results
        )


        stt_map = map_by_code(
            stt
        )


        tkz_map = map_by_code(
            tkz
        )


        sui_map = map_by_code(
            sui
        )


        for _,
        card
        in cards.iterrows():


            code = str(
                card.get(
                    "レースコード",
                    ""
                )
            )


            result = result_map.get(
                code
            )


            if result is None:

                continue


            winner_value = num(
                first(
                    result,
                    [
                        "1着_艇番"
                    ]
                )
            )


            if not np.isfinite(
                winner_value
            ):

                continue


            winner = int(
                winner_value
            )


            if (
                winner < 1
                or
                winner > 6
            ):

                continue


            stt_row = stt_map.get(
                code,
                pd.Series(
                    dtype=object
                )
            )


            tkz_row = tkz_map.get(
                code,
                pd.Series(
                    dtype=object
                )
            )


            sui_row = sui_map.get(
                code,
                pd.Series(
                    dtype=object
                )
            )


            features = np.vstack(
                [
                    build_feature(
                        card,
                        stt_row,
                        tkz_row,
                        sui_row,
                        lane
                    )

                    for lane
                    in range(
                        1,
                        7
                    )
                ]
            )


            races.append(
                (
                    code,
                    day.isoformat(),
                    features,
                    winner - 1
                )
            )


        print(
            (
                f"{day}: "
                f"total races="
                f"{len(races)}"
            ),
            flush=True
        )


    races.sort(
        key=lambda item:
            item[0]
    )


    return races


def impute_and_scale(
    train_races,
    test_races
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
        axis=0
    )


    means = np.where(
        np.isfinite(means),
        means,
        0.0
    )


    filled = np.where(
        np.isfinite(flat),
        flat,
        means
    )


    scales = np.std(
        filled,
        axis=0
    )


    scales = np.where(
        scales > 1e-8,
        scales,
        1.0
    )


    def transform(races):

        output = []


        for (
            code,
            race_date,
            values,
            winner
        ) in races:


            values = np.where(
                np.isfinite(values),
                values,
                means
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
                    winner
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
        scales
    )


def softmax(values):

    centered = (
        values
        -
        np.max(values)
    )


    exponential = np.exp(
        centered
    )


    return (
        exponential
        /
        np.sum(
            exponential
        )
    )


def train_conditional_logit(
    races,
    epochs,
    learning_rate,
    l2
):

    feature_count = len(
        FEATURES
    )


    weights = np.zeros(
        feature_count,
        dtype=float
    )


    first_moment = np.zeros(
        feature_count,
        dtype=float
    )


    second_moment = np.zeros(
        feature_count,
        dtype=float
    )


    beta1 = 0.9
    beta2 = 0.999

    epsilon = 1e-8

    step = 0


    random = np.random.default_rng(
        42
    )


    for epoch in range(
        1,
        epochs + 1
    ):


        order = random.permutation(
            len(races)
        )


        gradient = np.zeros_like(
            weights
        )


        loss = 0.0


        for index in order:


            _,
            _,
            values,
            winner = races[index]


            probabilities = softmax(
                values @ weights
            )


            loss += -math.log(
                max(
                    probabilities[
                        winner
                    ],
                    1e-12
                )
            )


            expected = (
                probabilities
                @
                values
            )


            gradient += (
                expected
                -
                values[
                    winner
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


        step += 1


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
                beta1 ** step
            )
        )


        second_corrected = (
            second_moment
            /
            (
                1
                -
                beta2 ** step
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
            epoch % 100 == 0
        ):

            print(
                (
                    f"epoch="
                    f"{epoch} "
                    f"loss="
                    f"{loss:.5f}"
                ),
                flush=True
            )


    return weights


def evaluate(
    races,
    weights
):

    if not races:

        return {}


    hits = 0
    top3 = 0
    loss = 0.0


    for (
        _,
        _,
        values,
        winner
    ) in races:


        probabilities = softmax(
            values @ weights
        )


        order = np.argsort(
            -probabilities
        )


        hits += int(
            order[0] ==
            winner
        )


        top3 += int(
            winner
            in
            order[:3]
        )


        loss += -math.log(
            max(
                probabilities[
                    winner
                ],
                1e-12
            )
        )


    count = len(
        races
    )


    return {
        "races":
            count,

        "top1Accuracy":
            hits / count,

        "winnerInTop3":
            top3 / count,

        "logLoss":
            loss / count,
    }


def main():

    args = parse_args()


    races = collect(
        args.days
    )


    if len(races) < args.min_races:

        raise SystemExit(
            (
                "not enough races: "
                f"{len(races)} "
                "< "
                f"{args.min_races}"
            )
        )


    split = max(
        1,
        int(
            len(races)
            *
            0.82
        )
    )


    train_races = races[
        :split
    ]


    test_races = races[
        split:
    ]


    (
        train_races,
        test_races,
        means,
        scales
    ) = impute_and_scale(
        train_races,
        test_races
    )


    weights = train_conditional_logit(
        train_races,
        args.epochs,
        args.lr,
        args.l2
    )


    train_metrics = evaluate(
        train_races,
        weights
    )


    test_metrics = evaluate(
        test_races,
        weights
    )


    model = {

        "version":
            "v7-conditional-logit",

        "trainedAt":
            datetime.now(
                timezone.utc
            )
            .isoformat(),

        "lookbackDays":
            args.days,

        "raceCount":
            len(races),

        "features":
            FEATURES,

        "mean":
            means.tolist(),

        "scale":
            scales.tolist(),

        "coefficients":
            weights.tolist(),

        "validation":
            test_metrics,

        "training":
            train_metrics,

        "notes":
            (
                "Winner conditional-logit model. "
                "Race-wise softmax training; "
                "trifecta inference uses "
                "Plackett-Luce ordering."
            )
    }


    OUT.parent.mkdir(
        parents=True,
        exist_ok=True
    )


    OUT.write_text(
        json.dumps(
            model,
            ensure_ascii=False,
            indent=2
        ),
        encoding="utf-8"
    )


    print(
        json.dumps(
            test_metrics,
            ensure_ascii=False,
            indent=2
        )
    )


if __name__ == "__main__":
    main()

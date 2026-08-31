from __future__ import annotations

import argparse
import itertools
import json
import math
import random
from dataclasses import dataclass
from datetime import date, timedelta, datetime, timezone
from pathlib import Path

import numpy as np

import experiment_v10_features as v10


LIVE = list(v10.LIVE_FEATURES)
BASE_COUNT = len(v10.BASE_FEATURES)


@dataclass
class Candidate:
    features: tuple[str, ...]
    lr: float
    l2: float
    epochs: int


def parse_args():
    p = argparse.ArgumentParser()

    p.add_argument("--train-days", type=int, default=120)
    p.add_argument("--validation-days", type=int, default=15)
    p.add_argument("--test-days", type=int, default=30)

    p.add_argument("--replication-shift", type=int, default=45)

    p.add_argument("--max-candidates", type=int, default=96)
    p.add_argument("--top-k", type=int, default=5)

    p.add_argument(
        "--output",
        default="model/automl-search.json",
    )

    p.add_argument(
        "--challenger",
        default="model/automl-challenger.json",
    )

    return p.parse_args()


def periods(end, train_days, validation_days, test_days):
    test_end = end
    test_start = test_end - timedelta(days=test_days - 1)

    val_end = test_start - timedelta(days=1)
    val_start = val_end - timedelta(days=validation_days - 1)

    train_end = val_start - timedelta(days=1)
    train_start = train_end - timedelta(days=train_days - 1)

    return {
        "train": (train_start, train_end),
        "validation": (val_start, val_end),
        "test": (test_start, test_end),
    }


def subset_matrix(matrix, features):
    indices = list(range(BASE_COUNT))

    for name in features:
        live_index = LIVE.index(name)
        indices.append(BASE_COUNT + live_index)

    return matrix[:, indices]


def transform_for(
    races,
    features,
    mean,
    scale,
):
    output = []

    for race in races:
        matrix = subset_matrix(
            race.enhanced,
            features,
        )

        matrix = np.where(
            np.isfinite(matrix),
            matrix,
            mean,
        )

        output.append(
            (matrix - mean) / scale
        )

    return output


def transformer(train_races, features):
    flat = np.vstack([
        subset_matrix(
            race.enhanced,
            features,
        )
        for race in train_races
    ])

    with np.errstate(all="ignore"):
        mean = np.nanmean(flat, axis=0)

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

    return mean, scale


def candidate_space(max_candidates):
    feature_sets = []

    # baseline
    feature_sets.append(tuple())

    # 全組み合わせ
    for size in range(1, len(LIVE) + 1):
        for combo in itertools.combinations(LIVE, size):
            feature_sets.append(combo)

    hyper = [
        (0.020, 0.0010, 220),
        (0.025, 0.0015, 260),
        (0.030, 0.0020, 300),
        (0.035, 0.0020, 300),
        (0.040, 0.0025, 320),
        (0.045, 0.0030, 340),
    ]

    candidates = [
        Candidate(
            features=features,
            lr=lr,
            l2=l2,
            epochs=epochs,
        )
        for features in feature_sets
        for lr, l2, epochs in hyper
    ]

    # 再現可能な固定シャッフル
    rng = random.Random(1056)
    rng.shuffle(candidates)

    # baseline/fullは必ず含める
    mandatory = [
        Candidate(tuple(), 0.035, 0.002, 300),
        Candidate(tuple(LIVE), 0.035, 0.002, 300),
    ]

    selected = mandatory[:]

    seen = {
        (
            c.features,
            c.lr,
            c.l2,
            c.epochs,
        )
        for c in selected
    }

    for candidate in candidates:
        key = (
            candidate.features,
            candidate.lr,
            candidate.l2,
            candidate.epochs,
        )

        if key in seen:
            continue

        selected.append(candidate)
        seen.add(key)

        if len(selected) >= max_candidates:
            break

    return selected


def score(metrics):
    # validation専用スコア
    # ROIはここでは使わない。
    return (
        metrics["winnerTop1"] * 1.5
        +
        metrics["winnerTop3"] * 0.5
        +
        metrics["trifectaTop3"] * 1.5
        +
        metrics["trifectaTop5"] * 1.0
        -
        metrics["logLoss"] * 0.25
        -
        metrics["brier"] * 0.5
    )


def evaluate_candidate(
    candidate,
    train_races,
    validation_races,
):
    mean, scale = transformer(
        train_races,
        candidate.features,
    )

    train_x = transform_for(
        train_races,
        candidate.features,
        mean,
        scale,
    )

    val_x = transform_for(
        validation_races,
        candidate.features,
        mean,
        scale,
    )

    weights = v10.train_model(
        train_x,
        train_races,
        BASE_COUNT + len(candidate.features),
        candidate.epochs,
        candidate.lr,
        candidate.l2,
    )

    metrics = v10.evaluate(
        val_x,
        validation_races,
        weights,
    )

    return {
        "features": list(candidate.features),
        "lr": candidate.lr,
        "l2": candidate.l2,
        "epochs": candidate.epochs,
        "validation": metrics,
        "score": score(metrics),
        "mean": mean.tolist(),
        "scale": scale.tolist(),
        "weights": weights.tolist(),
    }


def final_test(
    candidate,
    train_races,
    validation_races,
    test_races,
):
    # validationまでを学習データとして再学習
    development = (
        list(train_races)
        +
        list(validation_races)
    )

    features = tuple(candidate["features"])

    mean, scale = transformer(
        development,
        features,
    )

    dev_x = transform_for(
        development,
        features,
        mean,
        scale,
    )

    test_x = transform_for(
        test_races,
        features,
        mean,
        scale,
    )

    weights = v10.train_model(
        dev_x,
        development,
        BASE_COUNT + len(features),
        int(candidate["epochs"]),
        float(candidate["lr"]),
        float(candidate["l2"]),
    )

    metrics = v10.evaluate(
        test_x,
        test_races,
        weights,
    )

    return {
        "features": list(features),
        "lr": candidate["lr"],
        "l2": candidate["l2"],
        "epochs": candidate["epochs"],
        "test": metrics,
        "mean": mean.tolist(),
        "scale": scale.tolist(),
        "weights": weights.tolist(),
    }


def split_races(races, p):
    def inside(race, pair):
        d = date.fromisoformat(race.race_date)
        return pair[0] <= d <= pair[1]

    return (
        [r for r in races if inside(r, p["train"])],
        [r for r in races if inside(r, p["validation"])],
        [r for r in races if inside(r, p["test"])],
    )


def robustness(latest, replication):
    a = latest["test"]
    b = replication["test"]

    # 両期間で大崩れしないことを重視
    return (
        min(a["winnerTop1"], b["winnerTop1"]) * 1.5
        +
        min(a["winnerTop3"], b["winnerTop3"]) * 0.5
        +
        min(a["trifectaTop3"], b["trifectaTop3"]) * 1.5
        +
        min(a["trifectaTop5"], b["trifectaTop5"])
        -
        max(a["logLoss"], b["logLoss"]) * 0.25
        -
        max(a["brier"], b["brier"]) * 0.5
    )


def main():
    args = parse_args()

    completed_end = date.today() - timedelta(days=1)

    latest_periods = periods(
        completed_end,
        args.train_days,
        args.validation_days,
        args.test_days,
    )

    replication_end = (
        completed_end
        -
        timedelta(days=args.replication_shift)
    )

    replication_periods = periods(
        replication_end,
        args.train_days,
        args.validation_days,
        args.test_days,
    )

    overall_start = min(
        latest_periods["train"][0],
        replication_periods["train"][0],
    )

    print("=== BOAT RACE AI AutoML Search ===")
    print("collect:", overall_start, "->", completed_end)

    races = v10.collect(
        overall_start,
        completed_end,
    )

    latest_split = split_races(
        races,
        latest_periods,
    )

    replication_split = split_races(
        races,
        replication_periods,
    )

    latest_train, latest_val, latest_test = latest_split
    rep_train, rep_val, rep_test = replication_split

    if min(
        len(latest_train),
        len(latest_val),
        len(latest_test),
        len(rep_train),
        len(rep_val),
        len(rep_test),
    ) < 300:
        raise SystemExit(
            "insufficient races for AutoML"
        )

    candidates = candidate_space(
        args.max_candidates
    )

    print(
        f"search candidates={len(candidates)}"
    )

    # -----------------------------------------
    # Phase 1:
    # 最新validationだけで探索
    # testには触らない
    # -----------------------------------------

    search_results = []

    for i, candidate in enumerate(
        candidates,
        start=1,
    ):
        print(
            f"[SEARCH {i}/{len(candidates)}] "
            f"{candidate.features} "
            f"lr={candidate.lr} "
            f"l2={candidate.l2}"
        )

        result = evaluate_candidate(
            candidate,
            latest_train,
            latest_val,
        )

        search_results.append(result)

    search_results.sort(
        key=lambda x: x["score"],
        reverse=True,
    )

    finalists = search_results[
        :args.top_k
    ]

    # baselineとfullも比較対象として保証
    required = [
        [],
        LIVE,
    ]

    for features in required:
        found = next(
            (
                x
                for x in search_results
                if x["features"] == features
                and math.isclose(
                    x["lr"],
                    0.035,
                )
                and math.isclose(
                    x["l2"],
                    0.002,
                )
                and x["epochs"] == 300
            ),
            None,
        )

        if found is not None and found not in finalists:
            finalists.append(found)

    # -----------------------------------------
    # Phase 2:
    # finalistだけ最新test
    # -----------------------------------------

    latest_final = []

    for candidate in finalists:
        latest_final.append(
            final_test(
                candidate,
                latest_train,
                latest_val,
                latest_test,
            )
        )

    # -----------------------------------------
    # Phase 3:
    # 同じfinalistを45日前の別windowで
    # 完全に再学習・再評価
    # -----------------------------------------

    replication_final = []

    for candidate in finalists:
        replication_final.append(
            final_test(
                candidate,
                rep_train,
                rep_val,
                rep_test,
            )
        )

    combined = []

    for latest in latest_final:
        matching = next(
            x
            for x in replication_final
            if (
                x["features"] == latest["features"]
                and x["lr"] == latest["lr"]
                and x["l2"] == latest["l2"]
                and x["epochs"] == latest["epochs"]
            )
        )

        combined.append({
            "features": latest["features"],
            "lr": latest["lr"],
            "l2": latest["l2"],
            "epochs": latest["epochs"],
            "latest": latest["test"],
            "replication": matching["test"],
            "robustnessScore": robustness(
                latest,
                matching,
            ),
            "latestModel": {
                "mean": latest["mean"],
                "scale": latest["scale"],
                "weights": latest["weights"],
            },
        })

    combined.sort(
        key=lambda x: x["robustnessScore"],
        reverse=True,
    )

    best = combined[0]

    baseline = next(
        (
            x
            for x in combined
            if x["features"] == []
        ),
        None,
    )

    if baseline is None:
        raise SystemExit(
            "baseline finalist missing"
        )

    def non_worse(a, b):
        return (
            a["winnerTop1"] >= b["winnerTop1"]
            and
            a["winnerTop3"] >= b["winnerTop3"] - 0.002
            and
            a["trifectaTop3"] >= b["trifectaTop3"]
            and
            a["trifectaTop5"] >= b["trifectaTop5"]
            and
            a["logLoss"] <= b["logLoss"]
            and
            a["brier"] <= b["brier"]
        )

    promotion_candidate = (
        best["features"] != []
        and
        non_worse(
            best["latest"],
            baseline["latest"],
        )
        and
        non_worse(
            best["replication"],
            baseline["replication"],
        )
    )

    report = {
        "version": "v11-automl-search",
        "generatedAt": datetime.now(
            timezone.utc
        ).isoformat(),
        "productionChanged": False,
        "candidateCount": len(candidates),
        "finalistCount": len(finalists),
        "liveFeaturePool": LIVE,
        "latestPeriod": {
            k: [
                v[0].isoformat(),
                v[1].isoformat(),
            ]
            for k, v in latest_periods.items()
        },
        "replicationPeriod": {
            k: [
                v[0].isoformat(),
                v[1].isoformat(),
            ]
            for k, v in replication_periods.items()
        },
        "searchTop10": [
            {
                "features": x["features"],
                "lr": x["lr"],
                "l2": x["l2"],
                "epochs": x["epochs"],
                "score": x["score"],
                "validation": x["validation"],
            }
            for x in search_results[:10]
        ],
        "finalists": combined,
        "best": best,
        "baseline": baseline,
        "promotionCandidate": promotion_candidate,
    }

    output = Path(args.output)
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
        challenger = {
            "version": "v11-automl-challenger",
            "status": "automl-validated-challenger",
            "generatedAt": report["generatedAt"],
            "productionPromoted": False,
            "features": (
                list(v10.BASE_FEATURES)
                +
                best["features"]
            ),
            "liveFeatures": best["features"],
            "lr": best["lr"],
            "l2": best["l2"],
            "epochs": best["epochs"],
            "mean": best["latestModel"]["mean"],
            "scale": best["latestModel"]["scale"],
            "coefficients": best["latestModel"]["weights"],
            "latestOOS": best["latest"],
            "replicationOOS": best["replication"],
            "robustnessScore": best["robustnessScore"],
        }

        challenger_path = Path(
            args.challenger
        )

        challenger_path.write_text(
            json.dumps(
                challenger,
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    print(
        json.dumps(
            {
                "candidateCount": len(candidates),
                "finalists": len(finalists),
                "bestFeatures": best["features"],
                "promotionCandidate": promotion_candidate,
                "latest": best["latest"],
                "replication": best["replication"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

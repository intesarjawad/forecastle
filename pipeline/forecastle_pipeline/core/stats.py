from collections.abc import Sequence
from dataclasses import dataclass
from math import comb, isfinite, log
from statistics import fmean

import numpy as np
from numpy.typing import NDArray

BOOTSTRAP_RESAMPLES = 10_000
BOOTSTRAP_SEED = 0
MIN_HEADLINE_ROUNDS = 6
INTERVAL_PERCENTILES = (2.5, 97.5)


@dataclass(frozen=True)
class Estimate:
    """A chart-weighted estimate and its round-bootstrap percentile interval."""

    mean: float
    lower: float
    upper: float


@dataclass(frozen=True)
class Comparison:
    """Paired scaled-MAE difference and a sign test over contributing rounds."""

    estimate: Estimate | None
    charts: int
    rounds: int
    p_value: float


def _finite(values: Sequence[float]) -> None:
    if not all(isfinite(value) for value in values):
        msg = "Statistics require finite values"
        raise ValueError(msg)


def _indices(count: int) -> NDArray[np.int64]:
    return np.random.default_rng(BOOTSTRAP_SEED).integers(
        count, size=(BOOTSTRAP_RESAMPLES, count), dtype=np.int64
    )


def _estimate(mean: float, samples: NDArray[np.float64]) -> Estimate:
    bounds = np.percentile(samples, INTERVAL_PERCENTILES)
    return Estimate(mean, float(bounds[0]), float(bounds[1]))


def bootstrap_mean(rounds: Sequence[Sequence[float]]) -> Estimate | None:
    """Resample contributing rounds intact, weighting every included chart equally."""
    clusters = [values for values in rounds if values]
    if not clusters:
        return None
    for values in clusters:
        _finite(values)
    sums = np.asarray([sum(values) for values in clusters], dtype=np.float64)
    counts = np.asarray([len(values) for values in clusters], dtype=np.float64)
    indices = _indices(len(clusters))
    samples = sums[indices].sum(axis=1) / counts[indices].sum(axis=1)
    return _estimate(float(sums.sum() / counts.sum()), samples)


def bootstrap_skill(rounds: Sequence[Sequence[tuple[float, float]]]) -> Estimate | None:
    """Estimate 1 minus geometric mean of paired loss ratios, without dropping charts.

    A zero seasonal-naive loss makes the row's skill undefined. A zero forecaster
    loss with a positive baseline makes the geometric mean zero.
    """
    clusters = [pairs for pairs in rounds if pairs]
    if not clusters:
        return None
    pairs = [pair for cluster in clusters for pair in cluster]
    _finite([value for pair in pairs for value in pair])
    if any(value < 0 for pair in pairs for value in pair):
        msg = "Skill requires nonnegative losses"
        raise ValueError(msg)
    if any(baseline == 0 for _, baseline in pairs):
        return None
    logs = np.asarray(
        [
            sum(log(loss) - log(baseline) for loss, baseline in cluster if loss > 0)
            for cluster in clusters
        ],
        dtype=np.float64,
    )
    zeros = np.asarray([sum(loss == 0 for loss, _ in cluster) for cluster in clusters])
    counts = np.asarray([len(cluster) for cluster in clusters], dtype=np.float64)
    indices = _indices(len(clusters))
    samples = np.where(
        zeros[indices].sum(axis=1) > 0,
        1.0,
        1.0 - np.exp(logs[indices].sum(axis=1) / counts[indices].sum(axis=1)),
    )
    mean = 1.0 if zeros.sum() else 1.0 - float(np.exp(logs.sum() / counts.sum()))
    return _estimate(mean, samples)


def sign_test(round_means: Sequence[float]) -> float:
    """Return the exact two-sided binomial p-value, omitting tied round means."""
    _finite(round_means)
    positive = sum(value > 0 for value in round_means)
    negative = sum(value < 0 for value in round_means)
    count = positive + negative
    tail = sum(comb(count, index) for index in range(min(positive, negative) + 1))
    return min(1.0, 2 * tail / 2**count)


def paired_difference(rounds: Sequence[Sequence[tuple[float, float]]]) -> Comparison:
    """Compare crowd minus opponent by chart, with round-level inference."""
    differences = [[crowd - opponent for crowd, opponent in cluster] for cluster in rounds]
    means = [fmean(values) for values in differences if values]
    return Comparison(
        bootstrap_mean(differences),
        sum(len(values) for values in differences),
        len(means),
        sign_test(means),
    )

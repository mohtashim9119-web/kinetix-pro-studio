#!/usr/bin/env python3
"""
WS1 Session AD — Step 4: Class A discriminator search re-run on VALIDATED ground
truth (real amplitude/energy analysis, real 16kHz audio, real detected silences).

Session AB (2026-08-22) ran this same style of search over only 2 of the 4
Class A rows (`214_solitary_fire`, `447_scout_facing_dark`), against targets
whose only backing was `session-p-live` — a same-session self-transcription,
per Session AC's own finding (`docs/ws1-sync-pipeline/stage1-session-ac-ear-list.md`).
Session AD Step 0 ran a genuine operator A/B (side-by-side) listening pass over
all 8 open rows plus the historical row-0/`152_frozen_brush_mice`/item-7, and
every value it confirmed is IDENTICAL to what was already on record (see
Session AD's own ledger ingestion, `scripts/ws1-ear-pass-ledger.ts`, sitting
`ear-verify-ad`) — so the four Class A committed values below are unchanged
from Session AB; what changed is their evidentiary status, not their number.

This script adds the two Class A rows Session AB never tested
(`231_slowing_pace`, which is never a fitDeviation candidate at all, and
`152_frozen_brush_mice`/item-7, whose fitDeviation sits at the metric's own
mathematical floor) and performs a REAL best-threshold sweep per candidate
feature (both directions), rather than reporting one hand-picked threshold.

Ship bar (per session brief): recall must be 1.000 (catch all 4 confirmed
Class A rows) AND precision must be 1.000 (zero false positives among the 41
ear-confirmed controls, pooled across v6/173/spanish) before anything ships.
Do NOT tune per row — the search is over generic acoustic features, not
per-tag constants.

Read-only measurement script. Not part of any test suite. Requires
`.venv-phase4` (soundfile + numpy).
"""
import json
import os

import numpy as np
import soundfile as sf

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPLAY = os.path.join(REPO, '.work-phase4', 'replay')
AB_OUT = os.path.join(REPO, '.work-phase4', 'session-ab')
OUT = os.path.join(REPO, '.work-phase4', 'session-ad')
os.makedirs(OUT, exist_ok=True)

CORPORA = ['v6', '173', 'spanish']

# All four Class A rows, reconciled ground truth (Session AD Step 1/2).
# `152_frozen_brush_mice`/item-7 uses 451.03 -- the value `ear-12` (the
# earliest sitting on record) scored CORRECT, reinstated this session; NOT the
# 450.99 value Session P's own prose table mis-transcribed it as (see Session
# AD's ledger entry for the full supersession record).
CLASS_A = {
    'v6/214_solitary_fire': {'committed': 629.01, 'target': 630.09},
    'v6/231_slowing_pace': {'committed': 681.63, 'target': 682.74},
    'v6/447_scout_facing_dark': {'committed': 1417.12, 'target': 1418.53},
    'v6/152_frozen_brush_mice': {'committed': 449.20, 'target': 451.03},
}


def load_audio(corpus):
    path = os.path.join(REPLAY, corpus, 'audio_16k.wav')
    data, sr = sf.read(path, dtype='float32', always_2d=False)
    if data.ndim > 1:
        data = data[:, 0]
    return data, sr


def load_silences(corpus):
    with open(os.path.join(REPLAY, corpus, 'silences_native.json')) as f:
        d = json.load(f)
    return d['silences']


def rms(x):
    if len(x) == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64))))


def window(data, sr, t, half_width_sec):
    lo = max(0, int(round((t - half_width_sec) * sr)))
    hi = min(len(data), int(round((t + half_width_sec) * sr)))
    return data[lo:hi]


def nearest_silence(silences, t):
    best = None
    best_dist = float('inf')
    for s in silences:
        if s['startSec'] <= t <= s['endSec']:
            return s, 0.0
        d = min(abs(s['startSec'] - t), abs(s['endSec'] - t))
        if d < best_dist:
            best_dist = d
            best = s
    return best, best_dist


def features_at(data, sr, silences, t):
    """Every candidate amplitude/energy feature at timestamp t. Identical
    definitions to Session AB's step4-amplitude.py, so results are
    directly comparable."""
    before = window(data, sr, t - 0.15, 0.15)
    after = window(data, sr, t + 0.15, 0.15)
    rms_before = rms(before)
    rms_after = rms(after)
    silence, dist = nearest_silence(silences, t)
    silence_width = (silence['endSec'] - silence['startSec']) if silence else None
    silence_pcm = window(data, sr, (silence['startSec'] + silence['endSec']) / 2,
                          (silence['endSec'] - silence['startSec']) / 2) if silence else np.array([])
    silence_depth_rms = rms(silence_pcm) if silence else None
    silence_depth_peak = float(np.max(np.abs(silence_pcm))) if len(silence_pcm) else None
    at_pcm = window(data, sr, t, 0.025)
    rms_at = rms(at_pcm)
    return {
        't': t,
        'rms_before_300ms': rms_before,
        'rms_after_300ms': rms_after,
        'seam_asymmetry_abs': abs(rms_after - rms_before),
        'seam_asymmetry_ratio': (max(rms_before, rms_after) / max(min(rms_before, rms_after), 1e-9)),
        'rms_at_50ms': rms_at,
        'nearest_silence_dist': dist,
        'nearest_silence_width': silence_width,
        'nearest_silence_depth_rms': silence_depth_rms,
        'nearest_silence_depth_peak': silence_depth_peak,
    }


FEATURE_NAMES = [
    'seam_asymmetry_abs', 'seam_asymmetry_ratio', 'rms_at_50ms',
    'nearest_silence_dist', 'nearest_silence_width',
    'nearest_silence_depth_rms', 'nearest_silence_depth_peak',
]


def best_threshold(positives, negatives, feature, direction):
    """direction: '<=' means 'fires when feature <= threshold' (low value = suspicious);
    '>=' means 'fires when feature >= threshold'. Requires ALL positives to fire
    (recall=1.000); among thresholds achieving that, returns the one with fewest
    negative (control) fires (max precision). Candidate thresholds are the
    positives' own feature values (the loosest threshold that still catches every
    positive is always one of their own values, or exactly between two)."""
    pos_vals = [p[feature] for p in positives if p[feature] is not None]
    neg_vals = [n[feature] for n in negatives if n[feature] is not None]
    if len(pos_vals) < len(positives):
        return None  # a positive is missing this feature (no backing silence, etc.)

    if direction == '<=':
        # Loosest passing threshold = max(pos_vals) (every positive <= this).
        thr = max(pos_vals)
        fp = sum(1 for v in neg_vals if v <= thr)
    else:
        thr = min(pos_vals)
        fp = sum(1 for v in neg_vals if v >= thr)

    tp = len(pos_vals)
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / len(positives)
    return {
        'feature': feature, 'direction': direction, 'threshold': thr,
        'classA_caught': f'{tp}/{len(positives)}', 'control_fp': f'{fp}/{len(neg_vals)}',
        'precision': precision, 'recall': recall,
    }


def main():
    with open(os.path.join(AB_OUT, 'ear-confirmed-controls.json')) as f:
        controls = json.load(f)
    controls = [c for c in controls if c['tag'] not in ('run-0-onset', 'run-2-onset')]

    audio_cache = {}
    silence_cache = {}
    for c in CORPORA:
        audio_cache[c] = load_audio(c)
        silence_cache[c] = load_silences(c)

    positives = []
    for key, vals in CLASS_A.items():
        corpus, tag = key.split('/')
        data, sr = audio_cache[corpus]
        silences = silence_cache[corpus]
        f = features_at(data, sr, silences, vals['committed'])
        f.update({'corpus': corpus, 'tag': tag, 'label': 'committed_WRONG', 'group': 'classA'})
        positives.append(f)
        ft = features_at(data, sr, silences, vals['target'])
        ft.update({'corpus': corpus, 'tag': tag, 'label': 'target_CORRECT', 'group': 'classA_target'})
        positives.append(ft)  # kept for the dump, not used in the sweep (filtered below)

    negatives = []
    for c in controls:
        data, sr = audio_cache[c['corpus']]
        silences = silence_cache[c['corpus']]
        f = features_at(data, sr, silences, c['value'])
        f.update({'corpus': c['corpus'], 'tag': c['tag'], 'label': 'CONTROL_CORRECT', 'group': 'control'})
        negatives.append(f)

    all_rows = positives + negatives
    with open(os.path.join(OUT, 'step4-classA-features.json'), 'w') as fh:
        json.dump(all_rows, fh, indent=1)

    classA_wrong = [r for r in positives if r['label'] == 'committed_WRONG']
    print(f'Class A committed_WRONG rows (the defects to catch): {len(classA_wrong)}')
    print(f'Control rows (must NOT fire): {len(negatives)}')

    print('\n=== per-feature best-threshold sweep (both directions), recall forced to 1.000 ===')
    results = []
    for feature in FEATURE_NAMES:
        for direction in ('<=', '>='):
            r = best_threshold(classA_wrong, negatives, feature, direction)
            if r is not None:
                results.append(r)
                print(f"{feature:28s} {direction:2s} thr={r['threshold']:>10.5g}  "
                      f"classA={r['classA_caught']:>4s}  FP={r['control_fp']:>6s}  "
                      f"precision={r['precision']:.3f}  recall={r['recall']:.3f}")

    results.sort(key=lambda r: -r['precision'])
    with open(os.path.join(OUT, 'step4-classA-sweep.json'), 'w') as fh:
        json.dump(results, fh, indent=1)

    print('\n=== per-row feature values for the 4 Class A defects (for inspection) ===')
    for r in classA_wrong:
        print(' ', r['corpus'], r['tag'], {k: (round(r[k], 5) if isinstance(r[k], float) else r[k]) for k in FEATURE_NAMES})

    best = results[0] if results else None
    print('\n=== VERDICT ===')
    if best and best['precision'] >= 0.999 and best['recall'] >= 0.999:
        print(f"SHIP CANDIDATE: {best['feature']} {best['direction']} {best['threshold']} "
              f"— precision {best['precision']:.3f}, recall {best['recall']:.3f}, zero control false positives.")
    else:
        top = best
        print('NEGATIVE RESULT: no candidate reaches precision 1.000 at recall 1.000.')
        if top:
            print(f"Best candidate: {top['feature']} {top['direction']} {top['threshold']} "
                  f"— precision {top['precision']:.3f} ({top['control_fp']} control false positives), recall {top['recall']:.3f}.")


if __name__ == '__main__':
    main()

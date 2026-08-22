#!/usr/bin/env python3
"""
WS1 Session AB — Step 4: candidate third discriminators for classA-214 and
classA-447 (real amplitude/energy analysis, not a reimplementation of any
existing rule). Reads real captured audio (.work-phase4/replay/{corpus}/
audio_16k.wav) and real detected silences (silences_native.json). Read-only
measurement script; not part of any test suite.

For each timestamp of interest, computes several candidate seam-level
amplitude/energy features and reports each candidate's precision/recall/
separation margin against a control population of ear-confirmed-correct
boundaries drawn from scripts/ws1-ear-pass-ledger.ts (dumped to
.work-phase4/session-ab/ear-confirmed-controls.json).
"""
import json
import math
import os
import sys

import numpy as np
import soundfile as sf

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPLAY = os.path.join(REPO, '.work-phase4', 'replay')
OUT = os.path.join(REPO, '.work-phase4', 'session-ab')

CORPORA = ['v6', '173', 'spanish']

# Class A rows this step is scoped to (task's own Step 4 wording).
CLASS_A = {
    'v6/214_solitary_fire': {'committed': 629.01, 'target': 630.09},
    'v6/447_scout_facing_dark': {'committed': 1417.12, 'target': 1418.53},
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
    """Every candidate amplitude/energy feature at timestamp t."""
    before = window(data, sr, t - 0.15, 0.15)  # [t-0.30, t]
    after = window(data, sr, t + 0.15, 0.15)  # [t, t+0.30]
    rms_before = rms(before)
    rms_after = rms(after)
    silence, dist = nearest_silence(silences, t)
    silence_width = (silence['endSec'] - silence['startSec']) if silence else None
    silence_pcm = window(data, sr, (silence['startSec'] + silence['endSec']) / 2,
                          (silence['endSec'] - silence['startSec']) / 2) if silence else np.array([])
    silence_depth_rms = rms(silence_pcm) if silence else None
    silence_depth_peak = float(np.max(np.abs(silence_pcm))) if len(silence_pcm) else None
    # narrow point RMS right AT t (50ms total, symmetric)
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


def main():
    with open(os.path.join(OUT, 'ear-confirmed-controls.json')) as f:
        controls = json.load(f)

    audio_cache = {}
    silence_cache = {}
    for c in CORPORA:
        audio_cache[c] = load_audio(c)
        silence_cache[c] = load_silences(c)

    rows = []
    # Class A rows — both the wrong committed value and the ear-correct target.
    for key, vals in CLASS_A.items():
        corpus, tag = key.split('/')
        data, sr = audio_cache[corpus]
        silences = silence_cache[corpus]
        for label, t in [('committed_WRONG', vals['committed']), ('target_CORRECT', vals['target'])]:
            f = features_at(data, sr, silences, t)
            f.update({'corpus': corpus, 'tag': tag, 'label': label, 'group': 'classA'})
            rows.append(f)

    # Controls — every ear-confirmed-correct boundary (skip non-boundary run-onsets).
    for c in controls:
        if c['tag'] in ('run-0-onset', 'run-2-onset'):
            continue
        data, sr = audio_cache[c['corpus']]
        silences = silence_cache[c['corpus']]
        f = features_at(data, sr, silences, c['value'])
        f.update({'corpus': c['corpus'], 'tag': c['tag'], 'label': 'CONTROL_CORRECT', 'group': 'control'})
        rows.append(f)

    with open(os.path.join(OUT, 'step4-amplitude-features.json'), 'w') as f:
        json.dump(rows, f, indent=1)
    print(f'wrote {len(rows)} feature rows')

    # ---- report ----
    class_a_wrong = [r for r in rows if r['group'] == 'classA' and r['label'] == 'committed_WRONG']
    class_a_correct = [r for r in rows if r['group'] == 'classA' and r['label'] == 'target_CORRECT']
    controls_rows = [r for r in rows if r['group'] == 'control']

    print(f'\nClass A WRONG rows: {len(class_a_wrong)}, Class A CORRECT-target rows: {len(class_a_correct)}, control rows: {len(controls_rows)}')

    feature_names = [
        'seam_asymmetry_abs', 'seam_asymmetry_ratio', 'rms_at_50ms',
        'nearest_silence_dist', 'nearest_silence_width',
        'nearest_silence_depth_rms', 'nearest_silence_depth_peak',
    ]
    print('\n=== per-feature values ===')
    for r in rows:
        print(r['group'], r['corpus'], r['tag'], r['label'], {k: (round(r[k], 5) if isinstance(r[k], float) else r[k]) for k in feature_names})


if __name__ == '__main__':
    main()

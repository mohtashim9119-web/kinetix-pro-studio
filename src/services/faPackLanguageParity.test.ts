/**
 * FA pack / supported-language PARITY GUARD (WS2 T4.2 Step 1).
 *
 * WHY THIS EXISTS. The `unsupported` state of the Project Settings pack
 * detector (`FaPackStatus.tsx:81`) is deferred as "not user-reachable": the
 * language dropdown is built from `SUPPORTED_LANGUAGES`, and those five codes
 * are exactly the five FA packs, so no selection can produce it.
 *
 * NOTHING ENFORCED THAT. `FA_MODEL_LANGUAGES` (`models.ts:21`) is
 * `SUPPORTED_LANGUAGE_CODES` INTERSECTED with a hardcoded five-code literal,
 * and `models.rs:182` hardcodes the same five a third time with only a comment
 * tying them together. So adding a sixth language to `constants.ts` compiled
 * clean, passed every test, and made that "unreachable" branch reachable in the
 * dropdown on the same commit — with the Rust side rejecting the pack id too.
 *
 * The deferral is still correct; what was missing was anything that notices
 * when its premise stops holding. That is all this file does: it does not
 * argue the branch should render differently, it makes the premise fail loudly
 * instead of silently. A sixth language is a legitimate change — when it lands,
 * this test going red is the prompt to close the deferred entry rather than
 * discover it from a user seeing "No alignment pack exists".
 */

import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGE_CODES } from '../constants';
import { FA_MODEL_LANGUAGES } from './models';

describe('WS2 T4.2 — every supported language has an FA pack', () => {
  it('SUPPORTED_LANGUAGE_CODES and FA_MODEL_LANGUAGES are the same set', () => {
    // Set equality, not length: a swap (drop `pt`, add `it`) keeps both at 5.
    expect([...FA_MODEL_LANGUAGES].sort()).toEqual([...SUPPORTED_LANGUAGE_CODES].sort());
  });

  it('the detector\'s unsupported branch is therefore unreachable from the dropdown', () => {
    // The exact predicate `resolveFaPackState` uses, over the exact set the
    // Project Settings dropdown can offer.
    for (const code of SUPPORTED_LANGUAGE_CODES) {
      expect(FA_MODEL_LANGUAGES.includes(code), code).toBe(true);
    }
  });

  it('mirrors models.rs::FA_LANGUAGES, which is hardcoded a third time', () => {
    // If this ever diverges, `models.rs` rejects the `fa-<lang>` id and the
    // inline installer offers a download the backend refuses.
    expect([...FA_MODEL_LANGUAGES].sort()).toEqual(['de', 'en', 'es', 'fr', 'pt']);
  });
});

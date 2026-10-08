// Plain-English wording for every line the sync log panel shows. Each message
// gets two forms: `short` (one idea, fits in two lines of the panel) and
// `detail` (the full story in everyday words, shown when the user clicks).
// Built from structured fields wherever the log stores them; for the few
// entries that only store the app's own fixed sentence, the numbers are read
// back from that sentence. Wording only — nothing here decides what is shown.
import type { GroupedLogItem, SyncLogEntry } from '../types';
import { classifyScriptWpm } from './syncWpmGate';
import { WPM_NORMAL_MAX, WPM_NORMAL_MIN } from './syncConstants';

export interface Described { short: string; detail: string }

const s = (n: number, one: string, many: string): string => (n === 1 ? one : many);
const firstSentence = (text: string): string => {
  const m = /^(.+?[.!?])(\s|$)/.exec(text.trim());
  return m ? m[1]! : text.trim();
};
/** 0:03.05 style time. */
const clock = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const rest = sec - m * 60;
  return `${m}:${rest.toFixed(2).padStart(5, '0')}`;
};
const num = (detail: Record<string, unknown> | undefined, key: string): number | undefined =>
  (typeof detail?.[key] === 'number' ? (detail[key] as number) : undefined);
const sceneFromIndex = (i: number | undefined): string | undefined => (i === undefined ? undefined : `Scene ${i + 1}`);
/** The validators' own fixed opening: `Segment 12 ("…") …`. */
const sceneFromMessage = (message: string): string | undefined => {
  const m = /^Segment (\d+)/.exec(message);
  return m ? `Scene ${m[1]}` : undefined;
};
const withHint = (text: string, hint: string | undefined): string => (hint ? `${text} ${hint}` : text);

// ---------------------------------------------------------------------------
// Live project problems (not log entries)
// ---------------------------------------------------------------------------
export const LIVE_COPY = {
  missingMedia: (n: number): Described => ({
    short: `Scene ${n} has no media`,
    detail: `Scene ${n} has no picture or video. It will export as a black frame, and the export will use the slower path. Add a file for it, or leave it if black is what you want.`,
  }),
  sceneFileGone: (n: number): Described => ({
    short: `Scene ${n}: its file is gone`,
    detail: `Scene ${n} points to a file that is no longer in this project. Add the file again so the scene has something to show.`,
  }),
  offline: (name: string): Described => ({
    short: `${name} is offline`,
    detail: `The app can't find ${name} on this computer, so the export is blocked. Use Relink to show the app where the file is now.`,
  }),
  damaged: (name: string): Described => ({
    short: `${name} can't be opened`,
    detail: `${name} is here, but the app can't open it. It may be damaged or in a format the app doesn't read. Add a working copy with the same name and its scenes will switch to it.`,
  }),
  spotSceneRemoved: (n: number): Described => ({
    short: `Spot ${n}: its scene was removed`,
    detail: `The scene that spot ${n} was attached to has been removed. The spot stays where it last was. Attach it to a scene again in the Layer 2 panel.`,
  }),
  spotClipNotFound: (n: number, clipName?: string): Described => ({
    short: `Spot ${n}: clip not found`,
    detail: clipName
      ? `Spot ${n} asks for a clip called "${clipName}", but no file with that name was found. Add the file, or pick a clip for it in the Layer 2 panel.`
      : `Spot ${n} has no clip. Pick one for it in the Layer 2 panel.`,
  }),
  spotClipMissing: (n: number): Described => ({
    short: `Spot ${n}: its clip file is missing`,
    detail: `The clip for spot ${n} can't be found, so the spot would be left out of the export. Relink or add the file, or pick another clip in the Layer 2 panel.`,
  }),
};

// ---------------------------------------------------------------------------
// One item inside a grouped finding (per-scene checks)
// ---------------------------------------------------------------------------
export function describeGroupedItem(kind: string | undefined, item: GroupedLogItem): Described {
  const d = item.detail;
  const scene = sceneFromIndex(num(d, 'segmentIndex')) ?? sceneFromMessage(item.message) ?? 'A scene';
  switch (kind) {
    case 'weak-match': {
      const m = num(d, 'matchedWords'); const t = num(d, 'totalWords');
      return {
        short: m !== undefined && t !== undefined ? `${scene}: only ${m} of ${t} words heard` : `${scene}: few of its words were heard`,
        detail: `${m !== undefined && t !== undefined ? `Only ${m} of the ${t} words in ${scene.toLowerCase()} were heard in the voiceover.` : `Few of the words in ${scene.toLowerCase()} were heard in the voiceover.`} The text may have extra words, or the recording may say it differently. Check the scene's text.`,
      };
    }
    case 'scene-density': {
      const w = num(d, 'wordsPerSec'); const m = num(d, 'matchedWords'); const sec = num(d, 'durationSec');
      return {
        short: `${scene}: too many words for its length`,
        detail: `${m !== undefined && sec !== undefined ? `${scene} fits ${m} words into ${sec.toFixed(1)} seconds` : `${scene} has a lot of words for its length`}${w !== undefined ? ` (${w.toFixed(1)} words a second)` : ''}, faster than people speak. It may have leftover or repeated text.`,
      };
    }
    case 'tail-unmatched': {
      const words = Array.isArray(d?.words) ? (d.words as unknown[]).map(String).join(' ') : '';
      return {
        short: `${scene}: its last words weren't heard`,
        detail: `The last words of ${scene.toLowerCase()}${words ? ` ("${words}")` : ''} weren't heard in the audio, so its end was placed at the pause before the next scene.`,
      };
    }
    case 'unscripted-speech': {
      const a = num(d, 'startSec'); const b = num(d, 'endSec');
      const span = a !== undefined && b !== undefined ? `${clock(a).replace(/\.\d+$/, '')}–${clock(b).replace(/\.\d+$/, '')}` : 'Somewhere';
      const len = a !== undefined && b !== undefined ? ` (${Math.max(1, Math.round(b - a))}s)` : '';
      const into = sceneFromIndex(num(d, 'segmentIndex'));
      return {
        short: `${span}${len}${into ? ` went into ${into.toLowerCase()}` : ''}`,
        detail: `There is speech at ${span}${len} that isn't in your script, such as a heading read aloud, an intro or a retake. ${into ? `It was added to the start of ${into.toLowerCase()}, so that scene runs a little longer.` : 'It sits before the first scene.'} If it should be on its own, add it to the script and sync again.`,
      };
    }
    case 'numeric-unmatched': {
      const tokens = Array.isArray(d?.tokens) ? (d.tokens as unknown[]).map(t => `"${String(t)}"`).join(', ') : '';
      return {
        short: `${scene}: a number wasn't heard`,
        detail: `${scene} has a number or symbol${tokens ? ` (${tokens})` : ''} that didn't match what was said. Numbers are often spoken differently from how they're written. Check the cut if it looks off.`,
      };
    }
    default:
      return { short: firstSentence(item.message), detail: withHint(item.message, item.fixHint) };
  }
}

// ---------------------------------------------------------------------------
// A whole log entry
// ---------------------------------------------------------------------------
function describeMediaImport(entry: SyncLogEntry): Described {
  // The app's own sentence: "<Label>: 12 imported, already in your project: a, b, 1 unsupported, 2 failed."
  const m = /^(.+?): (.*)\.$/.exec(entry.message);
  const body = m ? m[2]! : entry.message;
  const imported = Number(/(\d+) imported/.exec(body)?.[1] ?? 0);
  const deduped = Number(/(\d+) deduped/.exec(body)?.[1] ?? 0);
  const unsupported = Number(/(\d+) unsupported/.exec(body)?.[1] ?? 0);
  const failed = Number(/(\d+) failed/.exec(body)?.[1] ?? 0);
  const dupNames = /already in your project: (.+?)(?:, \d+ (?:unsupported|failed)|, nested|$)/.exec(body)?.[1];
  const nested = /not opened \(only one level is unpacked\): (.+)$/.exec(body)?.[1];
  const shortParts = [`${imported} ${s(imported, 'file', 'files')} added`];
  if (failed > 0) shortParts.push(`${failed} failed`);
  const detail: string[] = [`${imported} ${s(imported, 'file was', 'files were')} added to the project.`];
  if (dupNames) detail.push(`Already in the project, so skipped: ${dupNames}.`);
  else if (deduped > 0) detail.push(`${deduped} ${s(deduped, 'was', 'were')} already in the project, so ${s(deduped, 'it was', 'they were')} skipped.`);
  if (unsupported > 0) detail.push(`${unsupported} ${s(unsupported, 'file is', 'files are')} a type the app can't use.`);
  if (failed > 0) detail.push(`${failed} ${s(failed, 'file', 'files')} failed to import. Try adding ${s(failed, 'it', 'them')} again.`);
  if (nested) detail.push(`A zip inside the zip was not opened (${nested}). Unzip it and add its files directly.`);
  return { short: shortParts.join(' · '), detail: detail.join(' ') };
}

function describeMediaMatch(entry: SyncLogEntry): Described {
  const collision = /^(\d+) files named "(.+?)"/.exec(entry.message);
  if (collision) {
    return {
      short: `${collision[1]} files share the name ${collision[2]}`,
      detail: `${collision[1]} files are named "${collision[2]}". When matching, the oldest one is used. Rename the others so each name is unique.`,
    };
  }
  const matched = Number(/(\d+) scenes? matched/.exec(entry.message)?.[1] ?? 0);
  const unmatched = Number(/(\d+) unmatched/.exec(entry.message)?.[1] ?? 0);
  const list = /\(kept their current media\): (.+?)\.(?: |$)/.exec(entry.message)?.[1];
  const placeholders = Number(/(\d+) scenes? still shows?/.exec(entry.message)?.[1] ?? 0);
  const manual = Number(/(\d+) manual picks? kept/.exec(entry.message)?.[1] ?? 0);
  const detail: string[] = [`${matched} ${s(matched, 'scene got its', 'scenes got their')} media by file name.`];
  if (unmatched > 0) detail.push(`${unmatched} had no file with a matching name and kept what ${s(unmatched, 'it', 'they')} had${list ? `: ${list}` : ''}.`);
  if (manual > 0) detail.push(`${manual} ${s(manual, 'scene you set by hand was', 'scenes you set by hand were')} left alone.`);
  if (placeholders > 0) detail.push(`${placeholders} ${s(placeholders, 'scene still has', 'scenes still have')} no media. Add files named for ${s(placeholders, 'it', 'them')}, then run Match again.`);
  return {
    short: unmatched > 0 ? `Media matched to ${matched} scenes · ${unmatched} without a match` : `Media matched to ${matched} ${s(matched, 'scene', 'scenes')}`,
    detail: detail.join(' '),
  };
}

function describeRule(entry: SyncLogEntry): Described {
  const rd = entry.ruleDetail;
  const scene = sceneFromIndex(entry.segmentIndex);
  if (entry.owningRule === 'R.5' && rd?.spanStartSec !== undefined && rd.spanEndSec !== undefined) {
    const span = `${clock(rd.spanStartSec)}–${clock(rd.spanEndSec)}`;
    return {
      short: `Unscripted speech skipped (${span})`,
      detail: `There is speech at ${span} that isn't in your script, such as an intro or a retake. It was left out when timing the scenes.`,
    };
  }
  if (entry.owningRule === 'R.10') {
    return {
      short: `${scene ?? 'A scene'} wasn't spoken, so it was skipped`,
      detail: `The words of ${scene ? scene.toLowerCase() : 'this scene'} don't appear in the voiceover, so the scene was left out of the timing.`,
    };
  }
  if (rd?.committedValue !== undefined && rd.correctedValue !== undefined) {
    const delta = Math.abs(rd.correctedValue - rd.committedValue);
    return {
      short: `${scene ?? 'A cut'}: cut moved ${delta.toFixed(2)}s automatically`,
      detail: `An automatic check moved the cut at ${scene ? scene.toLowerCase() : 'this scene'} from ${clock(rd.committedValue)} to ${clock(rd.correctedValue)} so it lines up with the speech. Nothing to do unless it looks wrong.`,
    };
  }
  return {
    short: `${scene ?? 'A cut'}: timing adjusted automatically`,
    detail: `An automatic check adjusted the timing${scene ? ` at ${scene.toLowerCase()}` : ''} so it follows the speech more closely. Nothing to do unless it looks wrong.`,
  };
}

const PAUSE_COPY: Record<string, Described> = {
  'hopeless-local-coverage': {
    short: "Script and voiceover don't match",
    detail: "Very few of the script's words were heard in the voiceover. This usually means the wrong script or the wrong audio file is loaded. Check both files, then sync again.",
  },
  'model-not-found': {
    short: 'Timing model is missing',
    detail: 'The model used for precise timing is not installed. Install it from Manage models, then try again.',
  },
  'model-hash-mismatch': {
    short: 'Timing model is damaged',
    detail: 'The model used for precise timing failed its check. Reinstall it from Manage models, then try again.',
  },
  offline: {
    short: "The cloud couldn't be reached",
    detail: "The cloud sync service couldn't be reached, even after a retry. Check your internet connection, or run this sync on this computer.",
  },
  'cloud-auth': {
    short: "Cloud didn't accept this computer's key",
    detail: "The cloud sync service didn't accept this computer's key. Check it in App Settings → Sync Engine → Cloud sync.",
  },
  'unsupported-language': {
    short: 'No timing model for this language',
    detail: "There is no precise-timing model for this project's language. Continue with standard timing, or change the project language.",
  },
};

export function describeEntry(entry: SyncLogEntry): Described {
  const f = entry.finding;
  const count = f?.count ?? 0;
  const scene = sceneFromIndex(entry.segmentIndex) ?? sceneFromMessage(entry.message);
  switch (entry.type) {
    case 'skip': {
      const n = (entry.segmentIndex ?? 0) + 1;
      const tag = entry.segmentTag ? ` (${entry.segmentTag})` : '';
      return {
        short: `Scene ${n} wasn't spoken`,
        detail: `The words of scene ${n}${tag} aren't in the voiceover. The scene stays on the timeline as a placeholder with an estimated length, so nothing around it moved. If it should be spoken, check the script or the recording, then sync again.`,
      };
    }
    case 'no-asset': return { short: 'Some scenes had no media', detail: withHint(entry.message, entry.fixHint) };
    case 'abort': return { short: `Sync stopped: ${firstSentence(entry.message).replace(/^Sync aborted:\s*/i, '')}`, detail: withHint(entry.message, entry.fixHint) };
    case 'whisper-model-failure':
      return {
        short: 'Speech model is missing or damaged',
        detail: 'The speech-recognition model the app needs is missing or damaged, so the sync could not run. Reinstall it from Manage models, then try again.',
      };
    case 'unsupported-language':
      return {
        short: 'No speech model for this language',
        detail: "There is no speech model for this project's language, so the sync could not run. Change the project language, or install that language.",
      };
    case 'fa-paused':
      return PAUSE_COPY[String(entry.reason)] ?? {
        short: 'Precise timing stopped',
        detail: 'Precise timing stopped before it finished, so the timeline was not changed. Try again, or continue with standard timing.',
      };
    case 'lock-refused':
      return {
        short: `${scene ?? 'A scene'} couldn't be locked`,
        detail: 'Locking this scene would have left an empty gap next to another locked scene. Unlock that one first, or close the gap, then lock again.',
      };
    case 'lock-not-restored':
      return {
        short: `${scene ?? 'A scene'}: its lock was removed`,
        detail: "This scene changed during the sync, so its lock couldn't be put back. Check the scene, and lock it again if you need to.",
      };
    case 'lock-span-overflow':
      return {
        short: `${scene ?? 'A scene'} is squeezed by a lock`,
        detail: `${scene ?? 'This scene'} has less room than its text needs because a scene next to it is locked. Unlock that scene, or shorten this one's text.`,
      };
    case 'rescue':
      return {
        short: `${scene ?? 'A scene'} was found on a second search`,
        detail: `${scene ?? 'This scene'} wasn't found at first, but a closer search found its words in the audio. Its timing comes from that second search.`,
      };
    case 'rule-correction': return describeRule(entry);
    case 'silence-error':
      return {
        short: 'Pause detection failed; a fallback was used',
        detail: "The app couldn't measure the quiet gaps in the audio, so cuts were placed without them. Timing may be a little less exact.",
      };
    case 'fa-preflight':
      return {
        short: 'Precise timing was not ready',
        detail: withHint("Precise timing couldn't start, so standard timing was used.", entry.fixHint),
      };
    case 'fa-gate-closed':
      return entry.reason !== undefined
        ? {
          short: 'Standard timing used after a pause',
          detail: 'When precise timing paused, you chose to continue with standard timing. Cuts may be a little less exact. Sync again to retry precise timing.',
        }
        : {
          short: 'Precise timing is turned off',
          detail: 'High-precision sync is off for this project, so standard timing was used. Turn it on in Project Settings for more exact cuts.',
        };
    case 'media-import': return describeMediaImport(entry);
    case 'media-match': return describeMediaMatch(entry);
    default: break;
  }
  switch (f?.kind) {
    case 'wpm': {
      const wpm = f.count ?? Number(/reads at (\d+(?:\.\d+)?) words\/min/.exec(entry.message)?.[1] ?? NaN);
      const band = Number.isFinite(wpm) ? classifyScriptWpm(wpm, 60).band : undefined;
      const range = `${WPM_NORMAL_MIN}–${WPM_NORMAL_MAX}`;
      if (band === 'soft-slow') return { short: 'Script pace is too slow. Check your files.', detail: `The script reads at ${Math.round(wpm)} words a minute over this voiceover, slower than normal narration (${range}). The sync worked, but if this looks wrong, check that the script and audio belong together.` };
      if (band === 'soft-fast') return { short: 'Script pace is too fast. Check your files.', detail: `The script reads at ${Math.round(wpm)} words a minute over this voiceover, faster than normal narration (${range}). The sync worked, but if this looks wrong, check that the script and audio belong together.` };
      if (band === 'hard-fast') return { short: 'Script pace is far too fast. Check your files.', detail: `The script reads at ${Math.round(wpm)} words a minute over this voiceover, faster than anyone can speak. The script probably has extra or repeated text. Check both files.` };
      return { short: 'Script pace looks unusual. Check your files.', detail: 'The script and voiceover lengths look unusual together. If the timeline looks wrong, check that the script and audio belong together.' };
    }
    case 'local-coverage': return PAUSE_COPY['hopeless-local-coverage']!;
    case 'ctc-infeasible':
      return {
        short: `${count} ${s(count, 'word was', 'words were')} timed by estimate`,
        detail: `In part of the audio the app couldn't time words exactly, so ${count} ${s(count, 'word was', 'words were')} placed by estimate. Cuts nearby may be a little off. Check them if something looks wrong.`,
      };
    case 'fa-victim-retimed':
      return {
        short: `${count} ${s(count, 'scene uses', 'scenes use')} standard timing`,
        detail: `Precise timing failed for ${count} ${s(count, 'scene', 'scenes')}, so ${s(count, 'its cut comes', 'their cuts come')} from standard timing instead. ${s(count, 'It is', 'They are')} usually close. Check ${s(count, 'it', 'them')} if something looks off.`,
      };
    case 'character-fallback':
      return {
        short: 'Scenes timed from text length',
        detail: 'No transcript of the voiceover was available, so every scene\'s length was estimated from how much text it has. Sync again once the voiceover is transcribed to get real timing.',
      };
    case 'tail-unmatched':
    case 'numeric-unmatched':
    case 'weak-match':
    case 'scene-density':
      return describeGroupedItem(f.kind, { message: entry.message, fixHint: entry.fixHint });
    case 'freeze-frame':
      return {
        short: `${scene ?? 'A scene'}: clip is shorter than the scene`,
        detail: `The video for ${scene ? scene.toLowerCase() : 'this scene'} ends before the scene does, so its last frame stays on screen until the next scene. Use a longer clip if you don't want that pause.`,
      };
    case 'boundary-delta':
      return {
        short: 'A cut moved after the timing engine changed',
        detail: 'This sync used a different timing engine than last time, and at least one cut moved by more than a tenth of a second. Check it if it looks off.',
      };
    case 'asset-relinked': {
      const names = entry.message.replace(/^Relinked(?: \d+ files)?: /, '');
      return { short: `Relinked: ${names}`, detail: `${names} ${s(count || 1, 'was', 'were')} offline and ${s(count || 1, 'has', 'have')} been found again.` };
    }
    case 'asset-replaced':
      return { short: 'A damaged file was replaced', detail: withHint(`${firstSentence(entry.message)} Its scenes now use the new copy.`, undefined) };
    case 'asset-unverified':
      return { short: "A file couldn't be checked", detail: "The app couldn't confirm a file is the same one you added before. It will still be used." };
    case 'asset-missing':
      return { short: 'A file was offline when the project opened', detail: withHint(entry.message, entry.fixHint) };
    case 'asset-corrupt':
      return { short: "A file couldn't be opened", detail: withHint(entry.message, entry.fixHint) };
    case 'spot-segment-unmatched':
      return { short: 'A Layer 2 block matched no scene', detail: "A Layer 2 block in your scene doc names a scene that isn't on the timeline, so it wasn't placed. Check its tag." };
    case 'spot-clip-unmatched':
      return { short: 'A Layer 2 clip was not found', detail: 'A Layer 2 block asks for a clip that isn\'t in your media. Add the file, or pick a clip in the Layer 2 panel.' };
    case 'spot-clip-missing':
      return { short: 'A Layer 2 clip is missing at export', detail: 'A spot\'s clip file is missing, so the spot will be left out of the export. Add the file again, or pick another clip.' };
    case 'spot-past-voiceover':
      return { short: 'A spot was cut off at the end', detail: 'A Layer 2 spot ran past the end of the voiceover, so it was shortened to end with it.' };
    case 'spot-overlap':
      return { short: 'Two spots overlap; the later one shows', detail: 'Two Layer 2 spots are on screen at the same time. Only the later one is shown while they overlap. Move one if you want both.' };
    case 'bundle-import-failed':
      return { short: "A bundle couldn't be imported", detail: withHint(entry.message, entry.fixHint) };
    default:
      return { short: firstSentence(entry.message), detail: withHint(entry.message, entry.fixHint) };
  }
}

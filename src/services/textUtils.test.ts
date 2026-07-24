/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { stripRtfIfNeeded, detectTextFileRole } from './textUtils';

describe('stripRtfIfNeeded', () => {
  it('strips a font table, leaving only body text (QB1)', () => {
    const input =
      '{\\rtf1\\ansi {\\fonttbl{\\f0\\fnil\\fcharset0 Helvetica;}{\\f1\\fnil Times New Roman;}} Hello world}';
    const out = stripRtfIfNeeded(input);
    expect(out).toBe('Hello world');
    expect(out).not.toMatch(/Helvetica/);
    expect(out).not.toMatch(/Times New Roman/);
  });

  it('strips a color table, leaving only body text (QB1)', () => {
    const input = '{\\rtf1\\ansi {\\colortbl ;\\red255\\green0\\blue0;} Hello world}';
    const out = stripRtfIfNeeded(input);
    expect(out).toBe('Hello world');
    expect(out).not.toMatch(/red255|green0|blue0/);
  });

  it('strips multiple nested destinations (fonttbl, colortbl, info) (QB1)', () => {
    const input =
      '{\\rtf1\\ansi ' +
      '{\\fonttbl{\\f0\\fnil\\fcharset0 Helvetica;}} ' +
      '{\\colortbl;\\red255\\green255\\blue255;} ' +
      '{\\info{\\title My Document}{\\author Jane Doe}} ' +
      'Hello world}';
    const out = stripRtfIfNeeded(input);
    expect(out).toBe('Hello world');
    expect(out).not.toMatch(/Helvetica|red255|My Document|Jane Doe/);
  });

  it('skips a starred (optional) destination entirely (QB1)', () => {
    const input = '{\\rtf1\\ansi {\\*\\generator Msftedit 5.41.15.1515;} Hello world}';
    const out = stripRtfIfNeeded(input);
    expect(out).toBe('Hello world');
    expect(out).not.toMatch(/Msftedit|generator/);
  });

  it('passes plain (non-RTF) text through unchanged', () => {
    const input = 'Just a normal script line.\nAnother line.';
    expect(stripRtfIfNeeded(input)).toBe(input);
  });

  it('preserves body-level formatting control words (bold/italic/par) (QB1)', () => {
    const input = '{\\rtf1\\ansi {\\b Bold text\\par \\i Italic text}}';
    const out = stripRtfIfNeeded(input);
    // \par converts to a paragraph break (pre-existing, unchanged behavior —
    // see the `par`/`pard`/`sect` branch above); the point of this test is
    // that body-level control words still work while destination groups
    // (fonttbl/colortbl/etc.) are skipped, not the exact newline count.
    expect(out).toBe('Bold text\n\nItalic text');
  });

  it('strips a real-world TextEdit-saved RTF document to just the body text (QB1)', () => {
    const input = `{\\rtf1\\ansi\\ansicpg1252\\cocoartf1671\\cocoasubrtf500
{\\fonttbl\\f0\\fnil\\fcharset0 Helvetica;}
{\\colortbl;\\red255\\green255\\blue255;}
{\\*\\expandedcolortbl;;}
\\margl1440\\margr1440\\vieww10800\\viewh8400\\viewkind0
\\pard\\tx720\\tx1440\\tx2160\\tx2880\\tx3600\\tx4320\\tx5040\\tx5760\\tx6480\\tx7200\\tx7920\\tx8640\\pardirnatural\\partightenabler0
\\f0\\fs24 \\cf0 Hello world\\
}`;
    const out = stripRtfIfNeeded(input);
    expect(out.trim()).toBe('Hello world');
    expect(out).not.toMatch(/Helvetica|red255|expandedcolortbl|margl|vieww/);
  });
});

describe('detectTextFileRole', () => {
  it('treats content with 3+ bracket tags as sceneDetails', () => {
    expect(detectTextFileRole('[a.jpg]\ntext\n[b.jpg]\ntext\n[c.jpg]\ntext')).toBe('sceneDetails');
  });

  it('treats content with fewer than 3 bracket tags as script', () => {
    expect(detectTextFileRole('Just a plain voiceover script.')).toBe('script');
  });
});

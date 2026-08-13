/**
 * The vocabulary guard.
 *
 * The brief for this app bans a specific set of words from the screen: the
 * operator console's language, and anything about accounts. Bans written only in
 * a brief last until the next feature, so this test enforces it two ways:
 *
 *   1. it reads the rendering layer's source and checks every string literal and
 *      every piece of JSX text — catching a component that starts explaining
 *      itself;
 *   2. it walks the feed data structure and checks the fields that actually
 *      reach a screen — catching a message that arrives already wrong.
 *
 * The second list is deliberately narrow and explicit. `SafetyVerdict.reason`,
 * for instance, is not checked, because it is written for the operator console
 * and this app never renders it. If a screen ever starts to, that line has to be
 * added here first, which is the argument the reviewer wants to have.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DAY_LABELS, buildDay } from './feed/mock';
import {
  CROSSING_WORDS,
  UNKNOWN_NOTE,
  WAY_AHEAD_ROUTE_SENTENCE,
  WAY_AHEAD_SENTENCE,
  WAY_AHEAD_WORD,
} from './feed/words';

const SRC = dirname(fileURLToPath(import.meta.url));

/** Everything that draws pixels, plus the file all crowd-state wording lives in. */
const RENDERING_LAYER = ['screens', 'ui', 'demo', 'feed/words.ts'];

const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /congest/i, why: 'console vocabulary' },
  { pattern: /bottleneck/i, why: 'console vocabulary' },
  { pattern: /intervention/i, why: 'console vocabulary' },
  { pattern: /\bdensit/i, why: 'a figure the spectator cannot act on' },
  { pattern: /\bcapacit/i, why: 'a ratio the spectator cannot act on' },
  { pattern: /\bconfidence\b/i, why: 'model self-reporting' },
  { pattern: /\bhorizon\b/i, why: 'prediction horizon' },
  { pattern: /\bprobabilit/i, why: 'model self-reporting' },
  { pattern: /\bforecast/i, why: 'model self-reporting' },
  { pattern: /level of service|\bLOS\b/i, why: 'Fruin grades are console-only' },
  { pattern: /ped\/m|per metre per minute/i, why: 'flow units' },
  { pattern: /\blog ?in\b|\bsign in\b|\bpassword\b|\baccount\b/i, why: 'this app has no account' },
];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    if (statSync(path).isFile()) {
      if (/\.tsx?$/.test(path) && !path.endsWith('.test.ts')) out.push(path);
      return;
    }
    for (const entry of readdirSync(path)) walk(join(path, entry));
  };
  for (const target of RENDERING_LAYER) walk(join(SRC, target));
  return out;
}

/**
 * Comments are stripped first, on purpose: the modules in this app explain at
 * length why the banned words are banned, and a naive grep would flag the
 * reasoning along with the offence.
 */
function visibleText(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const found: string[] = [];
  for (const match of code.matchAll(/'([^'\\]*)'|"([^"\\]*)"|`([^`\\]*)`/g)) {
    found.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  // JSX text: between a closing angle bracket and the next opening one, with no
  // braces in between (those are expressions, and their strings are caught above).
  for (const match of code.matchAll(/>([^<>{}]+)</g)) {
    found.push(match[1] ?? '');
  }
  return found.filter((text) => /[a-z]{3}/i.test(text));
}

function offences(text: string): string[] {
  return BANNED.filter(({ pattern }) => pattern.test(text)).map(({ pattern, why }) => `${pattern} (${why})`);
}

describe('the rendering layer speaks the user’s language', () => {
  const files = sourceFiles();

  it('finds the files it is supposed to be guarding', () => {
    // A guard that silently stops matching any files passes forever.
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files.map((f) => [relative(SRC, f), f] as const))('%s', (_name, file) => {
    for (const text of visibleText(readFileSync(file, 'utf8'))) {
      expect(offences(text), `"${text}"`).toEqual([]);
    }
  });
});

describe('the words the feed can put on screen', () => {
  const day = buildDay(1_700_000_000);

  /** Exactly the fields a screen renders. Adding one here is a design decision. */
  function rendered(): string[] {
    const out: string[] = [];
    for (const view of Object.values(day)) {
      out.push(view.route.from, view.route.to);
      const routes = [view.route];
      if (view.kind === 'ahead') routes.push(view.offer.instead);
      if (view.kind === 'rerouted') routes.push(view.instead_of);
      for (const route of routes) {
        for (const step of route.steps) {
          out.push(step.to);
          if (step.crossing) out.push(step.crossing.name);
        }
      }
      if (view.kind === 'arrival') {
        out.push(view.note);
        for (const gate of view.gates) out.push(gate.name, gate.note ?? '');
      }
      if (view.kind === 'ahead') out.push(view.offer.command.reason);
      if (view.kind === 'rerouted') out.push(view.reason);
      if (view.kind === 'hold') {
        out.push(view.headline, view.because);
        for (const option of view.options) out.push(option.label, option.spent);
      }
    }
    return out.filter(Boolean);
  }

  it('says nothing from the console vocabulary', () => {
    for (const text of rendered()) {
      expect(offences(text), `"${text}"`).toEqual([]);
    }
  });

  it('applies the same rule to the fixed crowd-state wording', () => {
    const fixed = [
      ...Object.values(WAY_AHEAD_WORD),
      ...Object.values(WAY_AHEAD_SENTENCE),
      ...Object.values(WAY_AHEAD_ROUTE_SENTENCE),
      UNKNOWN_NOTE,
      CROSSING_WORDS.openNow,
      CROSSING_WORDS.openUnknown,
      CROSSING_WORDS.closedUnknown,
      CROSSING_WORDS.openUntil('4 min'),
      CROSSING_WORDS.closedUntil('4 min'),
      ...Object.values(DAY_LABELS).flatMap((label) => [label.title, label.when]),
    ];
    for (const text of fixed) {
      expect(offences(text), `"${text}"`).toEqual([]);
    }
  });

  it('has a word for every state of the way ahead, including not knowing', () => {
    expect(Object.keys(WAY_AHEAD_WORD).sort()).toEqual([
      'building',
      'critical',
      'nominal',
      'unknown',
    ]);
    // The three bands must read as three different things at a glance.
    expect(new Set(Object.values(WAY_AHEAD_WORD)).size).toBe(4);
  });

  it('does not claim a whole route is unreported when only part of it is', () => {
    // The bug this caught: the route headline borrowed the per-leg sentence and
    // told someone that nobody was reporting from a route, three legs of which
    // were reporting.
    expect(WAY_AHEAD_ROUTE_SENTENCE.unknown).not.toBe(WAY_AHEAD_SENTENCE.unknown);
    expect(WAY_AHEAD_ROUTE_SENTENCE.unknown).toMatch(/part/i);
  });
});

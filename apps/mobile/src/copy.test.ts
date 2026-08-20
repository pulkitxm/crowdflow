
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

function stripComments(source: string): string {
  let out = '';
  let quote: "'" | '"' | '`' | null = null;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    const next = source[i + 1];
    if (quote) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      out += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 1;
      out += ' ';
      continue;
    }
    out += char;
  }
  return out;
}

function visibleText(source: string): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  for (const match of code.matchAll(/'([^'\\]*)'|"([^"\\]*)"|`([^`\\]*)`/g)) {
    found.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  for (const match of code.matchAll(/>([\s\S]*?)</g)) {
    const raw = match[1] ?? '';
    for (const segment of raw.split(/[{}]/)) found.push(segment);
  }
  return found.filter((text) => /[a-z]{3}/i.test(text));
}

function offences(text: string): string[] {
  return BANNED.filter(({ pattern }) => pattern.test(text)).map(({ pattern, why }) => `${pattern} (${why})`);
}

describe('the rendering layer speaks the user’s language', () => {
  const files = sourceFiles();

  it('finds the files it is supposed to be guarding', () => {
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
    expect(new Set(Object.values(WAY_AHEAD_WORD)).size).toBe(4);
  });

  it('does not claim a whole route is unreported when only part of it is', () => {
    expect(WAY_AHEAD_ROUTE_SENTENCE.unknown).not.toBe(WAY_AHEAD_SENTENCE.unknown);
    expect(WAY_AHEAD_ROUTE_SENTENCE.unknown).toMatch(/part/i);
  });
});

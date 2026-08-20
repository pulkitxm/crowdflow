import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from '@babel/parser';

const args = process.argv.slice(2);
const selftest = args.includes('--selftest');
const strip = args.includes('--strip');
const all = strip || args.includes('--all');
const prefixes = args.filter((arg) => !arg.startsWith('--'));

function allowed(raw) {
  const body = raw
    .replace(/^(\/\/+|\/\*+|<!--|#)/, '')
    .replace(/(\*\/|-->)$/, '')
    .trim()
    .replace(/^\*+\s*/, '');
  return [
    /^<(reference|amd-)/,
    /^@(ts-ignore|ts-expect-error|ts-nocheck|ts-check)\b/,
    /^eslint-(disable|enable)(-next-line|-line)?\b/,
    /^(eslint-env|eslint\s|globals?\s|exported\b)/,
    /^biome-ignore\b/,
    /^prettier-ignore\b/,
    /^@(jsx|jsxImportSource|jsxRuntime|jsxFrag)\b/,
    /^swift-tools-version\b/,
    /^swiftlint:/,
    /^swift-format\b/,
    /^#\s*source(MappingURL|URL)\b/,
    /^@vite-ignore\b/,
    /^[#@]__(PURE|NO_SIDE_EFFECTS)__\b/,
    /^(istanbul|c8|v8)\s+ignore\b/,
    /^@(license|preserve)\b/,
    /^yaml-language-server\b/,
    /^yamllint\b/,
    /webpack(ChunkName|Mode|Prefetch|Preload|Include|Exclude|Ignore)/,
  ].some((pattern) => pattern.test(body)) || raw.startsWith('/*!');
}

function scriptComments(file, source) {
  const plugins = [];
  if (/\.(c|m)?tsx?$/.test(file)) plugins.push('typescript');
  if (/\.[jt]sx$/.test(file)) plugins.push('jsx');
  const tree = parse(source, {
    sourceType: 'unambiguous',
    plugins,
    errorRecovery: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  });
  return (tree.comments ?? [])
    .map((comment) => ({ start: comment.start, end: comment.end }))
    .filter((range) => !allowed(source.slice(range.start, range.end)));
}

function delimitedComments(source, lineComments, nestedBlocks, tripleStrings) {
  const ranges = [];
  let index = 0;
  let quote = null;
  while (index < source.length) {
    if (quote) {
      if (quote === '"""' && source.startsWith('"""', index)) {
        quote = null;
        index += 3;
        continue;
      }
      const char = source[index];
      if (quote !== '"""' && char === '\\') {
        index += 2;
        continue;
      }
      if (quote !== '"""' && char === quote) quote = null;
      index += 1;
      continue;
    }
    if (tripleStrings && source.startsWith('"""', index)) {
      quote = '"""';
      index += 3;
      continue;
    }
    const char = source[index];
    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }
    if (lineComments && source.startsWith('//', index)) {
      const end = source.indexOf('\n', index);
      const stop = end === -1 ? source.length : end;
      if (!allowed(source.slice(index, stop))) ranges.push({ start: index, end: stop });
      index = stop;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const start = index;
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (nestedBlocks && source.startsWith('/*', index)) {
          depth += 1;
          index += 2;
        } else if (source.startsWith('*/', index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (!allowed(source.slice(start, index))) ranges.push({ start, end: index });
      continue;
    }
    index += 1;
  }
  return ranges;
}

function htmlComments(source) {
  const ranges = [];
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf('<!--', index);
    if (start === -1) break;
    index = start;
    const found = source.indexOf('-->', index + 4);
    const end = found === -1 ? source.length : found + 3;
    if (!allowed(source.slice(index, end))) ranges.push({ start: index, end });
    index = end;
  }
  return ranges;
}

function yamlComments(source) {
  const ranges = [];
  let offset = 0;
  let blockIndent = null;
  let quote = null;
  for (const line of source.split('\n')) {
    const firstNonWhitespace = line.search(/\S/);
    const blank = firstNonWhitespace === -1;
    const indent = blank ? 0 : firstNonWhitespace;
    if (quote === null && blockIndent !== null) {
      if (blank || indent > blockIndent) {
        offset += line.length + 1;
        continue;
      }
      blockIndent = null;
    }
    if (quote === null && blank) {
      offset += line.length + 1;
      continue;
    }
    let commentAt = -1;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (quote === '"' && char === '\\') {
        index += 1;
        continue;
      }
      if (quote === "'" && char === "'" && line[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (quote && char === quote) {
        quote = null;
        continue;
      }
      if (!quote && (char === '"' || char === "'")) {
        quote = char;
        continue;
      }
      if (!quote && char === '#' && (index === 0 || /\s/.test(line[index - 1]))) {
        commentAt = index;
        break;
      }
    }
    if (quote === null) {
      const code = (commentAt === -1 ? line : line.slice(0, commentAt)).trimEnd();
      if (/(?:^|\s)[|>](?:[1-9][+-]?|[+-][1-9]?)?$/.test(code)) blockIndent = indent;
    }
    if (commentAt !== -1) {
      const raw = line.slice(commentAt);
      if (!allowed(raw)) ranges.push({ start: offset + commentAt, end: offset + line.length });
    }
    offset += line.length + 1;
  }
  return ranges;
}

function propertiesComments(source) {
  const ranges = [];
  let offset = 0;
  for (const line of source.split('\n')) {
    const index = line.search(/\S/);
    if (index >= 0 && (line[index] === '#' || line[index] === '!')) {
      const raw = line.slice(index);
      if (!allowed(raw)) ranges.push({ start: offset + index, end: offset + line.length });
    }
    offset += line.length + 1;
  }
  return ranges;
}

function scan(file, source) {
  if (/\.(c|m)?[jt]sx?$/.test(file)) return scriptComments(file, source);
  if (/\.(html?|xml|svg)$/.test(file)) return htmlComments(source);
  if (/\.ya?ml$/.test(file) || /(^|\/)Makefile$/.test(file)) return yamlComments(source);
  if (/\.properties$/.test(file) || /(^|\/)\.gitignore$/.test(file)) return propertiesComments(source);
  if (/\.css$/.test(file)) return delimitedComments(source, false, false, false);
  if (/\.kts?$/.test(file)) return delimitedComments(source, true, true, true);
  return delimitedComments(source, true, false, false);
}

function lineNumber(source, position) {
  return source.slice(0, position).split('\n').length;
}

function baseRef() {
  for (const candidate of [process.env.COMMENTS_BASE, process.env.BASE_SHA, 'origin/main', 'HEAD']) {
    if (!candidate || /^0+$/.test(candidate)) continue;
    try {
      execFileSync('git', ['cat-file', '-e', `${candidate}^{commit}`]);
      return candidate;
    } catch {
      continue;
    }
  }
  return 'HEAD';
}

function candidateFiles(base) {
  const selected = all
    ? execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    : `${execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', '-z', base, '--'], { encoding: 'utf8' })}${execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })}`;
  return [...new Set(selected.split('\0').filter(Boolean))]
    .filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs|css|html|htm|kt|kts|swift|gradle|json|jsonc|yaml|yml|xml|svg|properties|java|rs|py|sh|bash|c|cc|cpp|h|hpp)$/.test(file) || /(^|\/)(\.gitignore|\.gitattributes|Makefile)$/.test(file))
    .filter(existsSync)
    .filter((file) => !prefixes.length || prefixes.some((prefix) => file === prefix || file.startsWith(`${prefix.replace(/\/$/, '')}/`)));
}

function sourceAt(base, file) {
  try {
    return execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function newCommentRanges(file, source, previous) {
  const counts = new Map();
  for (const range of scan(file, previous)) {
    const raw = previous.slice(range.start, range.end);
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return scan(file, source).filter((range) => {
    const raw = source.slice(range.start, range.end);
    const remaining = counts.get(raw) ?? 0;
    if (!remaining) return true;
    counts.set(raw, remaining - 1);
    return false;
  });
}

function stripComments(source, ranges) {
  const expanded = ranges.map((range) => {
    let lineStart = range.start;
    while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart -= 1;
    let lineEnd = range.end;
    while (lineEnd < source.length && source[lineEnd] !== '\n') lineEnd += 1;
    if (/^[ \t]*$/.test(source.slice(lineStart, range.start)) && /^[ \t]*$/.test(source.slice(range.end, lineEnd))) {
      return { start: lineStart, end: lineEnd < source.length ? lineEnd + 1 : lineEnd };
    }
    let start = range.start;
    while (start > lineStart && /[ \t]/.test(source[start - 1])) start -= 1;
    return { start, end: range.end };
  }).sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const range of expanded) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  let result = '';
  let cursor = 0;
  for (const range of merged) {
    result += source.slice(cursor, range.start);
    cursor = range.end;
  }
  return `${result}${source.slice(cursor)}`.replace(/[ \t]+$/gm, '');
}

function runSelftest() {
  const cases = [
    ['sample.ts', 'const url = "https://example.com";\n', 0],
    ['sample.ts', 'const value = 1; // remove\n', 1],
    ['sample.tsx', 'const view = <div>// visible</div>;\n', 0],
    ['sample.ts', '// @ts-expect-error\nconst value = 1;\n', 0],
    ['sample.css', 'a { content: "/* visible */"; } /* remove */\n', 1],
    ['sample.html', '<div><!-- remove --></div>\n', 1],
    ['sample.kt', 'val url = "https://example.com"\n// remove\n', 1],
    ['sample.kt', 'val text = """// visible"""\n', 0],
    ['sample.yaml', 'url: "https://example.com/#section"\n# remove\n', 1],
    ['Package.swift', '// swift-tools-version: 6.0\n', 0],
    ['sample.xml', '<node><!-- remove --></node>\n', 1],
    ['sample.properties', 'value=#literal\n! remove\n', 1],
    ['sample.yaml', 'text: |\n  # visible\n# remove\n', 1],
    ['sample.ts', '/// <reference types="node" />\n', 0],
  ];
  for (const [file, source, expected] of cases) {
    const actual = scan(file, source).length;
    if (actual !== expected) throw new Error(`${file}: expected ${expected}, received ${actual}`);
  }
  const stripped = stripComments('const value = 1; // remove\n// remove\n', scan('sample.ts', 'const value = 1; // remove\n// remove\n'));
  if (stripped !== 'const value = 1;\n') throw new Error(`strip failed: ${JSON.stringify(stripped)}`);
  console.log(`comment checker self-test passed (${cases.length} cases)`);
}

function main() {
  const base = baseRef();
  let findings = 0;
  for (const file of candidateFiles(base)) {
    const source = readFileSync(file, 'utf8');
    let ranges;
    try {
      ranges = all ? scan(file, source) : newCommentRanges(file, source, sourceAt(base, file));
    } catch (error) {
      throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!ranges.length) continue;
    if (strip) {
      writeFileSync(file, stripComments(source, ranges));
      findings += ranges.length;
      continue;
    }
    findings += ranges.length;
    for (const range of ranges) {
      const line = lineNumber(source, range.start);
      const excerpt = source.slice(range.start, range.end).split('\n')[0].trim();
      console.error(`${file}:${line}: ${excerpt}`);
      if (process.env.GITHUB_ACTIONS === 'true') {
        console.error(`::error file=${file},line=${line},title=Disallowed comment::${excerpt}`);
      }
    }
  }
  if (strip) {
    console.log(`removed ${findings} disallowed comments`);
    return;
  }
  if (findings) throw new Error(`${findings} disallowed comments found`);
  console.log(all ? 'all tracked source and configuration files are comment-free' : `no new disallowed comments found against ${base}`);
}

if (selftest) runSelftest();
else main();

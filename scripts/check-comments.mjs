import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from '@babel/parser';

const selftest = process.argv.includes('--selftest');

function allowed(raw) {
  const body = raw
    .replace(/^(\/\/|\/\*+|<!--|#)/, '')
    .replace(/(\*\/|-->)$/, '')
    .trim()
    .replace(/^\*+\s*/, '');
  return [
    /^@(ts-ignore|ts-expect-error|ts-nocheck|ts-check)\b/,
    /^eslint-(disable|enable)(-next-line|-line)?\b/,
    /^biome-ignore\b/,
    /^prettier-ignore\b/,
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
  for (const line of source.split('\n')) {
    let quote = null;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (quote === '"' && char === '\\') {
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
        const raw = line.slice(index);
        if (!allowed(raw)) ranges.push({ start: offset + index, end: offset + line.length });
        break;
      }
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
  if (/\.ya?ml$/.test(file)) return yamlComments(source);
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
  const changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', '-z', base, '--'], { encoding: 'utf8' });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' });
  return [...new Set(`${changed}${untracked}`.split('\0').filter(Boolean))]
    .filter((file) => /\.(ts|tsx|js|jsx|mjs|cjs|css|html|htm|kt|kts|swift|gradle|json|jsonc|yaml|yml|xml|svg|properties)$/.test(file) || /(^|\/)\.gitignore$/.test(file))
    .filter(existsSync)
    .filter((file) => !file.startsWith('presentation/vendor/'))
    .filter((file) => !file.startsWith('packages/contracts/schema/'));
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
  ];
  for (const [file, source, expected] of cases) {
    const actual = scan(file, source).length;
    if (actual !== expected) throw new Error(`${file}: expected ${expected}, received ${actual}`);
  }
  console.log(`comment checker self-test passed (${cases.length} cases)`);
}

function main() {
  const base = baseRef();
  let findings = 0;
  for (const file of candidateFiles(base)) {
    const source = readFileSync(file, 'utf8');
    let ranges;
    try {
      ranges = newCommentRanges(file, source, sourceAt(base, file));
    } catch (error) {
      throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!ranges.length) continue;
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
  if (findings) throw new Error(`${findings} new disallowed comments found`);
  console.log(`no new disallowed comments found against ${base}`);
}

if (selftest) runSelftest();
else main();

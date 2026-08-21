export interface AnswerSpan {
  text: string;
  bold: boolean;
  code: boolean;
}

export interface AnswerBlock {
  kind: "heading" | "bullet" | "paragraph";
  indent: number;
  spans: AnswerSpan[];
}

export function answerSpans(line: string): AnswerSpan[] {
  const out: AnswerSpan[] = [];
  line.split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach((part) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) out.push({ text: part.slice(2, -2), bold: true, code: false });
    else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) out.push({ text: part.slice(1, -1), bold: false, code: true });
    else out.push({ text: part, bold: false, code: false });
  });
  return out;
}

export function answerBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim() || /^\s*[-*_]{3,}\s*$/.test(line)) continue;
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) {
      blocks.push({ kind: "heading", indent: 0, spans: answerSpans(heading[1] ?? "") });
      continue;
    }
    const bullet = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      blocks.push({ kind: "bullet", indent: Math.min(Math.floor((bullet[1] ?? "").length / 2), 3), spans: answerSpans(bullet[2] ?? "") });
      continue;
    }
    blocks.push({ kind: "paragraph", indent: 0, spans: answerSpans(line.trim()) });
  }
  return blocks;
}

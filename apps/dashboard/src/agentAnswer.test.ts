import { describe, expect, it } from "vitest";
import { answerBlocks, answerSpans } from "./agentAnswer";

describe("answerSpans", () => {
  it("splits bold and code out of a line", () => {
    expect(answerSpans("Zone **n2946** is `critical` now")).toEqual([
      { text: "Zone ", bold: false, code: false },
      { text: "n2946", bold: true, code: false },
      { text: " is ", bold: false, code: false },
      { text: "critical", bold: false, code: true },
      { text: " now", bold: false, code: false },
    ]);
  });

  it("passes plain text through untouched", () => {
    expect(answerSpans("all nominal")).toEqual([{ text: "all nominal", bold: false, code: false }]);
  });
});

describe("answerBlocks", () => {
  it("classifies headings, bullets, rules and paragraphs", () => {
    const blocks = answerBlocks("### Status\n\n* zone one\n  * nested\n---\n1. ordered\nplain line");
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "bullet", "bullet", "bullet", "paragraph"]);
    expect(blocks[0]!.spans[0]!.text).toBe("Status");
    expect(blocks[1]!.indent).toBe(0);
    expect(blocks[2]!.indent).toBe(1);
    expect(blocks[3]!.spans[0]!.text).toBe("ordered");
  });

  it("drops blank lines and keeps markdown-free text as paragraphs", () => {
    expect(answerBlocks("one\n\ntwo")).toHaveLength(2);
  });
});

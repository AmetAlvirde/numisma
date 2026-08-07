// The skip message is BEHAVIOUR, not decoration (#209). Four shells refuse on a skip and
// all four used to render `malformed` and `unknown-kind` as the same "unreadable line(s)"
// sentence — telling the operator the file is wrong when the file is fine and it is the
// READER that is out of date. These tests pin the two wordings and then assert them at
// all four shells, because the defect was precisely that the four diverged.
import { describe, expect, it } from "vitest";
import type { OrderSkip } from "@numisma/preferences";
import { renderSkipMessage } from "./skip-message.js";

const malformed = (line: number): OrderSkip => ({
  line,
  problem: "malformed",
  message: "id must be a non-empty string",
});

const unknownKind = (line: number): OrderSkip => ({
  line,
  problem: "unknown-kind",
  message: 'unknown kind "orderRepriced"',
});

describe("renderSkipMessage", () => {
  it("renders a malformed skip as today's wording — the file is wrong", () => {
    const message = renderSkipMessage("/data/orders.jsonl", [malformed(2)]);
    expect(message).toContain("/data/orders.jsonl");
    expect(message).toContain("1 unreadable line(s)");
    expect(message).toContain("understate what is encumbered");
  });

  it("renders an unknown-kind skip as a newer build, NOT as an unreadable file", () => {
    const message = renderSkipMessage("/data/orders.jsonl", [unknownKind(7)]);
    expect(message).toContain("1 line(s) written by a newer build than this one");
    expect(message).toContain("update this reader");
    // The whole point: the file is fine. Saying otherwise sends the operator to edit a
    // well-formed line.
    expect(message).not.toContain("unreadable");
  });

  it("renders BOTH classes at once, each with its own count — neither collapses", () => {
    const message = renderSkipMessage("/data/orders.jsonl", [
      malformed(2),
      unknownKind(7),
      unknownKind(9),
    ]);
    expect(message).toContain("1 unreadable line(s)");
    expect(message).toContain("2 line(s) written by a newer build than this one");
  });

  it("counts every line of a class, not just the first", () => {
    const message = renderSkipMessage("/data/orders.jsonl", [malformed(1), malformed(4)]);
    expect(message).toContain("2 unreadable line(s)");
    expect(message).not.toContain("newer build");
  });
});

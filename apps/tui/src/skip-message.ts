import type { OrderSkip } from "@numisma/preferences";

/**
 * THE ONE PLACE A SKIPPED SIDECAR LINE IS PUT INTO WORDS (#181).
 *
 * Four TUI shells refuse to render a committed figure over a partially-read book —
 * `availableCapitalSection`, `cancelOrder`, `recordFill` and `importOrders`. Each used to
 * write its own sentence, and all four flattened the parser's two problem classes into
 * one: "N unreadable line(s)". One logical change to that wording cost four edits, and
 * the flattening was itself the defect.
 *
 * THE TWO CLASSES ARE OPPOSITE FACTS, and this is the first increment where the
 * difference lands on a number. A build older than #181 meets an `orderFillObserved`
 * line, skips it as an unknown kind, and — absent the refusal — would compute the rung's
 * committed figure from placement minus booked fills alone: the STALE PARTIAL, printed as
 * if it were current. Nothing is wrong with the file; the READER is behind. Telling the
 * operator the line is unreadable sends them to edit a well-formed line and leaves the
 * actual fix — update the build — unsaid.
 *
 * The refusal itself is unchanged and stands: every shell still withholds the figure on
 * any skip, of either class. This function changes only what the operator is told about
 * WHY, and therefore what they do next.
 *
 * `parseOrderRecord`'s docstrings are correct as written and are deliberately untouched:
 * the parser has always drawn this distinction. The loss was one layer out, here.
 */
export function renderSkipMessage(path: string, skips: readonly OrderSkip[]): string {
  let malformed = 0;
  let unknownKind = 0;
  for (const skip of skips) {
    switch (skip.problem) {
      case "malformed": {
        malformed += 1;
        break;
      }
      case "unknown-kind": {
        unknownKind += 1;
        break;
      }
      default: {
        // A problem class added to `OrderRecordProblem` and never taught to this renderer
        // would typecheck fine and render as NOTHING — the operator would be refused with
        // a sentence that names no reason. This latch makes that a COMPILE failure, which
        // is the whole reason the wording lives in one function instead of four.
        const _never: never = skip.problem;
        void _never;
        break;
      }
    }
  }

  const sentences: string[] = [];
  if (malformed > 0) {
    // Today's wording, unchanged. This class means what it has always meant: the file is
    // wrong, and a figure over it would understate the encumbrance.
    sentences.push(
      `${path} has ${malformed} unreadable line(s); a committed figure over a ` +
        `partially-read book would understate what is encumbered.`,
    );
  }
  if (unknownKind > 0) {
    // Forward-compatible wording. Note what it does NOT say: not "unreadable", not "the
    // file is wrong". The named next move is updating the reader, because that is the one
    // that works.
    sentences.push(
      `${path} has ${unknownKind} line(s) written by a newer build than this one; ` +
        `update this reader before a committed figure is trusted from it.`,
    );
  }

  // Both classes at once is ordinary — one hand-edited line in a file a newer build also
  // wrote — so both sentences are rendered, each with its own count. Neither is folded
  // into the other's number.
  return sentences.join(" ");
}

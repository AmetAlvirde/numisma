import type { ReactElement } from "react";

/**
 * THE TWO SNAPSHOT GUARD NOTICES — Seam D of spec #403.
 *
 * Three routes carried this copy verbatim, three times each: the same heading, the same
 * paragraph, the same interpolated version numbers. Copy that lives in three files is
 * copy that gets corrected in one of them, and the correction is invisible — every route
 * still renders, and the operator sees whichever page they happened to open.
 *
 * ── THE CONTROL FLOW STAYS IN THE ROUTE ──────────────────────────────────────────────
 * These are the WORDS, not the guard. Each route keeps its own
 * `if (result.status === "empty" | "stale")` and its own `<Shell>`, because folding the
 * branch into a layout route is a routing change with real behavior risk, declined in the
 * spec and left to the workbench increment that will already be moving the router.
 * `route-move.test.ts` pins the shell import and the per-route branching, and this
 * extraction is deliberately shaped to keep every one of those assertions true.
 *
 * ── A `<div className="card notice">`, NOT A `Card` ──────────────────────────────────
 * Both notices keep the element they render today. `Card` is a `<section>` and only a
 * `<section>`; converting these would change the element and the landmark structure of
 * three pages, which is a visual and accessibility change, and this increment has no
 * visual review gate. The class strings are unchanged and `styles.css` is byte-identical.
 *
 * ── NO GENERIC `Notice` ──────────────────────────────────────────────────────────────
 * A `<Notice variant severity>` would have exactly these two consumers. The ladder
 * route's own `not-found` and `no-price-axis` notices are not candidates: different copy,
 * one call site each, and the second carries `card` WITHOUT `notice`, so absorbing it
 * would change its class set. Two named components that say what they mean beat one
 * parameterized component that says nothing.
 *
 * ── THIS FILE IMPORTS REACT AND NOTHING ELSE ─────────────────────────────────────────
 * It enters the import closure `route-move.test.ts` walks from the ladder route, which
 * allows exactly two `@numisma/*` runtime imports. The props are scalars declared inline
 * for the same reason: a `SnapshotResult` type import here would drag the projection
 * contract into a primitive that only needs three numbers.
 */
export function SnapshotEmptyNotice(): ReactElement {
  return (
    <div className="card notice">
      <h1>No snapshot yet</h1>
      <p>
        The projection is empty. Run <code>pnpm push</code> to publish the latest
        composition report.
      </p>
    </div>
  );
}

/**
 * The refusal. The stored version and the supported window are all RENDERED, because
 * "refusing to render" without the numbers leaves the operator with nothing to act on —
 * the fix is re-running the push against a matching engine build, and which build that is
 * follows from the range.
 *
 * `error` rides alongside `card notice` here and only here.
 */
export function SnapshotStaleNotice({
  storedVersion,
  min,
  max,
}: {
  storedVersion: number;
  min: number;
  max: number;
}): ReactElement {
  return (
    <div className="card notice error">
      <h1>Schema version mismatch — refusing to render</h1>
      <p>
        The stored snapshot is schema version <strong>{storedVersion}</strong>, which is
        outside the versions this app supports (
        <strong>
          {min}–{max}
        </strong>
        ). Re-run the push shell with a matching engine build before viewing.
      </p>
    </div>
  );
}

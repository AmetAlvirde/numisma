/**
 * D11 — the route move, asserted structurally (PRD #146 slice #150).
 *
 * A MOVE, NOT A DUPLICATE. `/` becomes the glance; the composition dashboard that
 * used to live there becomes `/big-picture`, behavior-unchanged; the login route
 * keeps navigating to `/`, because the phone should land on triage.
 *
 * ── THE POLARITY REVERSED ONCE, DELIBERATELY (spec #277, D6) ────────────────────
 * D11 moved standing content OFF `/` so the verdict would land first. Spec #277 puts
 * one piece of standing content BACK: the DCA card. That is not D11 eroding — it is
 * D11's own rule applied to a different question. D11 moved the COMPOSITION TABLES,
 * which answer "what do I hold", asked at desk frequency. The DCA card answers "is my
 * accumulation plan still what I think it is", which is checked at exactly the
 * frequency the verdict is, on the same phone, in the same queue. The tables stay on
 * `/big-picture`; they are not coming back.
 *
 * So this file now asserts the move in BOTH directions: the tables are still gone
 * from `/`, and the card is on `/` and NOT duplicated onto `/big-picture`. A
 * one-directional assertion would have called the reversal a regression.
 *
 * WHY A SOURCE-LEVEL TEST AND NOT A RENDER TEST. This repo has no RTL toolchain and
 * this increment deliberately does not add one (see docs/coverage-rationale.md §6 —
 * the `.tsx` render surfaces are outside instrumentation by decision). What is
 * asserted here is the part that can regress SILENTLY: a duplicated dashboard left
 * behind on `/`, a login redirect quietly re-pointed at `/big-picture`, or two
 * divergent copies of `Shell`. The reader must open the phone to judge the layout;
 * nothing below pretends otherwise.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(HERE, file), "utf-8");

describe("D11: the route move", () => {
  it("serves the glance at `/` — the verdict, not the composition tables", () => {
    const index = read("index.tsx");
    expect(index).toMatch(/createFileRoute\(["']\/["']\)/);
    expect(index).toMatch(/glance\/verdict\.ts/);
    // The tables moved out; `/` must not still render them.
    expect(index).not.toMatch(/SectionTable/);
  });

  it("renders the DCA card on `/` — standing content, returned on purpose (D6)", () => {
    const index = read("index.tsx");
    expect(index).toMatch(/DcaCard/);
    expect(index).toMatch(/components\/DcaCard\.tsx/);
  });

  it("does NOT duplicate the DCA card onto `/big-picture`", () => {
    // The same rule the tables live under, pointed the other way: one home per piece
    // of content. Two copies would drift, and the phone would show two answers.
    expect(read("big-picture.tsx")).not.toMatch(/DcaCard/);
  });

  it("serves the previous composition page at `/big-picture`", () => {
    const big = read("big-picture.tsx");
    expect(big).toMatch(/createFileRoute\(["']\/big-picture["']\)/);
    expect(big).toMatch(/SectionTable/);
    expect(big).toMatch(/SummaryCard/);
  });

  it("keeps login landing on `/`", () => {
    // The phone should land on triage. This is the line the spec pins by file and
    // number (`routes/login.tsx:23`), so it gets an assertion of its own.
    expect(read("login.tsx")).toMatch(/navigate\(\{\s*to:\s*["']\/["']\s*\}\)/);
  });

  it("shares ONE Shell between both surfaces", () => {
    // Two copies would drift, and the whole point of a move is that there is one
    // page's worth of chrome, not two.
    for (const file of ["index.tsx", "big-picture.tsx"]) {
      expect(read(file), file).toMatch(/components\/Shell\.tsx/);
      expect(read(file), file).not.toMatch(/function Shell\(/);
    }
  });
});

/**
 * G-D13 — THE THIRD ROUTE (spec #285, slice #289).
 *
 * The same rule as D11's move, pointed at a new surface: one home per piece of content.
 * The Fill Path lives at `/ladder/$planId` and NOWHERE ELSE — not inlined on `/`, not
 * duplicated onto `/big-picture` — and `DcaCard` stays the one thing that links to it.
 *
 * STRUCTURAL, for the reason this file's header already gives: there is no RTL
 * toolchain and this increment deliberately does not add one. What is asserted here is
 * what can regress SILENTLY — a second copy of the Fill Path, a link that stops
 * pointing at the route, an engine value-import creeping into a browser surface. The
 * operator judges the layout by opening the phone.
 *
 * ── MUTATION CHECK (performed 2026-08-11) ───────────────────────────────────────────
 *  - changed `DcaCard.tsx`'s `to="/ladder/$planId"` to `to="/"` → "DcaCard is the one
 *    tap target for the ladder" red. Right reason: the card stopped being the way in,
 *    and the route would be reachable only by typing a UUID.
 *  - added a `reconcileFillPath` VALUE import from `@numisma/engine` to the route →
 *    "the ladder surfaces import no engine VALUE" red. Right reason: a value import is
 *    exactly what would put the engine in the browser bundle.
 *  - added a `beforeLoad` that fetches the Binance URL on the route → "keeps the spot
 *    fetch to ONE call site" red, naming the route file. Right reason: that is the
 *    helpful move into a loader the 451 comment exists to stop.
 *
 * THREE OF THESE ASSERTIONS WERE WEAKER AT FIRST and matched this repo's own PROSE:
 * a bare `/DcaCard/`, a `loader…binance` proximity search, and a bare `api.binance.com`
 * sweep all failed against the route's header, which explains exactly these rules. Each
 * was narrowed to match CODE — JSX, the `loader:` key, a quoted URL literal — because a
 * guard that forbids documenting the constraint is a guard that gets the documentation
 * deleted.
 */
describe("G-D13: the ladder route", () => {
  it("serves the Fill Path at `/ladder/$planId`, resolving a plan id parameter", () => {
    const ladder = read("ladder.$planId.tsx");
    expect(ladder).toMatch(/createFileRoute\(["']\/ladder\/\$planId["']\)/);
    expect(ladder).toMatch(/useParams\(\)/);
    expect(ladder).toMatch(/composeFillPathPage/);
  });

  it("renders the Fill Path from the pure view module, not from the wire directly", () => {
    // The route reads CONCLUSIONS. If it ever starts folding orders or summing lots,
    // it will need one of these, and this is where that shows up.
    const ladder = read("ladder.$planId.tsx");
    expect(ladder).toMatch(/ladder\/fill-path-view\.ts/);
    expect(ladder).not.toMatch(/reduce\(/);
  });

  it("does NOT duplicate the Fill Path onto `/` or `/big-picture`", () => {
    for (const file of ["index.tsx", "big-picture.tsx"]) {
      expect(read(file), file).not.toMatch(/FillPathCards/);
    }
  });

  it("makes DcaCard the one tap target for the ladder", () => {
    // The route is reached by TAPPING, never by typing a UUID, so the link is the only
    // way in and losing it would strand the whole surface.
    const card = readFileSync(join(HERE, "../components/DcaCard.tsx"), "utf-8");
    expect(card).toMatch(/to=["']\/ladder\/\$planId["']/);
    expect(card).toMatch(/params=\{\{\s*planId\s*\}\}/);
  });

  it("keeps the DCA card on `/` — the ladder route did not move it", () => {
    // G-D13 promotes the card; it does not relocate it. The route is one tap DOWN from
    // the card, which is the whole shape of the navigation.
    expect(read("index.tsx")).toMatch(/DcaCard/);
    // Matched as JSX, not as a word: this route's header explains the card's relation
    // to it in prose, and an assertion that a comment cannot mention the card would be
    // asserting against documentation rather than against a duplicate render.
    expect(read("ladder.$planId.tsx")).not.toMatch(/<DcaCard/);
  });

  it("shares the same ONE Shell as the other two surfaces", () => {
    const ladder = read("ladder.$planId.tsx");
    expect(ladder).toMatch(/components\/Shell\.tsx/);
    expect(ladder).not.toMatch(/function Shell\(/);
  });

  it("fetches spot in the BROWSER, never in the loader", () => {
    // `api.binance.com` 451s US IPs and Vercel is US-hosted, so a loader fetch passes
    // locally and fails in production. The loader must stay the session-gated snapshot
    // read and nothing else.
    const ladder = read("ladder.$planId.tsx");
    // The loader is pinned to exactly one thing, and there is only one of it. That is
    // stronger than a proximity search for "binance" near "loader", which this file's
    // own header would trip — the header EXPLAINS the geo-block, and it should.
    expect(ladder.match(/^\s*loader:/gm)).toHaveLength(1);
    expect(ladder).toMatch(/loader:\s*\(\)\s*=>\s*getDashboard\(\)/);
    // Spot arrives through a hook, which only runs in the browser.
    expect(ladder).toMatch(/useBinanceSpotUsd\(\)/);
  });

  it("keeps the spot fetch to ONE call site carrying the 451 reason", () => {
    const spot = readFileSync(join(HERE, "../lib/binance-spot.ts"), "utf-8");
    expect(spot).toMatch(/451/);
    // No other web source may carry the URL as a STRING LITERAL — that is what a call
    // site needs and what a comment does not. Matching the bare hostname would flag
    // every file that explains the 451, and those explanations are the point.
    const literal = /["'`]https:\/\/api\.binance\.com/;
    const others = allWebSources().filter((file) => !file.endsWith("binance-spot.ts"));
    const extra = others.filter((file) => literal.test(readFileSync(file, "utf-8")));
    expect(extra, extra.join("\n")).toEqual([]);
    expect(literal.test(spot)).toBe(true);
  });

  it("the ladder surfaces import no engine VALUE beyond the pure format helpers", () => {
    // ADR-007's client-bundle invariant, asserted at the source seam as well as against
    // the built bundle: the two spot-dependent decorations compute in a WEB-side pure
    // module precisely so the browser gains no engine import.
    for (const file of [
      "routes/ladder.$planId.tsx",
      "components/FillPath.tsx",
      "ladder/fill-path-view.ts",
      "ladder/convexity-caption.ts",
    ]) {
      const source = readFileSync(join(HERE, "..", file), "utf-8");
      for (const match of source.matchAll(
        /^\s*import\s+(?!type\b)([\s\S]*?)\bfrom\s*["'](@numisma\/[^"']+)["']/gm,
      )) {
        // `@numisma/engine/format` is pure formatting and already crosses on `/`.
        expect(match[2], `${file} imports ${match[2]} at runtime`).toBe(
          "@numisma/engine/format",
        );
      }
    }
  });
});

/** Every `.ts`/`.tsx` under `apps/web/src`, for the one-call-site sweep above. */
function allWebSources(): string[] {
  const root = join(HERE, "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  return walk(root);
}

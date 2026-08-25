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
 * WHY A SOURCE-LEVEL TEST AND NOT A RENDER TEST. This passage used to say the repo
 * had no RTL toolchain and that its increment deliberately did not add one. It has one
 * now (ADR-022), and that changes nothing here: what these regexes assert is WHERE a
 * piece of content lives across several route files at once, which is a claim about the
 * repo's shape rather than about any one rendered tree. A render test mounts one route
 * and cannot see the second copy on another. So the instrument is right for the claim,
 * not a stand-in for a missing one — and its regexes are not up for retirement until a
 * render test makes the same claim, which is spec #403's own rule. What is asserted
 * here is the part that can regress SILENTLY: a duplicated dashboard left behind on
 * `/`, a login redirect quietly re-pointed at `/big-picture`, or two divergent copies
 * of `Shell`. The reader must open the phone to judge the layout; nothing below
 * pretends otherwise.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFiles } from "../../../../ops/testkit/repo-sources.testkit.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(HERE, file), "utf-8");

/**
 * `Shell` reached BY NAME out of the package, not merely mentioned.
 *
 * A bare `/@numisma\/components/` would match every route in this directory and
 * assert nothing about the chrome; naming the binding inside the import block is
 * what makes this a claim about where `Shell` comes from. Paired everywhere it is
 * used with `not.toMatch(/function Shell\(/)`, which is the half that forbids a
 * second copy.
 */
const SHELL_FROM_PACKAGE = /import \{[^}]*\bShell\b[^}]*\} from "@numisma\/components"/s;

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
    // AS JSX, for the reason the G-D13 half of this file spells out: the import line
    // alone satisfies a bare `/DcaCard/`, so the card can be deleted with this green.
    expect(index).toMatch(/<DcaCard/);
    // FROM THE PACKAGE, BY NAME (spec #439 S4). The card crossed into
    // `@numisma/components` and the relative path this used to read is gone. Named inside
    // the import block for `SHELL_FROM_PACKAGE`'s reason: a bare
    // `/@numisma\/components/` matches every route in this directory and asserts nothing
    // about where the card comes from.
    expect(index).toMatch(
      /import \{[^}]*\bDcaCard\b[^}]*\} from "@numisma\/components"/s,
    );
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
    // page's worth of chrome, not two. `Shell` moved into `@numisma/components`
    // (spec #439), so the import is a PACKAGE specifier now — and the second
    // assertion is the half that actually forbids a second copy, wherever the
    // first one lives.
    for (const file of ["index.tsx", "big-picture.tsx"]) {
      expect(read(file), file).toMatch(SHELL_FROM_PACKAGE);
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
 * STRUCTURAL, for the reason this file's header already gives: a claim about which
 * files a surface appears in is not a claim a single mounted tree can answer, harness
 * or no harness. What is asserted here is
 * what can regress SILENTLY — a second copy of the Fill Path, a link that stops
 * pointing at the route, an engine value-import creeping into a browser surface. The
 * operator judges the layout by opening the phone.
 *
 * ── MUTATION CHECK (performed 2026-08-11) ───────────────────────────────────────────
 *  - changed the tap-through's `to="/ladder/$planId"` to `to="/"` → "DcaCard is the one
 *    tap target for the ladder" red. Right reason: the card stopped being the way in,
 *    and the route would be reachable only by typing a UUID. (Performed against
 *    `DcaCard.tsx`; the destination lives in `index.tsx`'s `renderLink` slot since spec
 *    #439 S4 and the case reads it there.)
 *  - added a `reconcileFillPath` VALUE import from `@numisma/engine` to the route →
 *    "the ladder surfaces import no engine VALUE" red. Right reason: a value import is
 *    exactly what would put the engine in the browser bundle.
 *  - added a `beforeLoad` that fetches the Binance URL on the route → "keeps the spot
 *    fetch to ONE call site" red, naming the route file. Right reason: that is the
 *    helpful move into a loader the 451 comment exists to stop.
 *  - added a SIDE-EFFECT `import "@numisma/engine";` to `FillPath.tsx` (deleted at spec
 *    #439 S9 — the file that holds the fill path today is the package's own
 *    `ui/fill-path.tsx`, swept by the last case in this file), and separately a
 *    dynamic `import("@numisma/engine")` to `convexity-caption.ts` → the same test red,
 *    once each, naming the file. Right reason: neither form has a `from` clause, so the
 *    specifier matcher could not see them while both pull the engine into the bundle.
 *  - deleted `<DcaCard view={dca} />` from `index.tsx` and LEFT the import → "keeps the
 *    DCA card on `/`" red. Right reason: the bare `/DcaCard/` this replaced was satisfied
 *    by the import line alone, so the card could vanish from `/` with the suite green.
 *  - (2026-08-17) stubbed `allWebSources()` to `[]` → "keeps the spot fetch to ONE call
 *    site" red on its new non-empty floor, and green on everything else. Right reason:
 *    that sweep's verdict is "no offender found", which an empty sweep also produces —
 *    without the floor the guard passed while reading zero files.
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
    //
    // READ OFF `index.tsx`, NOT OFF THE CARD (spec #439 S4). This used to
    // `readFileSync` `../components/DcaCard.tsx`, which now throws ENOENT — loud, and
    // useless, because a filesystem error says nothing about the app. The card moved into
    // `@numisma/components`, which has no router, so it hands its anchor's classes and the
    // view's `planId` out through a slot and the destination is written at the call site.
    //
    // THE ASSERTION IS STRONGER HERE. `index.tsx` is where the generated route tree is in
    // scope, so it is where TanStack checks `to` and where a typo in a route path would
    // otherwise ship. A link-adapter context normalising every destination to
    // `to: string` would have moved this claim somewhere nothing could check it.
    const index = read("index.tsx");
    expect(index).toMatch(/to=["']\/ladder\/\$planId["']/);
    expect(index).toMatch(/params=\{\{\s*planId\s*\}\}/);
    // Inside the slot, not loose on the page: the `<Link>` is the card's tap-through and
    // nothing else on `/` points at the ladder.
    expect(index).toMatch(/renderLink=\{/);
  });

  it("keeps the DCA card on `/` — the ladder route did not move it", () => {
    // G-D13 promotes the card; it does not relocate it. The route is one tap DOWN from
    // the card, which is the whole shape of the navigation.
    // Matched as JSX on BOTH halves. A bare `/DcaCard/` is satisfied by `index.tsx`'s own
    // import line, so deleting `<DcaCard view={dca} />` and leaving the import took the
    // card off `/` with this test still green.
    expect(read("index.tsx")).toMatch(/<DcaCard/);
    // Matched as JSX, not as a word: this route's header explains the card's relation
    // to it in prose, and an assertion that a comment cannot mention the card would be
    // asserting against documentation rather than against a duplicate render.
    expect(read("ladder.$planId.tsx")).not.toMatch(/<DcaCard/);
  });

  it("shares the same ONE Shell as the other two surfaces", () => {
    const ladder = read("ladder.$planId.tsx");
    expect(ladder).toMatch(SHELL_FROM_PACKAGE);
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
    // FALSE-PASS FLOOR. `extra` being empty is also what a sweep over zero files
    // produces, so the sweep has to prove it swept. A missing scan root now throws
    // in the walker; this catches the other half — a root that exists but yields
    // nothing. The sibling converted guards assert the same floor.
    expect(others.length, "the one-call-site sweep scanned no web sources").toBeGreaterThan(0);
    const extra = others.filter((file) => literal.test(readFileSync(file, "utf-8")));
    expect(extra, extra.join("\n")).toEqual([]);
    expect(literal.test(spot)).toBe(true);
  });

  it("the ladder surfaces import no engine VALUE beyond the pure subpath helpers", () => {
    // ADR-007's client-bundle invariant, asserted at the source seam. THIS TEST IS WHAT
    // HOLDS THAT CLAIM — `client-bundle.integration.test.ts` scans the built bundle for
    // `composition_snapshot`, DB URLs and secret tokens, and would stay green with an
    // engine value import in every file below (and it is `skipIf(!hasBuild)` besides).
    //
    // OVER THE WHOLE REACHABLE MODULE GRAPH, not a hand-kept list of four: an engine
    // value import in a NEW web module that `FillPath.tsx` pulls in transitively is the
    // way this invariant actually breaks, and a list nobody remembers to extend cannot
    // see it. The walk follows relative specifiers only — a package specifier is what is
    // being judged, not traversed.
    const closure = reachableFrom("routes/ladder.$planId.tsx");
    expect(closure.length).toBeGreaterThan(4);

    // The two PURE SUBPATHS are browser-safe by construction: each is a leaf module with
    // no imports of its own, which is why the subpath exports exist at all. The engine
    // ROOT is what drags `node:os`/`node:path` into the bundle.
    //
    // `@numisma/components` IS THE THIRD, AND IT IS SAFE FOR THE SAME REASON THE ENGINE
    // ROOT IS NOT (spec #432 §4.1, slice 1). The fill path renders `Absent` from the
    // package, so the package is in this closure from now on. It declares four runtime
    // dependencies — `@base-ui/react`, `class-variance-authority`, `clsx` and
    // `tailwind-merge` — reaches no `node:` builtin, and ships browser-only TSX with no
    // filesystem, no environment read and no database client anywhere in it. What ADR-007
    // keeps out of the browser bundle is the engine's `node:os`/`node:path` reach and the
    // secrets that travel with it; a component package with none of that is not the thing
    // this list is narrow about. THAT DEPENDENCY LIST IS ASSERTED BELOW rather than
    // argued here, because the walk stops at the package boundary and would not see it
    // change.
    // ── THE LIST IS BACK TO THREE (spec #439 S9) ─────────────────────────────────────
    // BOTH SUBPATH ENTRIES CAME OFF IN THIS ONE DIFF, and both for the same reason: the
    // file that imported them is `apps/web/src/components/FillPath.tsx`, which S9
    // deleted along with the directory it lived in.
    //
    // `@numisma/components/ui/fill-path.tsx` stood here from S6 to S8 while the fill
    // path's selection seam and its shared helpers were in the package and the cards
    // that read them were not: `FillPath.tsx` imported ten names from the module
    // directly rather than from the curated index, precisely so the arrangement would
    // die rather than become public API. `@numisma/components/ui/price-drop-path.ts`
    // arrived at S5 for `COMPACT_USD`, the one compact-USD formatter the fill path has;
    // the chart, the spot label and the header card's price span all read it from
    // INSIDE the package now, where this walk cannot see it and does not need to.
    //
    // LEFT STANDING, EITHER WOULD PERMANENTLY ALLOW A SUBPATH NOTHING IMPORTS, and the
    // next reader would have no way to tell whether that was deliberate. The one
    // remaining app-side reader of `price-drop-path.ts` is
    // `ladder/started-ladder.fixtures.test.ts`, which is not in any route's runtime
    // closure — so re-adding either entry is a decision someone makes on purpose, with
    // this paragraph in front of them.
    const allowed = [
      "@numisma/engine/format",
      "@numisma/engine/calendar",
      "@numisma/components",
    ];
    for (const file of closure) {
      const source = readFileSync(join(HERE, "..", file), "utf-8");
      for (const match of source.matchAll(
        /^\s*import\s+(?!type\b)([\s\S]*?)\bfrom\s*["'](@numisma\/[^"']+)["']/gm,
      )) {
        expect(allowed, `${file} imports ${match[2]} at runtime`).toContain(match[2]);
      }
      // NEITHER OF THESE HAS A `from` CLAUSE, so the matcher above cannot see them, and
      // either one pulls the whole engine into the browser bundle just as effectively.
      expect(source, `${file} side-effect-imports the engine`).not.toMatch(
        /^\s*import\s*["']@numisma\/engine["']/m,
      );
      expect(source, `${file} dynamically imports the engine`).not.toMatch(
        /\bimport\s*\(\s*["']@numisma\/engine["']/,
      );
    }
  });

  it("pins the dependencies `@numisma/components` is allowed to drag in", () => {
    // THE OTHER HALF OF THE ALLOW-LIST ENTRY ABOVE. The walk follows relative specifiers
    // only, so it judges the package specifier and never traverses it: whatever the
    // package depends on rides into the ladder route's browser bundle unexamined. The
    // entry's safety argument is a claim about a dependency list, and a claim about a
    // dependency list belongs in an assertion — add `@numisma/engine` to that manifest
    // and re-export from it, and `node:os`/`node:path` reach the bundle with every
    // assertion above still green.
    //
    // THE WHOLE SET, NOT A DENY-LIST OF TODAY'S OFFENDERS. What makes a dependency unsafe
    // here is `node:` reach, which is not a property of any name this file could enumerate
    // in advance. So the check is that the set has not moved at all; a legitimate addition
    // reds it, and the fix is to read the new package for `node:` reach and then write it
    // down here. This is deliberately not a transitive resolver — it is one manifest, the
    // one the entry above rests on.
    const manifest = JSON.parse(
      readFileSync(join(HERE, "../../../../packages/components/package.json"), "utf-8"),
    ) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
    //
    // `@numisma/engine` IS THE ONE ADDITION SO FAR, and it is the exact mutation the
    // paragraph above named as the dangerous one, made deliberately (spec #439 §4.2).
    // What makes it safe is not the name but the DEPTH: the package reads the pure
    // `format` subpath and nothing else, whose own runtime closure is `format.ts` plus
    // `orders/committed.ts` and reaches no `node:` builtin. That is a claim about where
    // inside the dependency the package reaches, which this list cannot express — so it
    // is asserted in the case below, and widening this line without that one would leave
    // the safety argument resting on nobody.
    //
    // `@tanstack/charts` IS THE SECOND, and it is a WORKSPACE MOVE rather than a new
    // third-party bet (spec #439 S5). `apps/web` already depends on it directly at
    // exactly `0.11.0`, and it already ships to the browser through the ladder route,
    // because `PriceDropPathChart` has drawn the Price Drop Path with it since ADR-018.
    // Moving the component into the package moved the manifest line under it; nothing new
    // reaches the bundle, and the version matching the app's exactly is what makes that a
    // checkable statement rather than a hope. That is a stronger argument than any prose
    // about the library's own `node:` reach could be, because it does not depend on
    // reading the library at all.
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      "@base-ui/react",
      "@numisma/engine",
      "@tanstack/charts",
      "class-variance-authority",
      "clsx",
      "tailwind-merge",
    ]);
    // AND AT THE APP'S OWN VERSION, which is the half the key list cannot say. A range
    // here, or a bump on one side only, would put two copies of the chart library in the
    // ladder route's bundle with every assertion above still green.
    const webManifest = JSON.parse(
      readFileSync(join(HERE, "../../package.json"), "utf-8"),
    ) as { dependencies?: Record<string, string> };
    expect(manifest.dependencies?.["@tanstack/charts"]).toBe(
      webManifest.dependencies?.["@tanstack/charts"],
    );
    // Peers count the same: a peer is resolved out of the app's own tree and bundled just
    // as a dependency is, so this is where the same addition would go to avoid the list
    // above. React and React DOM the app already ships.
    expect(Object.keys(manifest.peerDependencies ?? {}).sort()).toEqual([
      "react",
      "react-dom",
    ]);
  });

  it("holds `@numisma/components` to the engine's PURE SUBPATHS, root type-imports aside", () => {
    // THE CLAIM THE PIN ABOVE CANNOT MAKE (spec #439 §4.2). The pin says WHICH names the
    // package may depend on; it says nothing about WHERE in a dependency the package
    // reaches, and the closure walk beside it stops at the package boundary and never
    // traverses it. So `@numisma/engine` sitting in that manifest is safe only while
    // every runtime read inside `packages/components/src` lands on `/format` or
    // `/calendar` — two leaf modules whose own closure is `format.ts` plus
    // `orders/committed.ts` and reaches no `node:` builtin. One `from "@numisma/engine"`
    // in a component and `node:os`/`node:path` are in the browser bundle with every
    // other assertion in this file green.
    //
    // WRITTEN AGAINST RUNTIME IMPORTS, AND THE ROOT IS ALLOWED TO BE TYPE-IMPORTED.
    // `summary-card.tsx` reads `DashboardSummary`, and the engine ROOT is the only place
    // it is exported from. A type-only import erases at compile time and reaches no
    // bundle, which is the same reasoning the sibling closure check above already runs
    // on — hence the negative lookahead, and hence the two `from`-less forms below,
    // which that lookahead cannot see and which pull the whole engine in regardless.
    //
    // ── THE CLAUSE IS `[^;]*?`, NOT `[\s\S]*?`, AND THAT IS THE WHOLE OF IT ─────────
    // The lookahead only guards the import the match STARTS on. `[\s\S]*?` crosses
    // newlines, so a match could open on some unrelated import and run on until the
    // first engine `from` anywhere below it — landing on a type-only ROOT import two
    // statements down and reporting THAT as a runtime read. The negative lookahead is
    // silently bypassed whenever it is not the first thing in the match, and the file
    // named in the failure is not the file with the problem.
    //
    // Measured, on `import { cn } from "./x"` above `import type { A } from
    // "@numisma/engine"` above a genuine `import { evil } from "@numisma/engine"`: the
    // old clause yielded TWO matches, the crossing one and the real offender, so the
    // guard reported an erased type import as a bundle hazard. That over-report is why
    // every package file today writes its engine root type-import FIRST — a convention
    // nothing states and nothing enforces, adopted to keep this guard quiet rather than
    // because the order means anything.
    //
    // A specifier list holds no `;`, and every import statement ends with one, so
    // `[^;]*?` cannot leave the statement it opened on. The match is then exactly as
    // wide as the lookahead's guarantee, the import order convention stops mattering,
    // and the narrowing can only ever report FEWER things — never fewer offenders,
    // since a runtime engine import still opens its own match on its own line.
    const packageSrc = join(HERE, "../../../../packages/components/src");
    const files = sourceFiles({ dir: packageSrc, as: "absolute" });
    // FALSE-PASS FLOOR, the same one every sweep in this file carries: "no offender
    // found" is also what a sweep over zero files returns.
    expect(files.length, "the subpath sweep scanned no package source").toBeGreaterThan(0);
    const pure = ["@numisma/engine/format", "@numisma/engine/calendar"];
    for (const file of files) {
      const label = relative(packageSrc, file);
      const source = readFileSync(file, "utf-8");
      for (const match of source.matchAll(
        /^\s*import\s+(?!type\b)[^;]*?\bfrom\s*["'](@numisma\/engine[^"']*)["']/gm,
      )) {
        expect(pure, `${label} imports ${match[1]} at runtime`).toContain(match[1]);
      }
      expect(source, `${label} side-effect-imports the engine`).not.toMatch(
        /^\s*import\s*["']@numisma\/engine["']/m,
      );
      expect(source, `${label} dynamically imports the engine`).not.toMatch(
        /\bimport\s*\(\s*["']@numisma\/engine["']/,
      );
    }
  });
});

/**
 * Every web module reachable from `entry` by RELATIVE import, `entry` included.
 *
 * A deliberately small walk: relative specifiers with an explicit extension, which is
 * this app's own convention (`verbatimModuleSyntax` + `.ts`/`.tsx` in every specifier),
 * so nothing has to be resolved. `type`-only imports are followed too — a module that
 * only contributes types cannot pull the engine in, but reading it costs nothing and the
 * alternative is a second parser that can disagree with the one above.
 */
function reachableFrom(entry: string): string[] {
  const seen = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const rel = pending.pop()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    const source = readFileSync(join(HERE, "..", rel), "utf-8");
    for (const match of source.matchAll(/from\s*["'](\.[^"']+)["']/g)) {
      const root = join(HERE, "..");
      const resolved = relative(root, resolve(dirname(join(root, rel)), match[1]!));
      pending.push(resolved);
    }
  }
  return [...seen].sort();
}

/** Every `.ts`/`.tsx` under `apps/web/src`, for the one-call-site sweep above. */
function allWebSources(): string[] {
  return sourceFiles({ dir: join(HERE, ".."), as: "absolute" });
}

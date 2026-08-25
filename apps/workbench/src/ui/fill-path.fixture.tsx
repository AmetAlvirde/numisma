import { FillPathProvider, useFillPathSelection } from "@numisma/components";
import {
  Expectation,
  Figure,
  formatUnits,
} from "@numisma/components/ui/fill-path.tsx";
import { partlyWalkedView } from "@numisma/components/ui/fill-path.fixtures.ts";

/**
 * THE FILL PATH'S SELECTION SEAM, AND THE TWO COLOUR READS THAT CAME WITH IT
 * (spec #439 S6).
 *
 * A PROVIDER PAINTS NOTHING, which is the whole difficulty of staging a seam slice. So
 * this fixture does two separate jobs and they are deliberately not mixed:
 *
 *   1. THE PROBE proves the seam. `useFillPathSelection` is the surface a component
 *      outside the module is allowed to mount against — `select`, `selected` and
 *      `selectedIndex`, and NOT `view` — and the probe is written the way the workbench
 *      would write a consumer: the hook in, the selected rung's key and index out, and a
 *      row of buttons that call `select`. A fixture that showed a provider with no
 *      consumer would prove the module imports and nothing else.
 *   2. THE HELPER ROW gives the mode switcher something to look at. `Figure` in its known
 *      arm, `Figure` in its absent arm and `Expectation` with its leading `~` are the
 *      three shared helpers this slice moved, and between them they perform BOTH of the
 *      slice's colour reads.
 *
 * ── THE TWO READS, AND THEY ARE ONE OBSERVATION MADE TWICE ───────────────────────────
 * `--nms-muted-foreground`, and nothing else. It reaches the screen by two independent
 * routes: the TILE LABEL, through the `TILE_LABEL` → `RAIL_LABEL` → `SPOT_LABEL` →
 * `STACKED_LABEL` chain that every label in the row composes from, and the PROJECTION
 * VALUE, on `Expectation`'s own 0.95rem string. Same token, two strings, and a rewrite
 * that caught one and missed the other is exactly what this row is here to show.
 *
 * WHAT TO LOOK FOR IN APP MODE, which is what `apps/web` paints today reached through
 * the new spelling: `#9aa1ad` on all four tile labels AND on the `~` projection figures.
 * `#14161c` would mean `--nms-muted` — the recessed SURFACE — got welded onto the text
 * role, which is the substitution `tokens.ts`'s header is written against. The measured
 * figures beside them stay at the ordinary foreground, and that CONTRAST is the point:
 * a projection reads quieter than a measurement in colour and in size at once.
 *
 * WHAT TO LOOK FOR IN THEMED MODE: both move, together. A label that stayed grey while
 * the projection moved would mean one of the two strings is still reading the app's bare
 * `--muted`, which no guard in the repo can see from here.
 *
 * IN GRAYSCALE the row is reviewed on hierarchy rather than colour: label smaller than
 * figure, projection smaller than measurement, and the absent arm reading as a stated
 * cause rather than as a missing number. No `$0` is reachable in any mode — `Figure`'s
 * absent arm carries a cause string and never a zero.
 *
 * THE TILES REFLOW AGAINST A CONTAINER NAMED BY A CARD THIS FIXTURE DOES NOT MOUNT.
 * `@[380px]/fp-header:` variants are reads of `fp-header`, which `FillPath.Header`
 * declares and which is still in `apps/web` until S7. So the tiles here stay in their
 * narrow form at every width, on purpose: the wide form is S7's fixture to stage, and
 * faking the container would stage a layout no card produces.
 *
 * SYNTHESIZED. The view comes from `fill-path.fixtures.ts` beside the component, derived
 * from a hand-written app fixture whose own tests say so. Nothing here imports from
 * `apps/web`, which `seam-isolation.test.ts` holds, and no real transaction has been
 * near it.
 */

/** A titled band, so a mode switch is read row by row. */
function Row({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-medium">{title}</h2>
      <p className="mb-3 text-xs text-foreground/60">{note}</p>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

const VIEW = partlyWalkedView();

/**
 * THE SEAM, MOUNTED AS A CONSUMER WOULD MOUNT IT.
 *
 * Three fields out and one function in, and the round trip is the assertion a human
 * makes by eye: press a rung's button, and the key AND the index both move. The index is
 * the provider's own translation — the hook never receives one — so a key that changed
 * while the index stood still would be the key↔index conversion coming apart, which is
 * the one behaviour this seam exists to own.
 *
 * IT OPENS ON RUNG 4, NOT RUNG 1. The provider derives its default from `isNext` on
 * every render rather than seeding state from the prop; the fixture's next rung is the
 * fourth precisely so that derivation is visible before anything is pressed.
 */
function SelectionProbe() {
  const { selected, selectedIndex, select } = useFillPathSelection();
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-sm tabular-nums">
        selected key <strong>{selected?.key ?? "none"}</strong> · index{" "}
        <strong>{selectedIndex}</strong>
      </p>
      <div className="flex flex-wrap gap-2">
        {VIEW.rungs.map((rung) => (
          <button
            key={rung.key}
            type="button"
            className="rounded border border-foreground/30 px-2 py-1 text-xs"
            onClick={() => select(rung.key)}
          >
            rung {rung.ladderIndex}
          </button>
        ))}
      </div>
    </div>
  );
}

export default {
  "the seam": (
    <FillPathProvider view={VIEW}>
      <Row
        title="selection, through the published hook"
        note="`useFillPathSelection` hands out exactly `select`, `selected` and `selectedIndex` — never `view`. Press a rung and both readings move together; the index is the provider's own translation of the key."
      >
        <SelectionProbe />
      </Row>
      <Row
        title="the same selection, read twice"
        note="A second probe under the same provider. Both follow one press, which is what makes this a shared selection rather than two components each holding their own."
      >
        <SelectionProbe />
      </Row>
    </FillPathProvider>
  ),

  "the shared helpers": (
    <div>
      <Row
        title="a measured figure"
        note="`Figure` in its known arm. The label reads `--nms-muted-foreground`; the figure does not, and the gap between them is the hierarchy."
      >
        <Figure label="Deployed" figure={VIEW.deployed} />
        <Figure label="Units acquired" figure={VIEW.unitsAcquired} render={formatUnits} />
      </Row>
      <Row
        title="a figure that was never measured"
        note="`Figure`'s absent arm, which carries a stated cause and never a zero. The cause renders through `Absent`, whose own read is the same token — so this row moves with the others."
      >
        <Figure
          label="Average entry"
          figure={{ known: false, why: "no fill has been recorded yet" }}
        />
      </Row>
      <Row
        title="a projection, and its `~`"
        note="`Expectation` prints the mark itself rather than taking it from a call site, so a projection cannot lose it. The value is the slice's SECOND read of `--nms-muted-foreground`, on its own 0.95rem string — if this figure stays grey while the labels above move, one of the two rewrites was missed."
      >
        <Expectation label="Expected units" value={0.09623} render={formatUnits} />
        <Expectation label="Expected average entry" value={36372.24} />
      </Row>
    </div>
  ),
};

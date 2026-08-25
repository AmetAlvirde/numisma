import { PriceDropPathChart } from "@numisma/components";
import {
  DEPLOYED_KNOWN,
  DEPLOYED_UNKNOWN,
  SPOT_USD,
  dayZeroLadder,
  walkedLadder,
} from "@numisma/components/ui/price-drop-path-chart.fixtures.ts";

/**
 * THE PRICE DROP PATH, ITS SIX COLOURS, AND THE MINT THAT MAKES ITS LINES VISIBLE
 * (spec #439 S5).
 *
 * NINETEEN COLOUR READS ACROSS SIX NAMES, the densest palette in the layer:
 * `--nms-muted-foreground` five times, `--nms-pos`, `--nms-now`, `--nms-foreground` and
 * `--nms-background` three times each, and `--nms-card` twice. One of the six,
 * `--nms-now`, is minted by this slice and this fixture is the only place anything
 * renders it.
 *
 * ── WHY THIS FIXTURE IS THE PROOF AND NOT A DEMO ─────────────────────────────────────
 * The gate check that cleared `@tanstack/charts` for this workbench ran on 2026-08-24
 * against the unmoved component, and it passed: axes, ticks, gridlines, size-scaled rung
 * dots, the pinned spot label, the deployed annotation and the legend all painted. THE
 * LINE STROKES WERE INVISIBLE AND THE DOTS PAINTED FALLBACK BLACK, and that was the
 * expected result rather than a caveat. The strokes read `var(--pos)`, `var(--muted)`
 * and `var(--now)`, which this workbench declares none of — it writes `--nms-*` names
 * only, as inline custom properties on the renderer document's root. An undeclared
 * custom property inside an SVG `stroke` resolves to nothing and the stroke does not
 * paint; a `fill` in the same position falls back to black. That is exactly what a token
 * resolving and finding no value looks like, which is the second of the two silent
 * failures `tokens.ts`'s header is written against.
 *
 * This slice supplies the values, so the same picture must now paint IN COLOUR and paint
 * DIFFERENTLY in each mode. A stroke still missing here is a token this fixture failed
 * to define, not a chart that cannot draw.
 *
 * WHAT TO LOOK FOR IN APP MODE, which is what `apps/web` paints today reached through
 * the new spellings: the filled path `#46c98b`, the waiting path `#9aa1ad`, the now rule
 * and its label `#e07a4f`, the rung ring fills `#181b22`, the selection halo `#0f1115`
 * and the selection disc `#e7e9ee`.
 *
 * WHAT TO LOOK FOR IN THEMED MODE: all six move, and the three STATE colours — filled,
 * waiting and now — must still be distinguishable from each other. The picture and the
 * rung list share exactly those three and add no fourth, so a picture that agreed with
 * itself but not with its own legend would be a surface contradicting its caption.
 *
 * IN GRAYSCALE every one is a grey and the chart is reviewed on shape: the bend of the
 * cumulative curve, the ring sizes growing down the ladder, the 5:4 box and the 500px
 * cap. Colour is deliberately not reviewable, and `--nms-now` is grayscale in the
 * package's base mode for that reason.
 *
 * THE WRAPPER IS `aria-hidden` AND ITS SURFACE IS `tabIndex={-1}` (ADR-019). The chart is
 * presentation; the generated convexity caption in `apps/web` is its substitute. Nothing
 * below gives it a seat in the accessibility tree.
 *
 * SYNTHESIZED. Every rung, price, size and figure comes from
 * `price-drop-path-chart.fixtures.ts`, authored beside the component. No ledger output
 * and no plans-sidecar content has been near them, and this fixture imports nothing from
 * `apps/web`.
 */

/** A titled band, so a mode switch is read one state at a time. */
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
      <h3 className="mb-1 text-sm font-medium">{title}</h3>
      <p className="mb-3 text-xs text-foreground/60">{note}</p>
      <div className="max-w-[520px]">{children}</div>
    </section>
  );
}

export default {
  "a partly walked ladder": (
    <div>
      <Row
        title="filled, waiting, now — and a rung selected"
        note="The state that draws the most marks at once, and the one to judge every colour on. Reads 1 and 2 (the wrapper's text colour, which is the chart library's whole theme, and the legend list); 3, 4 and 5 (the three swatches, each a total map of colour AND border style); 6 and 7 (the dashed waiting path and the solid filled path, meeting on the shared junction rung); 8 and 9 (the horizontal now rule at spot and its end-anchored label at the right edge); 10 and 11 (the vertical Deployed rule and its label, in NEUTRAL ink rather than a fourth state colour); 12 to 15 (the hollow rung rings, card-surface fill with a grey or green stroke); and 16 to 19 (the selection halo punching a hole in the line, and the solid disc on top of it)."
      >
        <PriceDropPathChart
          rungs={walkedLadder()}
          selectedKey="r4"
          spotUsd={SPOT_USD}
          deployed={DEPLOYED_KNOWN}
        />
      </Row>
      <Row
        title="the same ladder, deployed unknown"
        note="The MeasuredFigure's absent arm. The vertical rule and its label must vanish entirely rather than stand at zero: `measured and found to have spent nothing` is a different sentence from `no fill has been recorded yet`, and a rule at the left edge would say the first one. Everything else on the picture is unchanged, which is what makes the comparison worth staging."
      >
        <PriceDropPathChart
          rungs={walkedLadder()}
          selectedKey="r4"
          spotUsd={SPOT_USD}
          deployed={DEPLOYED_UNKNOWN}
        />
      </Row>
      <Row
        title="nothing selected"
        note="No halo and no disc, so reads 16 to 19 are absent here. Selection is the only mark tied to live UI state — it moves as the operator works the inspect slider — and this band is what the picture looks like before they touch it."
      >
        <PriceDropPathChart
          rungs={walkedLadder()}
          selectedKey={undefined}
          spotUsd={SPOT_USD}
          deployed={DEPLOYED_KNOWN}
        />
      </Row>
    </div>
  ),

  "day zero": (
    <div>
      <Row
        title="declared, unwalked, and no spot"
        note="No rung filled, so the solid slice is empty and the whole path draws dashed; the `Filled` entry leaves the legend with it. No live spot, so the now rule, its label and the `Now` swatch are all absent — a last close is not `now`, and the caller passes nothing rather than a stale number. `Waiting` is the only key left, which is the gate the chart set for itself working in the direction that is easy to get wrong."
      >
        <PriceDropPathChart
          rungs={dayZeroLadder()}
          selectedKey={undefined}
          spotUsd={undefined}
          deployed={DEPLOYED_UNKNOWN}
        />
      </Row>
      <Row
        title="unwalked, but price has arrived"
        note="The same ladder with a live spot, so the now rule and the `Now` swatch draw against a fully dashed path. This is where the minted token is easiest to judge: one saturated horizontal rule and its label, against grey. If it is invisible, `--nms-now` is undefined rather than the chart being wrong."
      >
        <PriceDropPathChart
          rungs={dayZeroLadder()}
          selectedKey="r2"
          spotUsd={57500}
          deployed={DEPLOYED_UNKNOWN}
        />
      </Row>
    </div>
  ),
};

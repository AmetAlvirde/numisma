import { Shell } from "@numisma/components";

/**
 * THE PAGE COLUMN, AND THE FOUR THINGS IT IS (spec #439 §S0).
 *
 * `Shell` is six utilities and no colour: `mx-auto my-0 flex max-w-[760px]
 * flex-col gap-4 p-4`. Its whole class attribute is geometry, which makes this
 * fixture the wave's NEGATIVE CONTROL for the mode switcher — grayscale, themed
 * and app mode must paint the shell identically. A shell that repaints when the
 * switcher moves means something in the fixture below is reading a token the
 * component does not, and that is a defect in the fixture rather than a finding
 * about `Shell`.
 *
 * WHAT TO LOOK FOR, and each row is staged so it is observable rather than
 * asserted:
 *
 * 1. THE GAP. Two or more stacked children, so the 16px `gap-4` reads as a gap
 *    and not as a coincidence of two boxes with their own margins.
 * 2. THE PADDING. Visible on all four sides, which is what `p-4` is. The dashed
 *    outline below is on the shell itself, so the inset is the padding.
 * 3. THE CAP AND THE CENTRING. Content wider than 760px, so `max-w-[760px]`
 *    clamps and `mx-auto` centres what is left. The ruler row overflows on
 *    purpose; if it does not clamp, the cap is not live.
 * 4. THE BLOCK MARGINS. The shell sits against a band above and a band below, so
 *    `my-0` has a rendered consequence: preflight is off, the UA's own `main`
 *    margin is live here too, and `mx-auto` alone would leave a gap at the top
 *    and bottom edges that no assertion in the repo would see.
 *
 * SYNTHESIZED. Every word is a placeholder. No ledger output has been near this
 * file, and the fixture imports nothing from `apps/web`.
 */

/** A hard band flush against the shell, so a block margin would show as a gap. */
function Band({ label }: { label: string }) {
  return (
    <div className="bg-foreground/10 px-3 py-2 text-xs uppercase tracking-wide">
      {label}
    </div>
  );
}

/** A child with its own edge, so the 16px between children is legible. */
function Block({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-foreground/20 p-3 text-sm">{children}</div>
  );
}

export default {
  "the page column": (
    <div>
      <Band label="flush above — my-0 means no gap here" />
      <Shell>
        <Block>
          The first stacked child. The space between this box and the next is
          `gap-4`, not a margin either box carries.
        </Block>
        <Block>
          The second. Three children rather than two, because a single gap can be
          read as one box&apos;s margin and two cannot.
        </Block>
        <Block>
          <div className="w-[1100px] whitespace-nowrap font-mono text-xs">
            ← 1100px of content, wider than the 760px cap. It clamps and scrolls
            inside this box; the column itself stays centred. ←
          </div>
        </Block>
      </Shell>
      <Band label="flush below — my-0 means no gap here either" />
    </div>
  ),
};

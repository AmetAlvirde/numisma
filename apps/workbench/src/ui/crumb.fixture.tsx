import { Crumb } from "@numisma/components";

/**
 * THE CRUMB, BOTH DIRECTIONS, AND THE HOVER (spec #432 §4.4, slice #437).
 *
 * `Crumb` reads exactly two colours and BOTH SIT IN THE SAME CLASS ATTRIBUTE: the
 * resting `text-[var(--nms-muted-foreground)]` and the hovered
 * `hover:text-[var(--nms-foreground)]`. THE SECOND ONE ONLY EXISTS UNDER A POINTER.
 * A screenshot of this fixture shows half the component; the other half is one
 * mouse move away, and a fixture nobody hovers is a fixture that has reviewed one
 * of the two reads.
 *
 * WHAT TO LOOK FOR IN APP MODE: `#9aa1ad` at rest — the app's secondary-text grey,
 * the same one `Absent` paints — brightening to `#e7e9ee` on hover. `#14161c`
 * resting would mean `--nms-muted`, the recessed SURFACE, got welded onto the text
 * role, which is the mistake the whole wave was cut to catch and which no guard in
 * the repo can see. In themed mode BOTH values must move. A crumb that changes
 * colour at rest and keeps its old hover is a hover reading a name nothing
 * repainted.
 *
 * THE LINK IS A DEAD `<a href="#">`, AND THAT IS THE CORRECT STUB, not a
 * compromise. `Crumb` takes a `renderLink` slot precisely so the package needs no
 * router; the workbench has none, and `seam-isolation.test.ts` forbids this file
 * from importing anything out of `apps/web` to borrow one. A fixture whose link
 * navigated would be a fixture that has just left the state you were looking at.
 *
 * BOTH DIRECTIONS ARE STAGED because the arrow is the caller's. `apps/web` renders
 * four crumbs pointing up to the glance and one pointing down to the big picture,
 * and nothing in the component derives the glyph from the destination — so the
 * pair below is what the app renders, not a symmetry invented here.
 *
 * SYNTHESIZED. The two labels are the literal strings the routes spell.
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
      {children}
    </section>
  );
}

/** The workbench's stand-in for a typed `<Link>`: same anchor, no navigation. */
function deadLink({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <a className={className} href="#">
      {children}
    </a>
  );
}

export default {
  "both directions": (
    <div>
      <Row
        title="up"
        note="What four of the five call sites render. Hover it: the resting grey is one token and the hover is another."
      >
        <Crumb renderLink={deadLink}>← Glance</Crumb>
      </Row>
      <Row
        title="down"
        note="The glance's own crumb, pointing at the big picture. The glyph is the caller's; nothing in the component derives it."
      >
        <Crumb renderLink={deadLink}>Big picture →</Crumb>
      </Row>
    </div>
  ),
};

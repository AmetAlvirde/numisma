import { Absent } from "@numisma/components";

/**
 * ABSENT, BOTH FORMS, BECAUSE BOTH PAINT (spec #432 §4.1, slice 1).
 *
 * `Absent` reads exactly one colour and reads it twice: the surface constant
 * carries `text-[var(--nms-muted-foreground)]` and so does the inner reason
 * `<span>`. THE SECOND READ ONLY EXISTS ON SCREEN, though — the reason element is
 * rendered either way, since the prop defaults to `suppressed`, which is itself a
 * behaviour worth looking at rather than trusting.
 *
 * SO BOTH FORMS ARE STAGED. The bare `<Absent />` shows the default; the one
 * carrying a reason shows what five call sites in `apps/web` actually render. If
 * either row keeps its grey while the mode switcher moves to themed, a read is
 * unexercised or misnamed, and that is the finding this fixture exists to make
 * visible.
 *
 * WHAT TO LOOK FOR IN APP MODE: `#9aa1ad`, the app's secondary-text grey, on the
 * em dash and on the reason alike. `#14161c` would mean `--nms-muted` — the
 * recessed SURFACE — got welded onto the text role, which is the mistake this
 * whole slice was cut to catch, and it is a mistake no guard in the repo can see.
 * Only this fixture can.
 *
 * THE `[dd_&]` VARIANTS ARE NOT STAGED HERE. They key off an ancestor `<dd>`,
 * which is the app's metrics context; staging one would mean building a `<dl>`
 * around the primitive in the workbench and calling that a component state.
 * `absent-contract.test.tsx` pins those class strings in `apps/web`, where the
 * context they name actually exists.
 *
 * SYNTHESIZED, NEVER SEEDED FROM REAL LEDGER OUTPUT. The reasons below are the
 * ones the app's view modules already spell in their own source.
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
      <div className="flex flex-wrap items-center gap-6">{children}</div>
    </section>
  );
}

export default {
  "both forms": (
    <div>
      <Row
        title="bare"
        note="No reason given. The prop defaults to `suppressed`, and the reason element renders anyway — both colour reads are on screen."
      >
        <Absent />
      </Row>
      <Row
        title="with a stated cause"
        note="What the five apps/web call sites render. The em dash is decoration; the words are the information."
      >
        <Absent why="no current mark" />
        <Absent why="no fund value" />
      </Row>
    </div>
  ),
};

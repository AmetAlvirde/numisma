import { Button } from "@numisma/components";

/**
 * BUTTON, EVERY STATE IT ENUMERATES (issue #418).
 *
 * `Button` is the whole of `@numisma/components`' rendered surface today, so
 * this is the whole of the workbench's coverage. `fixture-coverage.test.ts`
 * reads the package's public exports and demands a fixture per component, so
 * the next component to be exported turns that test red until it has one here.
 *
 * SYNTHESIZED, NEVER SEEDED FROM REAL LEDGER OUTPUT. Standing house rule, and
 * it bites harder here than usual: a fixture is a file a human opens and reads
 * closely, and one seeded from a real position would put a real trade on screen
 * every time someone reviewed a button.
 *
 * THE LABELS ARE THE VARIANT NAMES on purpose. A fixture is read against the
 * source, and "Delete account" would make a reviewer match prose to a variant
 * instead of seeing it named.
 *
 * WHAT NO FIXTURE CAN STAGE: `focus-visible`. It needs real keyboard focus, so
 * `--nms-ring` — the one token whose absence is an accessibility defect rather
 * than a cosmetic one — is verified by TABBING THROUGH this fixture, not by
 * looking at it. That is a step in the manual theming procedure, and it is why
 * the ring is not merely "a colour that did not change".
 */

const VARIANTS = [
  "default",
  "outline",
  "secondary",
  "ghost",
  "destructive",
  "link",
] as const;

const SIZES = ["xs", "sm", "default", "lg"] as const;

const ICON_SIZES = ["icon-xs", "icon-sm", "icon", "icon-lg"] as const;

/** A titled band of buttons, so a mode switch is read row by row. */
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
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

export default {
  variants: (
    <Row
      title="Variants"
      note="Every fill and text role the component enumerates. In themed mode each of these should land on a different colour; two that match are two roles reading one token."
    >
      {VARIANTS.map((variant) => (
        <Button key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
    </Row>
  ),

  sizes: (
    <Row
      title="Sizes"
      note="The height and radius scale. `default` and `lg` carry a plain `rounded-md`, so a radius change moves them by the full token value; `xs` and `sm` clamp against --nms-radius-md and stop moving once it passes 8px/10px."
    >
      {SIZES.map((size) => (
        <Button key={size} size={size}>
          {size}
        </Button>
      ))}
    </Row>
  ),

  "icon sizes": (
    <Row
      title="Icon sizes"
      note="Square variants of the same scale. The glyph is a plain character so no icon library enters the workbench."
    >
      {ICON_SIZES.map((size) => (
        <Button key={size} size={size} aria-label={size}>
          +
        </Button>
      ))}
    </Row>
  ),

  states: (
    <Row
      title="States"
      note="Disabled drops opacity and kills pointer events. aria-invalid repaints border and ring from --nms-destructive — the one state that is a token check rather than a style check. Focus-visible cannot be staged: tab into these."
    >
      {VARIANTS.map((variant) => (
        <Button key={`disabled-${variant}`} variant={variant} disabled>
          {variant} disabled
        </Button>
      ))}
      {VARIANTS.map((variant) => (
        <Button key={`invalid-${variant}`} variant={variant} aria-invalid>
          {variant} invalid
        </Button>
      ))}
    </Row>
  ),
};

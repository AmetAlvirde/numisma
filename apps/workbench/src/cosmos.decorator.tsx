import { useEffect } from "react";

import type { DecoratorProps } from "react-cosmos/client";
import { useFixtureSelect } from "react-cosmos/client";

import "./tailwind.css";
import { DEFAULT_THEME_MODE, THEME_MODES, themeModeById } from "./theme-modes";

/**
 * THE THREE-MODE DECORATOR (spec #412 §10 Q2; issue #418).
 *
 * Cosmos applies a `cosmos.decorator` file to every fixture in its directory
 * and below, so this wraps the whole workbench: grayscale, themed and app are
 * reachable from any fixture, from the `theme` control in the Cosmos panel, and
 * a fixture never has to opt in.
 *
 * ── WHY THE ROOT ELEMENT, AND NOT A WRAPPER DIV ────────────────────────────
 *
 * This is the one thing in the workbench that looks arbitrary and is not.
 *
 * The package's components reach a token TWO WAYS. Bare, inside an arbitrary
 * value — `color-mix(in oklch, var(--nms-secondary), …)` — which resolves
 * against the ELEMENT BEING PAINTED. And through a Tailwind theme utility —
 * `bg-primary`, which compiles to `var(--color-primary)`, and `--color-primary`
 * is declared once, on `:root`, as `var(--nms-primary)`.
 *
 * A custom property's `var()`s are substituted WHERE THE PROPERTY IS DECLARED,
 * not where it is finally read. So a wrapper div redefining `--nms-primary`
 * moves the bare reads and leaves `--color-primary` exactly as `:root` computed
 * it. Half the tokens switch, half do not, and nothing on screen says which
 * half — the precise shape of a silent failure the whole increment is built to
 * make loud. Writing the override onto the SAME ELEMENT that carries the
 * `@theme` block makes both halves move together, and inline style beats the
 * `layer(theme)` the generated defaults arrive in.
 *
 * `document` HERE IS THE RENDERER IFRAME'S, not the Cosmos UI's. The decorator
 * runs inside the renderer, so the Cosmos chrome keeps its own styling and only
 * the fixture surface is themed. The cleanup removes exactly the names it set,
 * which is what lets a mode switch to a mode with FEWER tokens (the package's
 * twelve, after app mode's fourteen) without leaving two stale values behind.
 */
export default function ThemeModeDecorator({ children }: DecoratorProps) {
  const [modeId] = useFixtureSelect("theme", {
    options: THEME_MODES.map((mode) => mode.id),
    defaultValue: DEFAULT_THEME_MODE,
  });

  const mode = themeModeById(modeId);

  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(mode.tokens)) {
      root.style.setProperty(name, value);
    }
    // Not read by any rule — it is the handle the manual theming procedure and
    // any future browser check use to assert WHICH mode a computed colour came
    // from, without inferring it from the colour itself.
    root.setAttribute("data-nms-mode", mode.id);

    return () => {
      for (const name of Object.keys(mode.tokens)) {
        root.style.removeProperty(name);
      }
      root.removeAttribute("data-nms-mode");
    };
  }, [mode]);

  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <p className="mb-6 text-xs text-foreground/60">
        {mode.label} — {mode.blurb}
      </p>
      {children}
    </div>
  );
}

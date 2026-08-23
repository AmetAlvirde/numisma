import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { TOKEN_CONSUMERS, consumerTokensCss } from "./consumers.ts";
import {
  atDirectoryMessage,
  findAtDirectory,
  radixDependencies,
  radixDependencyMessage,
} from "./guards.ts";
import {
  PACKAGE_ROOT,
  REPO_ROOT,
  packageSourceFiles,
} from "./package-source.ts";
import {
  bareCustomPropertyDeclarations,
  namespaceCustomPropertyReads,
  relativizeAliasImports,
} from "./rewrites.ts";
import {
  discoverTokenNamesAcross,
  mergeTokenDeclarations,
  parseTokenDeclarations,
} from "./tokens-file.ts";
import { withPaths, withoutPaths } from "./tsconfig-paths.ts";

/**
 * THE ONLY SANCTIONED WAY TO ADD A shadcn COMPONENT TO @numisma/components.
 *
 *     pnpm components:add badge          # add (or re-add) one component
 *     pnpm components:add badge input    # several in one pass
 *     pnpm components:add                # no CLI call: just re-run the rewrites,
 *                                        # the token merge and every consumer file
 *
 * It exists because two facts pull in opposite directions. The CLI needs a
 * tsconfig `paths` mapping to place files at the `@/` alias, and the shipped
 * package must not have one (Seam A). Doing that dance by hand on every add
 * eventually leaves a stray `@/` import, a bare `var(--muted)` read, or a
 * committed directory named `@` — and each of those reports success at the
 * time.
 *
 * FIVE STEPS, IN THIS ORDER:
 *
 *   1. Inject `baseUrl` + `paths`, run `shadcn add`, strip them again in a
 *      `finally` so a failed add cannot leave them behind.
 *   2. Rewrite `@/…` specifiers to relative, extensionless ones.
 *   3. Rewrite bare custom-property reads into the `--nms-` namespace.
 *   4. Refresh `packages/components/src/tokens.ts` with newly discovered names
 *      and their grayscale defaults, then regenerate every registered
 *      consumer's tokens file from that spec.
 *   5. Run the guards, and exit non-zero on any of them.
 *
 * Steps 2 to 4 run over the WHOLE package, not just the files this invocation
 * placed, so the tree converges on the same state no matter what happened
 * before. Every one of them is idempotent, which is what makes a re-add of an
 * existing component safe.
 *
 * KNOWN LIMIT, ALREADY PAID: `shadcn init` cannot be made to work against a
 * frameworkless package — it wants a framework it can detect. `components.json`
 * is therefore hand-written and committed, and `add` works fine against it.
 * That is a one-time cost, not a per-component one.
 *
 * THE COST OF ALL THIS: package source no longer diffs cleanly against upstream
 * shadcn, and every add and re-add must come through here. That trade is owed to
 * ADR-023 (spec #412 §8), which is not written yet.
 */

/**
 * The CLI version this script's rewrites were validated against. Pinned rather
 * than `@latest` so an upstream change to how files are placed shows up as a
 * deliberate bump here, with a re-run to prove it, instead of as a surprise on
 * whichever add happens next. Override with `SHADCN_VERSION` to test one.
 */
const SHADCN_VERSION = process.env["SHADCN_VERSION"] ?? "4.19.0";

/** A failure the operator is meant to read and act on, not a stack trace. */
class AddFailure extends Error {}

function log(message: string): void {
  console.log(message);
}

/** Step 1: place the files, with the alias mapping in place for exactly that long. */
function runShadcnAdd(components: readonly string[]): void {
  const tsconfigPath = join(PACKAGE_ROOT, "tsconfig.json");
  const original = readFileSync(tsconfigPath, "utf8");

  writeFileSync(tsconfigPath, withPaths(original));
  try {
    log(`shadcn@${SHADCN_VERSION} add ${components.join(" ")}`);
    const result = spawnSync(
      "pnpm",
      [
        "dlx",
        `shadcn@${SHADCN_VERSION}`,
        "add",
        ...components,
        "--yes",
        "--overwrite",
      ],
      { cwd: PACKAGE_ROOT, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new AddFailure(
        `shadcn add exited ${result.status}. Nothing below has run; the ` +
          `tsconfig alias mapping has been stripped again.`,
      );
    }
  } finally {
    writeFileSync(tsconfigPath, withoutPaths(readFileSync(tsconfigPath, "utf8")));
  }
}

/** Steps 2 and 3, over every source file in the package. */
function applyRewrites(): string[] {
  const touched: string[] = [];
  const declaring: string[] = [];

  for (const file of packageSourceFiles()) {
    const before = readFileSync(file.absolute, "utf8");
    const after = namespaceCustomPropertyReads(
      relativizeAliasImports(before, file.dirWithinSrc),
    );
    if (after !== before) {
      writeFileSync(file.absolute, after);
      touched.push(file.absolute.slice(REPO_ROOT.length + 1));
    }
    for (const name of bareCustomPropertyDeclarations(after)) {
      declaring.push(`${file.absolute.slice(REPO_ROOT.length + 1)}: ${name}`);
    }
  }

  if (declaring.length > 0) {
    throw new AddFailure(
      [
        "A placed component DECLARES a custom property outside the namespace,",
        "either as a Tailwind arbitrary property or as a JSX inline style:",
        ...declaring.map((entry) => `  ${entry}`),
        "",
        "A declaration is not a read, so the namespacing rewrite cannot see it,",
        "and guessing produces a component that declares one name and reads",
        "another — correct-looking CSS that computes to nothing. Decide by hand:",
        "namespace the declaration and its reads together, or leave both bare and",
        "keep the property local to the component.",
      ].join("\n"),
    );
  }
  return touched;
}

/** Step 4a: fold newly discovered names into the token spec. */
function refreshTokens(origin: string): { name: string; value: string }[] {
  const tokensPath = join(PACKAGE_ROOT, "src", "tokens.ts");
  const files = packageSourceFiles().filter(
    (file) => !file.absolute.endsWith("tokens.ts"),
  );
  const discovered = discoverTokenNamesAcross(
    files.map((file) => readFileSync(file.absolute, "utf8")),
  );

  const merged = mergeTokenDeclarations(
    readFileSync(tokensPath, "utf8"),
    discovered,
    origin,
  );
  if (merged.unknown.length > 0) {
    throw new AddFailure(
      [
        `No grayscale default is known for ${merged.unknown.join(", ")}.`,
        "",
        "Nothing was written for those names, deliberately: a placeholder value",
        "would satisfy the token spec's own test and ship the wrong colour.",
        "Declare each one by hand in packages/components/src/tokens.ts with a",
        "grayscale value and a note saying what reads it, add it to",
        "SHADCN_TOKEN_DEFAULTS in ops/components/tokens-file.ts if it is a shadcn",
        "role, then re-run.",
      ].join("\n"),
    );
  }

  if (merged.added.length > 0) {
    writeFileSync(tokensPath, merged.text);
    log(`tokens.ts: added ${merged.added.join(", ")}`);
  } else {
    log("tokens.ts: no new tokens");
  }
  return parseTokenDeclarations(merged.text);
}

/** Step 4b: regenerate every registered consumer's tokens file. */
function regenerateConsumers(tokens: readonly { name: string; value: string }[]): void {
  if (TOKEN_CONSUMERS.length === 0) {
    // Not a fault. Nothing consumes the package yet — `apps/web` mounts
    // Tailwind in Slice 3 — and the registry in `consumers.ts` says how to
    // become the first one.
    log("consumers: none registered (see ops/components/consumers.ts)");
    return;
  }
  const css = consumerTokensCss(tokens);
  for (const consumer of TOKEN_CONSUMERS) {
    const path = join(REPO_ROOT, consumer.tokensFile);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, css);
    log(`consumers: wrote ${consumer.tokensFile} (${consumer.label})`);
  }
}

/** Step 5. Runs whatever happened above, because these are the silent failures. */
function runGuards(): void {
  const stray = findAtDirectory(PACKAGE_ROOT);
  if (stray !== null) {
    throw new AddFailure(atDirectoryMessage(stray));
  }
  const radix = radixDependencies(
    JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")),
  );
  if (radix.length > 0) {
    throw new AddFailure(radixDependencyMessage(radix));
  }
}

function main(): void {
  const components = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  let failure: unknown;

  try {
    if (components.length > 0) {
      runShadcnAdd(components);
    } else {
      log("no component named: rewriting and regenerating in place");
    }
    const touched = applyRewrites();
    log(
      touched.length === 0
        ? "rewrites: nothing to change"
        : `rewrites: ${touched.join(", ")}`,
    );
    regenerateConsumers(refreshTokens(components.join(", ") || "no component"));
  } catch (error) {
    failure = error;
  }

  // The guards run even when something above threw: an `@` directory left by a
  // half-finished add is exactly the state worth reporting, and a failure that
  // hides it is the failure this script exists to prevent.
  try {
    runGuards();
  } catch (error) {
    if (failure === undefined) failure = error;
    else console.error(`\n${(error as Error).message}`);
  }

  if (failure !== undefined) {
    console.error(
      `\n${failure instanceof AddFailure ? failure.message : String(failure)}`,
    );
    process.exit(1);
  }
  log(
    "done. Run `pnpm typecheck` and `pnpm test`.\n" +
      "A new component is NOT exported yet: the public surface in " +
      "packages/components/src/index.ts is curated by hand, one name at a time, " +
      "and this script deliberately does not edit it.",
  );
}

main();

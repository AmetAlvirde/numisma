/**
 * This package's two data-dir DOORS, driven through the shared contract table (#369).
 *
 * `resolveSidecarPath` and `resolvePreferencesPath` are separate doors, not one: the
 * sidecar resolver is what `plans.jsonl`, `orders.jsonl` and `reconciliations.jsonl`
 * reach the data root through, while the preferences resolver has its own because its
 * `undefined` arm and its refusal wording are its own. Before #369 they DISAGREED — the
 * sidecar door refused `~/x` as non-absolute while the preferences door silently produced
 * `<cwd>/~/x`, and the preferences door accepted a bare `"data"` the sidecar door refused.
 * One table over both is what makes that state unreachable rather than merely fixed.
 *
 * The per-door suites (`plans-reliable`, `preferences-reliable`) keep their own #348
 * blank-refusal cases: those pin each door's error PROSE, which is deliberately different
 * per door and is not the table's business. This file pins that the two doors compute the
 * same ROOT from the same input.
 *
 * Pure path algebra — nothing here touches a filesystem, so no case can reach a real
 * data dir.
 */
import { dirname } from "node:path";
import { resolveDataDir } from "@numisma/engine";
import { assertDataDirContract } from "@numisma/engine/testkit";
import { resolvePreferencesPath } from "./preferences.js";
import { resolveSidecarPath } from "./sidecar-io.js";

// The file name is incidental to the table — the door reports the ROOT it resolved, and
// which leaf a sidecar appends is pinned by that sidecar's own suite.
const SIDECAR_PROBE_FILE = "orders.jsonl";

assertDataDirContract({
  name: "resolveSidecarPath",
  subject: /a sidecar data directory/,
  root: (dataDir) => dirname(resolveSidecarPath(SIDECAR_PROBE_FILE, dataDir)),
  defaultArm: {
    actual: () => dirname(resolveSidecarPath(SIDECAR_PROBE_FILE)),
    expected: () => resolveDataDir(),
  },
});

assertDataDirContract({
  name: "resolvePreferencesPath",
  subject: /a preferences data directory/,
  root: (dataDir) => dirname(resolvePreferencesPath(dataDir)),
  defaultArm: {
    actual: () => dirname(resolvePreferencesPath()),
    expected: () => resolveDataDir(),
  },
});

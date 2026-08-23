import { readdirSync, statSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the component package's source is, and how to walk it. Shared by the
 * add script and by the tests that hold the script's claims about the package.
 */

/** The repo root, resolved from this file rather than from `process.cwd()`. */
export const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

/** `packages/components`, absolute. */
export const PACKAGE_ROOT = join(REPO_ROOT, "packages", "components");

/** `packages/components/src`, absolute. The `@/` alias points here. */
export const PACKAGE_SRC = join(PACKAGE_ROOT, "src");

/** One source file in the package, with the two paths the rewrites need. */
export interface PackageSourceFile {
  /** Absolute path on disk. */
  readonly absolute: string;
  /**
   * The file's directory relative to `src`, in POSIX form — `"ui"` for
   * `src/ui/button.tsx`, `""` for a file at the root of `src`. This is what
   * turns `@/lib/utils` into `../lib/utils`.
   */
  readonly dirWithinSrc: string;
}

/** Every `.ts`/`.tsx` file under `src`, tests excluded, in a stable order. */
export function packageSourceFiles(dir: string = PACKAGE_SRC): PackageSourceFile[] {
  return readdirSync(dir)
    .sort()
    .flatMap((entry) => {
      const absolute = join(dir, entry);
      if (statSync(absolute).isDirectory()) return packageSourceFiles(absolute);
      if (!/\.tsx?$/.test(entry)) return [];
      if (/\.test\.tsx?$/.test(entry)) return [];
      return [{ absolute, dirWithinSrc: dirWithinSrc(absolute) }];
    });
}

/** A file's directory relative to `src`, POSIX-separated. */
export function dirWithinSrc(absolute: string): string {
  const fromSrc = relative(PACKAGE_SRC, absolute).split(sep).join(posix.sep);
  return posix.dirname(fromSrc) === "." ? "" : posix.dirname(fromSrc);
}

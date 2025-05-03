"use client"; // Required for window.matchMedia

export type SystemTheme = "light" | "dark";

/**
 * Detects the user's preferred system color scheme.
 * Returns 'dark' or 'light'.
 * Returns 'light' if `window.matchMedia` is not supported or in non-browser environments.
 */
export function getSystemTheme(): SystemTheme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

/**
 * Subscribes to changes in the system color scheme.
 * @param callback The function to call when the theme changes.
 * @returns A function to unsubscribe from the changes.
 */
export function subscribeToSystemThemeChange(
  callback: (theme: SystemTheme) => void
): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    // Return a no-op unsubscribe function if not in a browser or matchMedia is not supported
    return () => {};
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  const handleChange = (event: MediaQueryListEvent) => {
    callback(event.matches ? "dark" : "light");
  };

  // Use addEventListener for modern browsers
  mediaQuery.addEventListener("change", handleChange);

  // Return a function to remove the listener
  return () => {
    mediaQuery.removeEventListener("change", handleChange);
  };
}

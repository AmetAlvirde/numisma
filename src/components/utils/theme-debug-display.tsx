"use client";

import { useTheme } from "next-themes";
import { useState, useEffect } from "react";

/**
 * A client component to display theme debug information.
 */
export function ThemeDebugDisplay() {
  const { theme, resolvedTheme } = useTheme();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null;
  }

  return (
    <div className="p-2 border rounded bg-muted text-muted-foreground text-xs">
      <p>Debug Info:</p>
      <p>Preference: {theme}</p>
      <p>Resolved: {resolvedTheme}</p>
    </div>
  );
}

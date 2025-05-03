"use client";

import { useState, useEffect } from "react";

type Theme = "light" | "dark" | "system";

export function ThemeSelector() {
  // Initialize state, defaulting to 'system' for now
  // We'll add persistence/loading logic later
  const [theme, setTheme] = useState<Theme>("system");

  // Effect to apply the theme class to the <html> element
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      // Handle 'system' - for now, default to light (remove dark class)
      // In Phase 2, this will check system preference
      root.classList.remove("dark");
      // TODO: Implement system theme detection logic here later
    }
  }, [theme]);

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setTheme(event.target.value as Theme);
    // TODO: Save preference to storage later (Phase 4)
  };

  return (
    <div className="mb-4">
      <label htmlFor="theme-select" className="mr-2">
        Theme:
      </label>
      <select
        id="theme-select"
        value={theme} // Bind select value to state
        onChange={handleChange} // Handle changes
        className="p-1 border rounded bg-background text-foreground border-border"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  );
}

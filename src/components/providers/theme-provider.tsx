"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import {
  getSystemTheme,
  subscribeToSystemThemeChange,
  SystemTheme,
} from "@/utils/theme";

export type ThemePreference = SystemTheme | "system";

interface ThemeContextProps {
  themePreference: ThemePreference;
  resolvedTheme: SystemTheme;
  setThemePreference: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: ThemePreference;
  storageKey?: string; // Optional: For Phase 4 (Persistence)
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "theme",
}: ThemeProviderProps) {
  // State for the user's preference ('light', 'dark', or 'system')
  // TODO (Phase 4): Initialize from localStorage if available
  const [themePreference, setThemePreference] =
    useState<ThemePreference>(defaultTheme);

  // State for the currently resolved theme ('light' or 'dark')
  const [resolvedTheme, setResolvedTheme] = useState<SystemTheme>(() => {
    // Set initial resolved theme based on preference and system
    return themePreference === "system" ? getSystemTheme() : themePreference;
  });

  // Effect to handle system theme changes
  useEffect(() => {
    let unsubscribe = () => {};

    if (themePreference === "system") {
      const handleSystemThemeChange = (systemTheme: SystemTheme) => {
        setResolvedTheme(systemTheme);
      };

      // Set initial resolved theme based on current system theme
      setResolvedTheme(getSystemTheme());
      // Subscribe to changes
      unsubscribe = subscribeToSystemThemeChange(handleSystemThemeChange);
    } else {
      // If preference is not 'system', set resolved theme directly
      setResolvedTheme(themePreference);
    }

    // Cleanup subscription on unmount or when themePreference changes
    return unsubscribe;
  }, [themePreference]);

  // Effect to apply the theme class to the HTML element
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  const value = {
    themePreference,
    resolvedTheme,
    setThemePreference: (pref: ThemePreference) => {
      // TODO (Phase 4): Save to localStorage
      setThemePreference(pref);
    },
  };

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};

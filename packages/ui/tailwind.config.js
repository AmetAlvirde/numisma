/** @type {import('tailwindcss').Config} */

import defaultTheme from "tailwindcss/defaultTheme";

export const darkMode = ["class"];
export const content = [
  "./pages/**/*.{ts,tsx}",
  "./components/**/*.{ts,tsx}",
  "./app/**/*.{ts,tsx}",
  "./src/**/*.{ts,tsx}",
];
export const prefix = "";
export const theme = {
  container: {
    center: true,
    padding: "2rem",
    screens: {
      "2xl": "1400px",
    },
  },
  extend: {
    colors: {
      // Base colors
      background: "var(--color-background)",
      card: "var(--color-card)",
      divider: "var(--color-divider)",
      interactive: "var(--color-interactive)",

      // Text colors
      text: {
        primary: "var(--color-text-primary)",
        secondary: "var(--color-text-secondary)",
        tertiary: "var(--color-text-tertiary)",
        placeholder: "var(--color-text-placeholder)",
      },

      // Accent colors
      gold: {
        primary: "var(--color-gold-primary)",
        light: "var(--color-gold-light)",
        dark: "var(--color-gold-dark)",
      },
      blue: {
        primary: "var(--color-blue-primary)",
        light: "var(--color-blue-light)",
        dark: "var(--color-blue-dark)",
      },

      // Semantic colors
      success: {
        DEFAULT: "var(--color-success)",
        light: "var(--color-success-light)",
        dark: "var(--color-success-dark)",
      },
      danger: {
        DEFAULT: "var(--color-danger)",
        light: "var(--color-danger-light)",
        dark: "var(--color-danger-dark)",
      },
      warning: {
        DEFAULT: "var(--color-warning)",
        light: "var(--color-warning-light)",
        dark: "var(--color-warning-dark)",
      },
      info: {
        DEFAULT: "var(--color-info)",
        light: "var(--color-info-light)",
        dark: "var(--color-info-dark)",
      },
    },
    borderRadius: {
      lg: "var(--radius)",
      md: "calc(var(--radius) - 2px)",
      sm: "calc(var(--radius) - 4px)",
    },
    keyframes: {
      "accordion-down": {
        from: { height: "0" },
        to: { height: "var(--radix-accordion-content-height)" },
      },
      "accordion-up": {
        from: { height: "var(--radix-accordion-content-height)" },
        to: { height: "0" },
      },
    },
    animation: {
      "accordion-down": "accordion-down 0.2s ease-out",
      "accordion-up": "accordion-up 0.2s ease-out",
    },
    fontFamily: {
      sans: ['"Quicksand"', ...defaultTheme.fontFamily.sans],
    },
  },
};
export const plugins = [require("tailwindcss-animate")];

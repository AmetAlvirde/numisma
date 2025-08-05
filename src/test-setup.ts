import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Make React available globally for JSX
import React from "react";
globalThis.React = React;

// Comprehensive React.act polyfill for React 19 compatibility
import { act } from "react";

// Note: TypeScript declarations for React.act removed to avoid namespace linting issues
// The runtime polyfill below should handle compatibility

// Ensure React.act is available for @testing-library/react
if (typeof React.act !== "function") {
  try {
    // Try direct assignment first
    React.act = act;
  } catch {
    // If that fails, use Object.defineProperty
    Object.defineProperty(React, "act", {
      value: act,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
}

// Additional polyfill for global React
if (
  typeof globalThis.React === "object" &&
  globalThis.React &&
  !globalThis.React.act
) {
  try {
    globalThis.React.act = act;
  } catch {
    // If direct assignment fails, use Object.defineProperty
    Object.defineProperty(globalThis.React, "act", {
      value: act,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
}

// Note: react-dom/test-utils polyfill removed to avoid linting issues
// The main React.act polyfill above should handle most compatibility cases

// Ensure act is available in different environments
if (typeof window !== "undefined") {
  window.React = window.React || React;
  if (window.React && !window.React.act) {
    window.React.act = act;
  }
}

// Mock Next.js router
import { vi } from "vitest";

vi.mock("next/router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    pathname: "/",
    query: {},
    asPath: "/",
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

// Cleanup after each test
afterEach(() => {
  cleanup();
});

import type { ReactNode } from "react";
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../lib/query.ts";
import appCss from "../styles.css?url";
import tailwindCss from "../tailwind.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Numisma — Fund Composition" },
    ],
    // TWO STYLESHEETS, IN THIS ORDER, AND THE ORDER IS LOAD-BEARING.
    // `styles.css` is the app's 1,396 hand-written lines and stays untouched —
    // several `*-structure.test.tsx` files assert it byte-for-byte. Tailwind
    // mounts BESIDE it from `tailwind.css`, whose output is assigned to
    // `layer(utilities)` while this file stays unlayered, so the hand-written
    // rules keep winning on any shared property. See `tailwind.css`'s header.
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: tailwindCss },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

# Plan: Light/Dark Theme Implementation

## Phase 1: Basic Theme Switching UI & Logic

- [x] Define theme variables/styles for light and dark modes (e.g., colors, fonts). Consider using CSS variables or theme objects depending on the framework.
- [x] Implement a UI element (e.g., button, toggle, dropdown) to allow users to manually select "Light", "Dark", or "System".
- [x] Implement the core logic to apply the selected theme (light or dark) globally to the application's UI.
- [x] **Verification:**
  - [x] Manually select "Light" theme via the UI element. Visually confirm all relevant UI components render in light mode.
  - [x] Manually select "Dark" theme via the UI element. Visually confirm all relevant UI components render in dark mode. Test across multiple screens/components.

## Phase 2: System Theme Preference Detection

- [x] Implement platform-specific logic to detect the user's preferred system theme (e.g., using `prefers-color-scheme` media query in web).
- [x] Expose the detected system theme ("light" or "dark") to the application's theme logic.
- [x] **Verification:**
  - [x] Add logging or a debug indicator to show the currently detected system theme.

## Phase 3: Integration and Default Behavior

- [x] Modify the theme logic:
  - If the user selected "Light" or "Dark" manually, use that theme.
  - If the user selected "System", apply the theme detected in Phase 2.
- [x] Set the default theme selection to "System" on initial app load.
- [x] Ensure the theme updates dynamically if the system theme changes _while the app is running_ (if feasible and desired).
- [x] **Verification:**
  - [x] Set system theme to Light. Launch the app. Verify it defaults to light theme (assuming default selection is "System").
  - [x] Set system theme to Dark. Launch the app. Verify it defaults to dark theme.
  - [x] While the app is running (and set to "System"), change the OS theme. Verify the app's theme updates accordingly (if dynamic updates were implemented).
  - [x] Manually select "Light". Verify the app switches to light mode, overriding the system setting.
  - [x] Manually select "Dark". Verify the app switches to dark mode, overriding the system setting.

## Phase 4: Persistence (Recommended)

- [x] Choose a storage mechanism (e.g., `localStorage`, settings file).
- [x] Save the user's explicit theme selection ("Light", "Dark", or "System") to storage whenever they change it using the UI element.
- [x] On app startup, load the saved preference. If no preference is saved, default to "System".
- [x] **Verification:**
  - [x] Select "Light" theme manually. Close and reopen the app. Verify "Light" theme is active and the UI element shows "Light" selected.
  - [x] Select "Dark" theme manually. Close and reopen the app. Verify "Dark" theme is active and the UI element shows "Dark" selected.
  - [x] Select "System" theme manually. Close and reopen the app. Verify the theme matches the current system theme and the UI element shows "System" selected.
  - [x] Clear the saved preference from storage. Relaunch the app. Verify it defaults to the "System" setting and applies the correct theme based on the OS preference.

## Phase 5: Storybook Theme Integration

- [ ] **Problem:** Components (e.g., `LoginCard`) don't switch themes correctly in Storybook, even though they do in the main app. Text color might remain unchanged.
- [ ] **Goal:** Ensure Storybook accurately reflects the light/dark themes defined in the application.

- [ ] **Investigation & Fixes:**

  - [ ] **Check Storybook Global Decorators:** Examine `.storybook/preview.tsx` (or similar global setup file). Ensure the application's theme provider (e.g., `ThemeProvider`) wraps all stories. This provider is likely responsible for applying theme classes or variables.

    ```tsx
    // Example structure in .storybook/preview.tsx
    import { ThemeProvider } from "../src/path/to/theme-provider"; // Adjust path
    import React from "react";

    export const decorators = [
      Story => (
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {/* Might need to add Tailwind's dark class wrapper if using class strategy */}
          {/* <div className="story-wrapper"> */}
          <Story />
          {/* </div> */}
        </ThemeProvider>
      ),
    ];
    ```

  - [ ] **Verify Tailwind Integration:** Confirm that Storybook's build process correctly includes and processes Tailwind CSS, especially the `darkMode: 'class'` configuration in `tailwind.config.js` if you're using the class strategy. Check if the expected CSS variables or utility classes (`dark:*` prefixes) are present in the Storybook environment's CSS.
  - [ ] **Inspect Rendered Output:** Use the browser's developer tools within Storybook. Inspect the `LoginCard` or other affected components.
    - Check if the root `<html>` or `<body>` element (or a designated wrapper) gets the `dark` class applied when switching themes in Storybook's toolbar.
    - Verify if the component's elements receive the correct theme-specific Tailwind classes (e.g., `text-foreground`, `bg-background`) and if these classes correspond to the expected light/dark styles.
  - [ ] **Consider Storybook Theme Addon:** If manual provider wrapping isn't sufficient or you want a dedicated Storybook UI for theme switching, explore addons like `@storybook/addon-themes` or `storybook-dark-mode`. Configure the addon to toggle the same class (`dark`) or mechanism your application uses.
  - [ ] **Review `LoginCard.stories.ts`:** Ensure the story itself isn't doing anything specific that overrides or interferes with the theme application (unlikely for basic stories, but worth a check).

- [ ] **Verification:**
  - [ ] Open `LoginCard.stories.ts` in Storybook.
  - [ ] Use Storybook's theme toggle (either the native one if configured via addon, or potentially a global control if added via decorator) to switch between light and dark modes.
  - [ ] Verify that the `LoginCard`'s text colors, background, input styles, and button styles update correctly according to the selected theme, matching the behavior in the main application.
  - [ ] Repeat verification for a few other key components.

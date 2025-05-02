# Implementation Plan: NextAuth.js + tRPC + Prisma Integration (App Router)

This plan outlines the steps to integrate authentication (NextAuth.js), a typesafe API (tRPC), and database interaction (Prisma) into the Next.js **App Router** application. Each step includes verification instructions.

## Phase 1: Setup & Prisma Integration

- [x] **Install Dependencies:**

  - Install `next-auth`, `@next-auth/prisma-adapter`, `@prisma/client`, `@tanstack/react-query@^4`, `@trpc/client`, `@trpc/server`, `@trpc/react-query`, `@trpc/next`.
  - Install `prisma` as a dev dependency if not already present.
  - **Verification:** Check `package.json` to confirm all dependencies are listed. Run `npm install` (or yarn/pnpm equivalent) - it should complete without errors.

- [x] **Update Prisma Schema:**

  - Add the required models for `@next-auth/prisma-adapter` (Account, Session, User, VerificationToken) to `prisma/schema.prisma`.
  - Adapt the existing `User` model to include fields expected by NextAuth.js (e.g., `emailVerified`, `image`, relationships to `Account` and `Session`). Ensure field types match adapter requirements.
  - **Verification:** Compare `prisma/schema.prisma` against the schema provided in the `@next-auth/prisma-adapter` documentation. Ensure all required models, fields, and relations (`@relation`) are present and correctly defined.

- [x] **Run Prisma Migration:**

  - Execute `npx prisma migrate dev --name init-auth` (or a suitable name).
  - **Verification:** The command should complete successfully in the terminal. Inspect your PostgreSQL database (using `psql`, pgAdmin, or another tool) to confirm that the `Account`, `Session`, `User`, and `VerificationToken` tables (or tables matching your model names) have been created or updated correctly.

- [x] **Create Prisma Client Singleton:**

  - Create the file `src/db/prisma-client.ts`.
  - Implement the singleton pattern to instantiate `PrismaClient`, preventing multiple instances during development.
  - **Verification:** The file `src/db/prisma-client.ts` exists and the code type-checks correctly (e.g., run `tsc --noEmit` or rely on editor feedback).

- [x] **Generate Prisma Client:**
  - Execute `npx prisma generate`.
  - **Verification:** The command should complete successfully. The `prisma/generated/client` directory should be updated, reflecting the latest schema.

## Phase 2: NextAuth.js Core Setup

- [x] **Create NextAuth.js API Route Handler:**

  - Create the file `src/app/api/auth/[...nextauth]/route.ts`.
  - Import `NextAuth`, `PrismaAdapter`, your `prisma` client instance, and the `CredentialsProvider`.
  - Configure `authOptions` using the `PrismaAdapter` and the `CredentialsProvider`. Implement the `authorize` function for credential handling.
  - Implement the `callbacks.session` function to add `user.id` to the session object.
  - Export the result of `NextAuth(authOptions)` as `GET` and `POST` handlers.
  - **Verification:** The file exists and type-checks correctly. Ensure necessary environment variables (`NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `DATABASE_URL`) are set. Ensure `authorize` logic is correct.

- [x] **Add SessionProvider Wrapper:**
  - Create a provider component (e.g., `src/app/providers.tsx`) with the `"use client"` directive. _(Note: Used existing `src/components/providers/session-provider.tsx` instead)_
  - Inside this component, import and render `SessionProvider` from `next-auth/react`, wrapping `{children}`.
  - Import and use this provider component in your root layout (`src/app/layout.tsx`) to wrap the main content (e.g., inside `<body>`). _(Note: Already correctly implemented in layout)_
  - **Verification:** The application should build and run. Open the browser dev tools; no console errors related to `SessionProvider`.

## Phase 3: Basic Authentication Flow Verification

- [x] **Implement Basic Sign-in/Sign-out UI:**

  - Modify `src/app/page.tsx`. Add `"use client"` directive at the top.
  - Import and use the `useSession`, `signIn`, `signOut` hooks from `next-auth/react`.
  - Implement a simple form for email/password input.
  - Conditionally render the "Sign In" form if `status === 'unauthenticated'`.
  - Conditionally render user info (`session.user.name` or `session.user.email`) and a "Sign Out" button if `status === 'authenticated'`.
  - **Verification:**
    1. Load the root page (`/`). Verify the sign-in form is visible.
    2. Enter valid credentials and trigger sign-in.
    3. Verify the UI updates to show your username/email and the "Sign Out" button.
    4. Check the `User` and `Session` tables in the database.
    5. Click "Sign Out". Verify the sign-in form appears again.

## Phase 4: Protected Routes & Login Page

- [x] **Define Protected Routes using Middleware:**

  - Create `middleware.ts` in the `src` directory (or root).
  - Import `withAuth` from `next-auth/middleware`.
  - Export a default middleware function using `withAuth`.
  - Configure `withAuth` with a `matcher` to protect the root route (`/`).
  - Configure the `pages` option within `withAuth` to specify the sign-in page path (e.g., `/login`).
  - **Verification:** Unauthenticated access to `/` should automatically redirect to the path specified in `pages.signIn`. The `middleware.ts` file should exist and be correctly configured.

- [ ] **Create Dedicated Login Page:**

  - Create the file `src/app/login/page.tsx`.
  - Implement a client component (`"use client"`) containing the sign-in form (similar to the one previously on the root page).
  - Use `useSession`, `signIn` from `next-auth/react`.
  - Ensure the `signIn` function handles redirection correctly after successful login (NextAuth.js typically handles the `callbackUrl` automatically when middleware is used).
  - **Verification:**
    1. Navigate to `/login` directly. The login form should be displayed.
    2. Log in using valid credentials. Verify you are redirected to the root page (`/`).
    3. Check database tables (`Session`, `User`) if needed.

- [ ] **Update Root Page (`/`):**

  - Modify `src/app/page.tsx`.
  - Remove the conditional logic based on `useSession` status (`unauthenticated`, `authenticated`). Since the route is now protected by middleware, we can assume the user is authenticated when this page renders.
  - Remove the sign-in form elements.
  - Keep the display of authenticated user information (e.g., `session.user.email`) and the "Sign Out" button.
  - **Verification:**
    1. After logging in via `/login`, navigate to `/`. Verify only the authenticated content (user info, sign-out button) is shown, and the sign-in form is gone.
    2. Click "Sign Out". Verify you are redirected back to the `/login` page.

- [ ] **Update NextAuth Configuration (Optional but Recommended):**
  - In `src/app/api/auth/[...nextauth]/route.ts`, add the `pages: { signIn: '/login' }` option to the main `authOptions`.
  - **Verification:** This ensures consistency and provides a fallback if middleware redirection fails for any reason. The sign-in process should continue to work as expected.

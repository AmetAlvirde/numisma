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

## Phase 4: tRPC Setup

- [ ] **Create tRPC Context:**

  - Create the file `src/server/api/trpc.ts`.
  - Import `initTRPC`, `FetchCreateContextFnOptions`, `prisma` instance, `getServerSession`, `authOptions`.
  - Define `createTRPCContext` using `FetchCreateContextFnOptions` to handle context creation for App Router Route Handlers (fetching session, including `prisma`).
  - Initialize tRPC (`initTRPC.context<typeof createTRPCContext>()`) with `superjson` transformer.
  - Define and export `createTRPCRouter` and `publicProcedure`.
  - **Verification:** The file exists and type-checks correctly.

- [ ] **Create Root tRPC Router:**

  - Create the file `src/server/api/root.ts`.
  - Import `createTRPCRouter`, `publicProcedure` from `trpc.ts`.
  - Define `appRouter` using `createTRPCRouter`.
  - Add a simple _public_ test procedure (e.g., `getUserCount`) using `ctx.prisma`. Export `type AppRouter`.
  - **Verification:** The file exists and type-checks. Logic in the test procedure is valid.

- [ ] **Create tRPC API Route Handler:**

  - Create the file `src/app/api/trpc/[trpc]/route.ts`.
  - Import `fetchRequestHandler` from `@trpc/server/adapters/fetch`.
  - Import `appRouter` and `createTRPCContext`.
  - Export a `handler` function that uses `fetchRequestHandler` configured with the router, context creator, and endpoint path. Use this handler for `GET`, `POST`, etc.
  - **Verification:** The file exists and type-checks correctly.

- [ ] **Create tRPC Client & Provider:**

  - Create the file `src/utils/trpc-provider.tsx`.
  - Add `"use client"` directive.
  - Import necessary modules from `@trpc/react-query`, `@tanstack/react-query`, `useState`.
  - Create and export a `TRPCReactProvider` component.
  - Inside the provider, use `useState` to create stable instances of `QueryClient` and `trpcClient` (configured with `httpBatchLink`, `superjson`, `getBaseUrl`).
  - Wrap `{children}` with `<api.Provider client={trpcClient} queryClient={queryClient}>` and `<QueryClientProvider client={queryClient}>`.
  - Create `src/utils/api.ts` to export the `createTRPCReact<AppRouter>` object (commonly named `api`). Export `RouterInputs` and `RouterOutputs`.
  - **Verification:** Files exist and type-check.

- [ ] **Wrap App with tRPC Provider:**
  - Modify the root layout (`src/app/layout.tsx`).
  - Import the `TRPCReactProvider` from `~/utils/trpc-provider`.
  - Wrap the main content (e.g., inside `<body>`, likely inside the `SessionProvider` if applicable) with `<TRPCReactProvider>`.
  - **Verification:** App builds and runs. Check browser console for tRPC/React Query errors.

## Phase 5: Basic tRPC Call Verification

- [ ] **Call Public tRPC Procedure:**
  - Modify a Client Component page (e.g., `src/app/page.tsx`). Ensure it has `"use client"`.
  - Import the `api` object from `~/utils/api`.
  - Use the hook for your public test procedure (e.g., `api.example.getUserCount.useQuery()`).
  - Display the data or loading state.
  - **Verification:** Load the page. Verify data from the tRPC procedure is displayed. Check browser network tab for successful requests to `/api/trpc/getUserCount`.

## Phase 6: Integrating Auth into tRPC

- [ ] **Update tRPC Context for Session:**

  - Ensure `createTRPCContext` in `src/server/api/trpc.ts` correctly fetches the session using `getServerSession(authOptions)` (within the App Router context, typically doesn't need explicit `req`/`res`) and includes it.
  - **Verification:** Temporarily log `ctx.session` inside a tRPC procedure. Make requests while logged out (null) and logged in (session object logged server-side). Remove the log.

- [ ] **Create Protected Procedure Helper:**

  - In `src/server/api/trpc.ts`:
    - Define `enforceUserIsAuthed` middleware using `t.middleware`. Check for `ctx.session.user` and throw `TRPCError({ code: 'UNAUTHORIZED' })` if absent.
    - Define `protectedProcedure = t.procedure.use(enforceUserIsAuthed)`.
    - Export `protectedProcedure`.
  - **Verification:** Type-checks correctly.

- [ ] **Implement Protected tRPC Procedure:**

  - Add a new procedure to `appRouter` using `protectedProcedure` (e.g., `getSecretMessage`). This procedure can access `ctx.session.user`.
  - **Verification:** Type-checks correctly.

- [ ] **Call Protected tRPC Procedure:**
  - Modify a Client Component page (e.g., `src/app/page.tsx`).
  - Call the protected procedure hook (e.g., `api.example.getSecretMessage.useQuery()`).
  - **Verification:**
    1. Load the page while logged out. Verify the request fails (check network tab for 401/Unauthorized or similar tRPC error) or the hook returns an error state. UI should ideally handle this gracefully.
    2. Log in and reload the page. Verify the request succeeds and the data from the protected procedure is displayed.

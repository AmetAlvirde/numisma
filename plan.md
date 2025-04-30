# Implementation Plan: NextAuth.js + tRPC + Prisma Integration

This plan outlines the steps to integrate authentication (NextAuth.js), a typesafe API (tRPC), and database interaction (Prisma) into the Next.js application. Each step includes verification instructions.

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

- [ ] **Create Prisma Client Singleton:**

  - Create the file `src/server/db.ts`.
  - Implement the singleton pattern to instantiate `PrismaClient`, preventing multiple instances during development.
  - **Verification:** The file `src/server/db.ts` exists and the code type-checks correctly (e.g., run `tsc --noEmit` or rely on editor feedback).

- [ ] **Generate Prisma Client:**
  - Execute `npx prisma generate`.
  - **Verification:** The command should complete successfully. The `node_modules/@prisma/client` directory should be updated, reflecting the latest schema.

## Phase 2: NextAuth.js Core Setup

- [ ] **Create NextAuth.js API Route:**

  - Create the file `src/pages/api/auth/[...nextauth].ts`.
  - Import `NextAuth`, `PrismaAdapter`, your `prisma` client instance, and at least one provider (e.g., `GithubProvider`).
  - Configure `authOptions` using the `PrismaAdapter` and provider(s).
  - Implement the `callbacks.session` function to add `user.id` to the session object.
  - **Verification:** The file exists and type-checks correctly. Ensure necessary environment variables (`GITHUB_ID`, `GITHUB_SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `DATABASE_URL`) are set in your `.env` file.

- [ ] **Add SessionProvider Wrapper:**
  - Modify `src/pages/_app.tsx`.
  - Import `SessionProvider` from `next-auth/react`.
  - Wrap the main `Component` with `<SessionProvider session={pageProps.session}>`.
  - **Verification:** The application should still build and run (`npm run dev`). Open the browser's developer tools; there should be no console errors related to the `SessionProvider`.

## Phase 3: Basic Authentication Flow Verification

- [ ] **Implement Basic Sign-in/Sign-out UI:**
  - Modify `src/pages/index.tsx`.
  - Import and use the `useSession`, `signIn`, `signOut` hooks from `next-auth/react`.
  - Conditionally render a "Sign In" button if `status === 'unauthenticated'`.
  - Conditionally render user information (`session.user.name` or `session.user.email`) and a "Sign Out" button if `status === 'authenticated'`.
  - **Verification:**
    1. Load the index page. Verify the "Sign In" button is visible.
    2. Click "Sign In" and complete the authentication flow with your chosen provider (e.g., GitHub).
    3. Verify you are redirected back to the app and now see your username/email and the "Sign Out" button.
    4. Check the `User` and `Account` tables in your database to confirm a new record was created for you.
    5. Click "Sign Out". Verify you see the "Sign In" button again.

## Phase 4: tRPC Setup

- [ ] **Create tRPC Context:**

  - Create the file `src/server/api/trpc.ts`.
  - Import `initTRPC`, `CreateNextContextOptions`, `prisma` instance, `getServerSession`, `authOptions`.
  - Define `createInnerTRPCContext` and `createTRPCContext` (initially fetch session but might not use it fully yet). Include `prisma` in the context.
  - Initialize tRPC (`initTRPC`) with `superjson` transformer.
  - Define and export `createTRPCRouter` and `publicProcedure`.
  - **Verification:** The file exists and type-checks correctly.

- [ ] **Create Root tRPC Router:**

  - Create the file `src/server/api/root.ts`.
  - Import `createTRPCRouter`, `publicProcedure` from `trpc.ts`.
  - Define `appRouter` using `createTRPCRouter`.
  - Add a simple _public_ test procedure (e.g., `getUserCount`) that uses `ctx.prisma` to query the database. Export `type AppRouter`.
  - **Verification:** The file exists and type-checks correctly. The logic in the test procedure should be valid Prisma query.

- [ ] **Create tRPC API Handler:**

  - Create the file `src/pages/api/trpc/[trpc].ts`.
  - Import `createNextApiHandler` from `@trpc/server/adapters/next`.
  - Import `appRouter` and `createTRPCContext`.
  - Export the result of `createNextApiHandler` configured with the router and context creator.
  - **Verification:** The file exists and type-checks correctly.

- [ ] **Create tRPC Client Utility:**

  - Create the file `src/utils/api.ts`.
  - Import `createTRPCNext`, `httpBatchLink`, `loggerLink`, `superjson`, `AppRouter` type.
  - Implement `getBaseUrl` function.
  - Configure and export the `api` client using `createTRPCNext`.
  - Export `RouterInputs` and `RouterOutputs` helper types.
  - **Verification:** The file exists and type-checks correctly.

- [ ] **Wrap App with tRPC:**
  - Modify `src/pages/_app.tsx`.
  - Import the `api` object from `~/utils/api`.
  - Wrap the exported `MyApp` component with `api.withTRPC`.
  - **Verification:** The application should still build and run (`npm run dev`). Check the browser console for any errors related to tRPC context or React Query.

## Phase 5: Basic tRPC Call Verification

- [ ] **Call Public tRPC Procedure:**
  - Modify `src/pages/index.tsx`.
  - Import the `api` object.
  - Use the hook for your public test procedure (e.g., `api.getUserCount.useQuery()`).
  - Display the data returned by the hook (or a loading state).
  - **Verification:** Load the index page. Verify that the data from the public tRPC procedure (e.g., the count of users from the database) is displayed correctly. Check the browser's network tab to confirm a successful request was made to `/api/trpc/getUserCount` (or your procedure name).

## Phase 6: Integrating Auth into tRPC

- [ ] **Update tRPC Context for Session:**

  - Modify `createTRPCContext` in `src/server/api/trpc.ts` to ensure it correctly fetches the session using `getServerSession(req, res, authOptions)` and includes it in the returned context object alongside `prisma`.
  - **Verification:** Add a temporary `console.log(ctx.session)` inside a tRPC procedure (like the public `getUserCount`). Make requests while logged out (session should be null) and logged in (session object should be logged on the server). Remove the `console.log` after verification.

- [ ] **Create Protected Procedure Helper:**

  - In `src/server/api/trpc.ts`:
    - Define an `enforceUserIsAuthed` middleware using `t.middleware`. This middleware should check for `ctx.session.user` and throw a `TRPCError({ code: 'UNAUTHORIZED' })` if not found. It should pass through the non-nullable `session` and `prisma` in the `next()` call context.
    - Define and export `protectedProcedure = t.procedure.use(enforceUserIsAuthed)`.
  - **Verification:** The file type-checks correctly. The middleware logic correctly identifies authenticated/unauthenticated states based on `ctx.session.user`.

- [ ] **Create a Protected Procedure:**
  - In `src/server/api/root.ts` (or a sub-router):
    - Import `protectedProcedure`.
    - Define a new procedure (e.g., `getSecretMessage`) using `protectedProcedure`.
    - Inside the procedure, access `ctx.session.user` (e.g., `ctx.session.user.id` or `ctx.session.user.name`) and potentially `ctx.prisma`.
  - **Verification:** The file type-checks correctly. The procedure correctly accesses `ctx.session.user` properties without type errors (TypeScript should infer it's non-null).

## Phase 7: Protected tRPC Call Verification

- [ ] **Call Protected tRPC Procedure:**
  - Modify `src/pages/index.tsx`.
  - Import the `api` object.
  - Use the hook for your protected procedure (e.g., `api.getSecretMessage.useQuery()`).
  - Crucially, add the option `{ enabled: !!sessionData }` (where `sessionData` comes from `useSession`) to the `useQuery` hook.
  - Display the data, loading state, or an indication that the user needs to log in.
  - **Verification:**
    1. **Logged Out:** Load the index page. Verify the protected query does _not_ run (check the network tab for requests to `/api/trpc/getSecretMessage`). No secret message should be displayed.
    2. **Logged In:** Sign in. Verify the protected query _does_ run (check network tab). Verify the secret message, potentially including user-specific data fetched using `ctx.session.user`, is displayed correctly. Check the browser console for errors.

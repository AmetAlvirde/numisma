# Plan: Implement tRPC for User Listing

This plan outlines the steps to integrate tRPC into the Next.js application to fetch and display a list of users from the database on a protected page using the App Router. Authentication via tRPC is deferred.

- [x] ## Step 1: Install tRPC Dependencies

**Goal:** Add the necessary tRPC packages to the project.

**Tasks:**

- Install `@trpc/server`, `@trpc/client`, `@trpc/react-query`, `@trpc/next`, `react-query`, `superjson`, and `zod`.

**Verify:**

- Check `package.json` to confirm the dependencies have been added.
- Run the package manager's install command (e.g., `npm install` or `yarn`) without errors.

- [x] ## Step 2: Set Up tRPC Server (App Router)

**Goal:** Create the basic tRPC server infrastructure compatible with Next.js App Router.

**Tasks:**

- Create a tRPC router (`src/server/trpc/router.ts`).
- Define a context creation function (`src/server/trpc/context.ts`) - initially can be simple, will add Prisma later.
- Create the App Router API route handler (`src/app/api/trpc/[trpc]/route.ts`) to expose the tRPC router using `fetchRequestHandler`.
- Add a simple test procedure (e.g., `hello`) to the router.

**Verify:**

- Start the development server (`npm run dev` or `yarn dev`).
- Use `curl` or a similar tool to send a POST request to the test procedure endpoint (e.g., `curl -X POST http://localhost:3000/api/trpc/hello -H "Content-Type: application/json" -d '{"name":"World"}'`). Check for a successful JSON response (e.g., `{"result":{"data":{"greeting":"Hello World"}}}`). _Note the POST method and endpoint structure difference from Pages Router._

- [x] ## Step 3: Integrate Prisma with tRPC Context

**Goal:** Make the Prisma client available within tRPC procedures.

**Tasks:**

- Import and initialize the Prisma client (`src/lib/prisma.ts` or wherever it resides).
- Modify the tRPC context creation function (`src/server/trpc/context.ts`) to include the Prisma client instance in the returned context object.

**Verify:**

- Create a new test procedure that accesses `ctx.prisma`. For example, a procedure that counts users (`prisma.user.count()`).
- Test this new procedure endpoint similarly to Step 2 (using POST). Verify it returns a valid count (e.g., `{"result":{"data":0}}` if no users exist) without errors.

## Step 4: Create User Listing Procedure

**Goal:** Implement the specific tRPC procedure to fetch users.

**Tasks:**

- Create a user router (`src/server/trpc/routers/user.ts`) or add directly to the main router.
- Define a `list` procedure within the user router that uses `ctx.prisma.user.findMany()` to fetch users.
- Select only necessary fields (id, name, email, etc.) to avoid over-fetching.
- Merge the user router into the main `appRouter`.

**Verify:**

- Add some test users to the database manually if none exist.
- Test the `user.list` procedure endpoint (e.g., `curl -X POST http://localhost:3000/api/trpc/user.list -H "Content-Type: application/json"`). Verify it returns an array of user objects with the selected fields.

## Step 5: Set Up tRPC Client (App Router)

**Goal:** Configure the tRPC client for use in the frontend React Server and Client Components.

**Tasks:**

- Create a utility file (`src/lib/trpc/client.ts`) to initialize the tRPC client (`createTRPCProxyClient`) for Server Components.
- Create a separate utility file (`src/lib/trpc/react.ts`) for the React Query integration (`createTRPCReact`) needed for Client Components.
- Configure `superjson` for data transformation in both client setups.
- Create a `TrpcProvider` component (`src/lib/trpc/Provider.tsx`) that sets up `QueryClient` and wraps children with `QueryClientProvider` and the tRPC Provider.
- Use the `TrpcProvider` in the root layout (`src/app/layout.tsx`).

**Verify:**

- Run the application (`npm run dev` or `yarn dev`).
- Check the browser's developer console for any errors related to tRPC client setup.
- Ensure the application still renders correctly without runtime errors.

## Step 6: Implement User List Component on Protected Page

**Goal:** Fetch and display the user list in a React component using the tRPC client hook.

**Tasks:**

- Create a new React **Client Component** (e.g., `src/components/UserList.tsx` with `"use client"` directive).
- Inside the component, import the React Query client (`@/lib/trpc/react.ts`) and use the `trpc.user.list.useQuery()` hook to fetch data.
- Render the user data (e.g., in a list or table).
- Handle loading and error states returned by the hook.
- Add this `UserList` component to the desired protected page (e.g., the root page after login). Assume page-level protection is already handled by other means (e.g., NextAuth middleware).

**Verify:**

- Navigate to the protected page in the browser.
- Observe that the component initially shows a loading state.
- Verify that the list of users (fetched from the database via tRPC) is displayed correctly.
- Check the browser's network tab to confirm a POST request is made to the `/api/trpc/user.list` endpoint and receives the expected data.
- Test the error state (e.g., by temporarily breaking the API route or database connection) and verify the component displays an appropriate error message.

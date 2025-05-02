import { withAuth } from "next-auth/middleware";

export default withAuth(
  // `withAuth` augments your `Request` with the user's token.
  function middleware(req) {
    // console.log(req.nextauth.token); // Uncomment to see token
  },
  {
    callbacks: {
      // If `authorized` returns `true`, the middleware function above is executed.
      // If `authorized` returns `false`, the user is redirected to the `signIn` page defined in `pages`.
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: "/login",
      // error: "/auth/error", // Optional: define an error page
    },
  }
);

// Define which routes are protected by this middleware
export const config = {
  matcher: ["/"],
};

import type { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/db/prisma-client"; // Assuming this is the correct path to your prisma client instance

// Ensure you have bcryptjs installed: npm install bcryptjs @types/bcryptjs
// Also ensure you have NEXTAUTH_SECRET in your .env file

export const authOptions: NextAuthOptions = {
  // Use Prisma Adapter
  adapter: PrismaAdapter(prisma),
  // Configure one or more authentication providers
  providers: [
    CredentialsProvider({
      // The name to display on the sign in form (e.g. "Sign in with...")
      name: "Credentials",
      // `credentials` is used to generate a form on the sign in page.
      credentials: {
        email: {
          label: "Email",
          type: "email",
          placeholder: "jsmith@example.com",
        },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        console.log("Attempting authorization for:", credentials?.email);

        if (!credentials?.email || !credentials?.password) {
          console.error("Missing credentials");
          throw new Error("Please provide email and password."); // Throw error for feedback
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        // Add check for user existence and password hash
        if (!user || !user.password) {
          console.log(
            "User not found or password not set for:",
            credentials.email
          );
          throw new Error("Invalid credentials."); // User not found or no password setup
        }

        // Compare the provided password with the stored hash
        const isValid = await bcrypt.compare(
          credentials.password,
          user.password
        );

        if (isValid) {
          console.log("Password match for:", user.email);
          // Return the user object, excluding the password hash
          // IMPORTANT: Never return the password hash in the user object
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            // Add any other user properties needed, but NOT the password
          };
        } else {
          console.log("Password mismatch for:", user.email);
          throw new Error("Invalid credentials."); // Password mismatch
        }
      },
    }),
    // ...add more providers here if needed (e.g., Google, GitHub)
  ],
  // Use database sessions
  session: {
    strategy: "jwt", // Explicitly set JWT strategy as required for Credentials Provider with Adapter
    // You might want to configure maxAge and updateAge for sessions
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // 24 hours
  },
  callbacks: {
    // Restore callbacks needed for JWT strategy
    // JWT callback is used to persist user ID into the token/session cookie
    // even when using database strategy, it can simplify session callback
    async jwt({ token, user }) {
      // The 'user' object is available on initial sign-in
      if (user) {
        token.id = user.id;
        // Add other properties from `user` to `token` if needed later in session callback
        // token.role = user.role; // Example
      }
      return token;
    },
    async session({ session, token }) {
      // The 'token' contains the data we put in the jwt callback (or defaults)
      // Assign the user ID from the token to the session
      if (session.user && token.id) {
        session.user.id = token.id as string; // Cast because token properties can be string | undefined
        // Assign other properties from token if needed
        // session.user.role = token.role; // Example
      }
      return session;
    },
  },
  // Specify pages if you have custom sign-in, sign-out, error pages
  pages: {
    signIn: "/login",
    // signOut: '/auth/signout', // Example
    // error: '/auth/error', // Example
    // verifyRequest: '/auth/verify-request', // Example
    // newUser: '/auth/new-user' // Example
  },
  // Secret for signing strategies (like JWT) - REQUIRED
  secret: process.env.NEXTAUTH_SECRET,
  // Enable debug messages in development for troubleshooting
  debug: process.env.NODE_ENV === "development",
};

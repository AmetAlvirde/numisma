import NextAuth, { type NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/db/prisma-client"; // Adjust path if necessary

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      // The name to display on the sign in form (e.g. "Sign in with...")
      name: "Credentials",
      // `credentials` is used to generate a form on the sign in page.
      // You can specify which fields should be submitted, by adding keys to the `credentials` object.
      // e.g. domain, username, password, 2FA token, etc.
      // You can pass any HTML attribute to the <input> tag through the object.
      credentials: {
        email: {
          label: "Email",
          type: "email",
          placeholder: "jsmith@example.com",
        },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        console.log("req", req);
        // Add logic here to look up the user from the credentials supplied
        // IMPORTANT: This is a placeholder. Implement proper validation!
        console.log("Attempting authorization for:", credentials?.email);

        if (!credentials?.email || !credentials?.password) {
          console.error("Missing credentials");
          return null;
        }

        // Example: Find user in database
        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (user) {
          // VERY IMPORTANT: Add password hashing and comparison here!
          // For now, just returning the user if found (INSECURE for demo)
          console.log("User found:", user.email);
          // Any object returned will be saved in `user` property of the JWT
          return user;
        } else {
          // If you return null then an error will be displayed advising the user to check their details.
          console.log("User not found:", credentials.email);
          return null;

          // You can also Reject this callback with an Error thus the user will be sent to the error page with the error message as a query parameter
        }
      },
    }),
  ],
  session: {
    strategy: "jwt", // Using JWT for session strategy with CredentialsProvider
  },
  callbacks: {
    async jwt({ token, user }) {
      // Add user id to the JWT token right after sign in
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      // Add user id to the session object
      if (session.user && token.id) {
        // Need type assertion here as NextAuth types might not include id by default
        (session.user as { id: string }).id = token.id as string;
      }
      return session;
    },
  },
  // Add secret and potentially other configurations like pages
  secret: process.env.NEXTAUTH_SECRET,
  // debug: process.env.NODE_ENV === 'development', // Optional: Enable debug messages in development
};

export default NextAuth(authOptions);

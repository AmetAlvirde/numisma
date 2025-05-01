/**
 * Although generally is not recommended to use a .d.ts file to extend
 * types, next-auth docs recommend it explicitly for this case:
 *
 * https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
import { type DefaultSession } from "next-auth";

declare module "next-auth" {
  /**
   * Returned by `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
   */
  interface Session {
    user: {
      id: string; // Add your custom property 'id' here
      // You can add other custom properties like 'role' here as well
      // role: string;
    } & DefaultSession["user"]; // Keep the default properties
  }

  // If you also want to add properties to the User object returned by the adapter/authorize function
  // interface User extends DefaultUser {
  //   // Add custom properties for the User object if needed
  //   // role: string;
  // }
}

// If you are using JWTs and want to add properties to the token
// declare module "next-auth/jwt" {
//   /** Returned by the `jwt` callback and `getToken`, when using JWT sessions */
//   interface JWT {
//     /** OpenID ID Token */
//     id?: string; // Add your custom property 'id' here
//     // role?: string;
//   }
// }

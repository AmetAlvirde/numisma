// import { Navbar } from "@/components/auth/authenticated-navbar/authenticated-navbar";

interface AuthenticatedLayoutProps {
  children: React.ReactNode;
}

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  return (
    <>
      {/* <Navbar /> */}
      {children}
    </>
  );
}

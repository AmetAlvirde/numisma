// import { Navbar } from "@/components/auth/authenticated-navbar/authenticated-navbar";
import { PortfolioProvider } from "@/components/providers/portfolio-provider";

interface AuthenticatedLayoutProps {
  children: React.ReactNode;
}

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  return (
    <PortfolioProvider>
      {/* <Navbar /> */}
      {children}
    </PortfolioProvider>
  );
}

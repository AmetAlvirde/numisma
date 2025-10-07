import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Session } from "next-auth";

export function AccountHeader({ session }: { session: Session }) {
  return (
    <div>
      <section className="flex" id="account-header">
        <div className="flex-grow">
          <h2 className="text-2xl font-semibold">Accumulus</h2>
          <p className="text-md text-muted-foreground">
            Welcome back, <span className="font-bold">Amet!</span>
          </p>
          <p className="text-sm text-muted-foreground font-mono">25W40X</p>
        </div>
        <Avatar className="h-16 w-16 m-2">
          <AvatarImage
            src={session.user?.image || ""}
            alt={session.user?.name || "User"}
          />
          <AvatarFallback>
            {session.user?.name?.charAt(0).toUpperCase() || "U"}
          </AvatarFallback>
        </Avatar>
      </section>
    </div>
  );
}

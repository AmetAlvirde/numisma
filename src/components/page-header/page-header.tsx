import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Session } from "next-auth";

interface PageHeaderProps {
  currentPeriod: string;
  title: string;
  session: Session;
}

export function PageHeader({ currentPeriod, title, session }: PageHeaderProps) {
  return (
    <div className="w-full max-w-6xl flex items-start justify-between">
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">
          {currentPeriod}
        </div>
        <h1 className="text-3xl font-bold mb-2">{title}</h1>
      </div>

      <Avatar className="h-12 w-12">
        <AvatarImage
          src={session.user?.image || ""}
          alt={session.user?.name || "User"}
        />
        <AvatarFallback>
          {session.user?.name?.charAt(0).toUpperCase() || "U"}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}

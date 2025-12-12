import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Session } from "next-auth";
import { getCurrentPeriod } from "@/utils/period-utils";

interface HomeHeaderProps {
  title: string;
  session: Session;
}

export function HomeHeader({ title, session }: HomeHeaderProps) {
  return (
    <div className="w-full max-w-6xl flex items-start justify-between">
      <div>
        <h1 className="text-3xl font-bold mb-2">{title}</h1>
        <div className="text-xs font-medium text-muted-foreground mb-2">
          {getCurrentPeriod()}
        </div>
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

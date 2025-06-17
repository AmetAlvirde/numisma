import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Session } from "next-auth";

interface HomeHeaderProps {
  title: string;
  session: Session;
}

export function HomeHeader({ title, session }: HomeHeaderProps) {
  return (
    <div className="w-full max-w-6xl flex items-start justify-between">
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">
          {getCurrentPeriod()}
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

function getCurrentPeriod() {
  const now = new Date();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);

  // Calculate week number
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const pastDaysOfYear = (now.getTime() - startOfYear.getTime()) / 86400000;
  const week = Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);

  return `Q${quarter}/W${week}`;
}

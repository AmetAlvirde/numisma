"use client";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PositionSetupDiagram } from "@/components/home/position-setup-diagram/position-setup-diagram";
import { cn } from "@/utils/cn";

interface ActionItemProps {
  variant?: string;
  type?: string;
  data?: string;
}

function ActionItemLayoutCtaMain() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Action Card</CardTitle>
      </CardHeader>
      <CardFooter>
        <CardDescription>Action Card</CardDescription>
      </CardFooter>
      <CardContent>
        <CardDescription>Action Card</CardDescription>
      </CardContent>
      <CardFooter>
        <CardDescription>Action Card</CardDescription>
      </CardFooter>
    </Card>
  );
}

function ActionItemLayoutStatsCondensed({
  className,
  ...props
}: {
  className?: string;
}) {
  return (
    <Card
      className={cn("h-90 w-80 py-0 overflow-hidden max-w-md", className)}
      // className="h-90 w-80 py-0 overflow-hidden max-w-md"
      {...props}
    >
      <CardHeader className="">
        <CardTitle className="text-slate-200 text-2xl font-bold mt-6 mb-1">
          10X Bitcoin long @ 111k
        </CardTitle>
        <CardTitle className="text-slate-300 text-xl font-mono">
          0.009 BTC @ 111K on BingX
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        <CardDescription className="text-slate-200">
          4% (+4 USDT) since 10/06
          <PositionSetupDiagram value={40} />
        </CardDescription>
      </CardContent>
      <CardFooter className="bg-slate-200 px-6 py-4 mt-auto rounded-b-md">
        <CardDescription className="text-lg text-bloomberg-blue font-bold uppercase">
          Foresight Tempo
        </CardDescription>
      </CardFooter>
    </Card>
  );
}

function ActionItemLayoutStatsDetailed() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Action Card</CardTitle>
      </CardHeader>
      <CardFooter>
        <CardDescription>Action Card</CardDescription>
      </CardFooter>
      <CardContent>
        <CardDescription>Action Card</CardDescription>
      </CardContent>
      <CardFooter>
        <CardDescription>Action Card</CardDescription>
      </CardFooter>
    </Card>
  );
}

export function ActionItem({ variant }: ActionItemProps) {
  const backgrounds = [
    "bg-bloomberg-teal",
    "bg-bloomberg-blue",
    "bg-bloomberg-orange",
    "bg-bloomberg-gold",
  ];

  const randomBackground = backgrounds[1];

  if (variant === "cta-main") return <ActionItemLayoutCtaMain />;
  if (variant === "stats-condensed")
    return <ActionItemLayoutStatsCondensed className={randomBackground} />;
  if (variant === "stats-detailed") return <ActionItemLayoutStatsDetailed />;

  return (
    <div>
      <code className="bg-yellow-200">ActionItem</code>
      <p className="font-mono">
        You need to select a layout. Your options are cta-main, stats-condensed,
        stats-detailed
      </p>
    </div>
  );
}

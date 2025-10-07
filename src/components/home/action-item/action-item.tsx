import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
interface ActionItemProps {
  layout?: string;
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

function ActionItemLayoutStatsCondensed() {
  return (
    <Card className="bg-bloomberg-blue h-64 py-0 overflow-hidden max-w-md">
      <CardHeader className="bg-bloomberg-blue">
        <CardTitle className="text-slate-200 text-2xl font-bold mt-6 mb-1">
          Bitcoin long @ 111k
        </CardTitle>
        <CardTitle className="text-slate-300 text-xl font-mono">
          0.009 BTC @ 111K on BingX
        </CardTitle>
      </CardHeader>
      <CardContent className="bg-bloomberg-blue flex-1">
        <CardDescription>Action Card</CardDescription>
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

export function ActionItem({ layout, type, data }: ActionItemProps) {
  if (layout === "cta-main") return <ActionItemLayoutCtaMain />;
  if (layout === "stats-condensed") return <ActionItemLayoutStatsCondensed />;
  if (layout === "stats-detailed") return <ActionItemLayoutStatsDetailed />;

  return (
    <div>
      <code className="bg-yellow-200">&lt;ActionItem /&gt;</code>
      <p className="font-mono">
        You need to select a layout. Your options are 'cta-main',
        'stats-condensed', 'stats-detailed'
      </p>
    </div>
  );
}

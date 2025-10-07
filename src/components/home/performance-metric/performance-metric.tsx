interface PerformanceMetricProps {
  value: string;
  lastCloseTimeFrame: string;
}

export function PerformanceMetric({
  lastCloseTimeFrame,
  value,
}: PerformanceMetricProps) {
  return (
    <div className="performance-metric">
      <h1 className="text-6xl font-semibold text-center">{value}</h1>
      <p className="text-md mt-1 text-muted-foreground text-center">
        Last {lastCloseTimeFrame} close
      </p>
    </div>
  );
}

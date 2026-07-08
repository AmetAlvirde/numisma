import { createFileRoute } from "@tanstack/react-router";
import type { CompositionReport } from "@numisma/engine";
import { getDashboard } from "../lib/dashboard.ts";
import { SummaryCard } from "../components/SummaryCard.tsx";
import { SectionTable } from "../components/SectionTable.tsx";

/**
 * Dashboard route. The loader calls the session-gated server function, which
 * redirects unauthenticated users to /login before any data is read.
 */
export const Route = createFileRoute("/")({
  component: DashboardPage,
  loader: () => getDashboard(),
});

function DashboardPage() {
  const result = Route.useLoaderData();

  if (result.status === "empty") {
    return (
      <Shell>
        <div className="card notice">
          <h1>No snapshot yet</h1>
          <p>
            The projection is empty. Run <code>pnpm push</code> to publish the
            latest composition report.
          </p>
        </div>
      </Shell>
    );
  }

  if (result.status === "stale") {
    return (
      <Shell>
        <div className="card notice error">
          <h1>Schema version mismatch — refusing to render</h1>
          <p>
            The stored snapshot is schema version{" "}
            <strong>{result.storedVersion}</strong> but this app expects version{" "}
            <strong>{result.expectedVersion}</strong>. Re-run the push shell with
            a matching engine build before viewing.
          </p>
        </div>
      </Shell>
    );
  }

  return <DashboardView report={result.report} />;
}

function DashboardView({ report }: { report: CompositionReport }) {
  return (
    <Shell>
      <SummaryCard
        summary={report.dashboard.summary}
        usdMxn={report.totals.usdMxn}
      />
      {report.dashboard.sections.map((section) => (
        <SectionTable key={section.id} section={section} />
      ))}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="dashboard">{children}</main>;
}

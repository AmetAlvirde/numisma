import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { CompositionRow, DashboardSection } from "@numisma/engine";
import { formatUsd, formatPercent } from "@numisma/engine/format";

const column = createColumnHelper<CompositionRow>();

// Read-only: core row model only — no sorting/filtering/pagination models wired.
const columns = [
  column.accessor("label", {
    header: "Label",
    cell: (info) => info.getValue(),
  }),
  column.accessor("usdValue", {
    header: "USD value",
    cell: (info) => formatUsd(info.getValue()),
  }),
  column.accessor("percentOfFund", {
    header: "% of fund",
    cell: (info) => formatPercent(info.getValue()),
  }),
];

export function SectionTable({ section }: { section: DashboardSection }) {
  const table = useReactTable({
    data: section.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <section className="card">
      <h2>{section.title}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    className={header.column.id === "label" ? "" : "num"}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cell.column.id === "label" ? "" : "num"}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

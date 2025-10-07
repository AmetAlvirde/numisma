export function ScrollableRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex gap-4 overflow-x-auto scroll-snap-x scroll-snap-mandatory -mx-6 px-6"
      style={{
        WebkitOverflowScrolling: "touch",
      }}
    >
      {children}
    </div>
  );
}

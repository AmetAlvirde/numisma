import { ScrollableRow } from "@/components/scrollable-row/scrollable-row";
import { ActionItem } from "@/components/home/action-item/action-item";

export function HomeSection({ ...props }: { title: string }) {
  const { title } = props;
  return (
    <>
      <h2 className="text-2xl font-semibold">{title}</h2>
      <section className="my-6">
        <ScrollableRow>
          <div className="flex-shrink-0 w-80 scroll-snap-align-start">
            <ActionItem
              variant="stats-condensed"
              type="tempo|active-trade|closed-trade|paper-trade|journal-entry|journal-prompt"
              data=""
            />
          </div>
          <div className="flex-shrink-0 w-80 scroll-snap-align-start">
            <ActionItem
              variant="stats-condensed"
              type="tempo|active-trade|closed-trade|paper-trade|journal-entry|journal-prompt"
              data=""
            />
          </div>
        </ScrollableRow>
      </section>
    </>
  );
}

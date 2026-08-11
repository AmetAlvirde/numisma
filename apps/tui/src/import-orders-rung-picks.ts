/**
 * THE SECOND DECLARED HALF, PROMPTED (#286) — which ladder rung each imported order was
 * placed for, PROPOSED by price match and RATIFIED by the operator.
 *
 * IT FOLLOWS `declareFunding`'S SHAPE DELIBERATELY: propose for the whole batch, accept
 * it with one Enter, then offer a per-order override. A ladder's rungs are the one thing
 * a batch does NOT share, so the per-order pass matters more here than it does for the
 * funding reserve — but the common case is still an export of the rungs the ladder
 * declares, and that case costs one keystroke.
 *
 * IT TAKES THE PROMPT CHANNEL, NOT THE IO BAG, for the reason `declareFunding`'s header
 * records: taking the whole bag would need the type imported BACK from the module this
 * lives beside, and "reads nothing but the prompt channel" could then only be held at
 * runtime. Narrowed to `ask`, the compiler holds it.
 *
 * **THE OPERATOR NEVER READS OR TYPES A `planId`.** Every ladder and rung is presented by
 * its meaningful content — position, effective date, rung price and size — and the id is
 * CARRIED THROUGH from the loaded plan onto the record. A prompt that asked for the id
 * would make the UUID an operator-facing string, which is exactly what it is not; a
 * prompt that merely PRINTED it would train the operator to read one, which is the same
 * mistake one step removed.
 *
 * A DECLINED PICK IS A FIRST-CLASS ANSWER. `0` writes neither field, the order joins by
 * price match forever, and that is the legacy path rather than an error.
 *
 * `describeOrder` and `isAffirmative` ARE DUPLICATED FROM `import-orders-funding-
 * declaration.ts` AND STAY THAT WAY, on that module's own argument: de-duplicating them
 * means choosing a shared home for a TUI-wide prompt primitive — a decision, not a move —
 * so neither leaf imports the other.
 */
import {
  matchRungsByPrice,
  type BitgetOpenOrder,
  type InForceLadder,
  type RungPick,
} from "@numisma/engine";

/** How one rung is shown when the operator is asked about it. */
function describeOrder(order: BitgetOpenOrder): string {
  return `${order.symbol} ${order.side} ${order.quantity} @ ${order.price} (${order.observedAt})`;
}

function isAffirmative(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

/** ONE offered rung: what the operator reads, and the pick it stands for. */
interface RungChoice {
  label: string;
  pick: RungPick;
}

/**
 * Every rung of every in-force ladder, flattened into the order they are offered in.
 *
 * The LABEL is the whole point: position, effective date, price and size — the four facts
 * that let an operator recognize a rung they authored. No id of any kind appears in it.
 */
function offerRungs(ladders: readonly InForceLadder[]): RungChoice[] {
  return ladders.flatMap((ladder) =>
    ladder.rungs.map((rung) => ({
      label:
        `${ladder.positionId} ${ladder.effectiveAt} · rung at ${rung.priceUsd} ` +
        `(size ${rung.sizeUsd})`,
      pick: { planId: ladder.planId, rungId: rung.id },
    })),
  );
}

function labelOf(choices: readonly RungChoice[], pick: RungPick): string | undefined {
  return choices.find(
    (choice) => choice.pick.planId === pick.planId && choice.pick.rungId === pick.rungId,
  )?.label;
}

/**
 * Prompt for the declared rung join, one batch at a time.
 *
 * Returns the ratified picks keyed by the synthesized order id — the shape
 * `OrderAttribution.rungPicks` takes, so the pick reaches the record builder through the
 * value the import already threads rather than through a second path.
 *
 * NOTHING IS ASKED WHEN NO LADDER IS IN FORCE. There is no proposal to ratify and no
 * choice to offer, so a prompt would be a question with no answer — and the honest empty
 * answer would then be indistinguishable from a deliberate decline.
 *
 * `declaredOnFile` SUPPRESSES A PROPOSAL, NEVER A PICK. A rung already declared by a line
 * on disk is not one this pass may infer a second join for — but the OVERRIDE menu still
 * offers it, because re-placing a rung whose earlier order was cancelled is ordinary and
 * an append-only claim would otherwise lock that rung out forever. A proposal is an
 * inference; a pick is something the operator said, and only the inference is blocked.
 */
export async function declareRungPicks(
  ask: (question: string) => Promise<string>,
  orders: readonly BitgetOpenOrder[],
  ladders: readonly InForceLadder[],
  declaredOnFile: readonly RungPick[] = [],
): Promise<Record<string, RungPick>> {
  const choices = offerRungs(ladders);
  if (choices.length === 0) {
    return {};
  }

  // ONE RUNG STANDS FOR ONE ORDER, ACROSS THE BATCH **AND** ACROSS IMPORTS. Without this
  // set the same rung is proposed to every order sharing its price, one Enter writes the
  // same declared join onto several durable lines, and every line after the first joins
  // to nothing — an operator-ratified field on an append-only file, silently inert.
  const key = (pick: RungPick) => JSON.stringify([pick.planId, pick.rungId]);
  const spokenFor = new Map<string, string>(
    declaredOnFile.map((pick) => [key(pick), "already declared by an order on file"]),
  );

  const proposals = new Map<string, RungPick>();
  /** Why an order has no proposal — the three silences, told apart. */
  const silences = new Map<string, string>();
  for (const order of orders) {
    const matches = matchRungsByPrice(ladders, order.price);
    if (matches.length === 0) {
      silences.set(order.id, "no rung declared at this price");
      continue;
    }
    if (matches.length > 1) {
      // THE AMBIGUITY IS NAMED, not rendered as absence. This is the case where the
      // operator most needs to override, and the old copy told them there was nothing to.
      silences.set(
        order.id,
        `${matches.length} ladders declare a rung at this price — decline the batch to pick one`,
      );
      continue;
    }
    const proposed = matches[0]!;
    const taken = spokenFor.get(key(proposed));
    if (taken !== undefined) {
      silences.set(order.id, `that rung is ${taken}`);
      continue;
    }
    spokenFor.set(key(proposed), "already proposed to another order in this batch");
    proposals.set(order.id, proposed);
  }

  // THE BATCH QUESTION SHOWS ITS OWN WORK. An operator ratifying a proposal they cannot
  // see is not ratifying anything, and this prompt is the only place the price match is
  // visible before it becomes a durable line.
  const summary = orders
    .map((order) => {
      const proposed = proposals.get(order.id);
      const rendered =
        proposed === undefined
          ? (silences.get(order.id) ?? "no rung declared at this price")
          : (labelOf(choices, proposed) ?? "no rung declared at this price");
      return `  ${describeOrder(order)}\n    → ${rendered}`;
    })
    .join("\n");
  const accepted = await ask(`Rung picks proposed by price:\n${summary}\nAccept all? [Y/n] `);
  // A BLANK LINE IS ACCEPTANCE — the `[Y/n]` default, and the reason the happy path is one
  // Enter. It is NOT the refusal a blank funding answer is: there, a blank means the
  // operator declared no reserve and nothing may be written; here, every proposal is
  // already on screen and the question is only whether to keep them.
  const answer = accepted.trim();
  if (answer === "" || isAffirmative(answer)) {
    return Object.fromEntries(proposals);
  }

  const menu = choices.map((choice, index) => `    ${index + 1}) ${choice.label}`).join("\n");
  const picks: Record<string, RungPick> = {};
  for (const order of orders) {
    const proposed = proposals.get(order.id);
    const defaultIndex =
      proposed === undefined
        ? undefined
        : choices.findIndex(
            (choice) =>
              choice.pick.planId === proposed.planId && choice.pick.rungId === proposed.rungId,
          ) + 1;
    const hint = defaultIndex === undefined ? "none" : String(defaultIndex);
    const question =
      `  ${describeOrder(order)}\n${menu}\n    0) none\n  pick [${hint}]: `;
    // RE-ASKED UNTIL IT IS A CHOICE, never guessed. An unreadable answer resolved to the
    // default would write a durable join into an append-only file that nobody declared,
    // and the operator would have no way to know which reading was taken.
    for (;;) {
      const reply = (await ask(question)).trim();
      if (reply === "") {
        if (proposed !== undefined) {
          picks[order.id] = proposed;
        }
        break;
      }
      if (reply === "0") {
        break;
      }
      const chosen = choices[Number(reply) - 1];
      if (/^\d+$/.test(reply) && chosen !== undefined) {
        picks[order.id] = chosen.pick;
        break;
      }
    }
  }
  return picks;
}

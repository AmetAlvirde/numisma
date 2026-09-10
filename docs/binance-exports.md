# The Binance spot exports: two shapes, and what each one is authoritative for

Binance's spot UI exports **two different CSVs**, and a venue ingest needs both.
Neither is parsed yet: this page is the observed shape, written down so the
parser that eventually gets specced is written against a header someone actually
read rather than a guessed one. It is the Binance counterpart to the shape prose
carried in `packages/engine/src/orders/bitget.ts`.

Per the `<exchange>` placeholder convention in
[`local-data.md`](./local-data.md), this doc's **filename and the code
identifiers it names keep the literal venue name**; the substitution applies to
prose elsewhere. Every value shown below is **synthesized**. No figure on this
page came off a real export.

## Provenance, and what is therefore unknown

Both headers were read first-hand from real exports. Each carried exactly **one
row**: a single fully-filled `SELL`, one fill, fee paid in the quote currency.

So the headers are known and the row grammar is known for that one case. These
are **not** observed and must not be assumed:

- a `BUY` row, on either export;
- a partially filled or cancelled order, and the `Status` words they print;
- an order that filled across several trades (does `spot-orders.csv` print one
  row with an averaged price, and `spot-trades.csv` several? Almost certainly,
  but "almost certainly" is how the wrong parser gets written);
- a fee paid in BNB rather than the quote currency;
- any pair whose quote is not USDT.

## `spot-trades.csv`: the fills, and the only place fees exist

```
Time,Pair,Side,Price,Executed,Amount,Fee
```

Seven columns, one row per **fill**. Synthesized row:

```
2026-01-02 10:00:00,ASSETUSDT,SELL,100,2.0000ASSET,200USDT,0.2USDT
```

This is the **money-authoritative** export. It is the only one carrying `Fee`,
and therefore the only one that can produce the net cash a settlement leg needs.

`Amount` is **gross**. Net proceeds are `Amount - Fee` **only when both carry the
same unit**, which is exactly why the unit suffix below is load-bearing: a fee
paid in BNB prints `…BNB` and subtracting it from a USDT amount would be a
category error that still typechecks.

## `spot-orders.csv`: the order, and its terminal state

```
Time,OrderNo,Pair,Type¹,Side,Order Price,Order Amount,Time,Executed²,Average Price,Trading total³,Status
```

Twelve columns, one row per **order**. Synthesized row:

```
2026-01-01 09:00:00,10000000001,ASSETUSDT,Limit,SELL,100,2.0000ASSET,2026-01-02 10:00:00,2.0000ASSET,100,200USDT,FILLED
```

This is order **history**, not an open-order book. `Status: FILLED` is a settled
fact about a transaction that already happened, not a claim on capital.

## The five differences a parser has to survive

Each of these is a place the Bitget reader's approach does not transfer.

**1. There is a real order id.** `OrderNo` is venue-assigned. Bitget's export is
a rendered table with no id at all, which is why `synthesizeOrderId` exists and
mints identity from `(venue, symbol, side, price, observedAt)`. Nothing here
needs synthesizing, and synthesizing anyway would throw away the one identifier
that survives a restyle of the table.

**2. Two columns are both named `Time`.** The first is placement, the eighth is
last update, which for a filled order is the fill. A name-to-index map collapses
them silently and keeps the wrong one. Read this header **positionally**.

**3. Three headers carry footnote superscripts.** `Type¹`, `Executed²`,
`Trading total³`. These are literal Unicode characters in the header text, not
rendering. An exact-match header guard (the Bitget reader refuses a whole file on
a header mismatch, and it is right to) must either match the superscripts
byte-for-byte or strip them first. Decide which deliberately, because a venue
that quietly renumbers its own footnotes would otherwise refuse every future
export.

**4. Quantities embed their unit.** `2.0000ASSET`, `200USDT`, `0.2USDT`. Bitget
wrote bare decimals. `Number("2.0000ASSET")` is `NaN`, so every numeric read
needs the suffix split off first, and on `Fee` the suffix is not noise to
discard: it is the currency, and it decides whether the fee is subtractable at
all. Note the asymmetry: `Price`, `Order Price` and `Average Price` appear to be
bare, while the quantity and total columns are suffixed.

**5. The admission gate does not apply.** The Bitget reader's central rule is
that a row rests for its **remainder**, computed from
`quantity - filled_quantity` before any status word is consulted, because that
export is a live book where a stale row costs real money. These exports are
historical. There is no resting claim to weigh and no `#173`-shaped gate to
port. What replaces it is a different question entirely: which rows are new
since the last import.

## What a real ingest would need from both

An order tells you the intent and the venue's identity for it. A trade tells you
what the fill cost. A settlement leg needs cash **net of fees**, so:

- `spot-orders.csv` alone **cannot** produce a settlement. It has no fee column,
  and its `Trading total` is gross.
- `spot-trades.csv` alone can produce the cash, but carries no `OrderNo`, so it
  cannot be joined back to an order or deduped against one.

They join on `(Time, Pair, Side)`, which is sufficient for the single-fill case
observed and is **not** obviously sufficient for a multi-fill order. That join is
the first thing to pin down when this gets specced.

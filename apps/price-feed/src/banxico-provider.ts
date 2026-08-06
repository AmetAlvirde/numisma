/**
 * The Banxico SIE provider for the USD/MXN FIX (series `SF43718`, free token). It
 * performs network IO only — no domain decisions: it fetches the latest published
 * FIX and parses it into a pure {@link FixObservation} (rate + date) that the
 * engine validates for freshness and multiplies into the `*-mxn` derivation. The
 * FIX is NOT an instrument and is NOT written to the price store; it rides on the
 * derived mark as the `usdMxn` snapshot.
 *
 * Same reliability envelope as the quote providers (R4): the call is bounded by an
 * `AbortController` timeout, and every failure is thrown loud so the orchestrator
 * can fail the `*-mxn` derivations rather than silently reuse an old rate. The
 * token is read from the environment (`BANXICO_TOKEN`), never committed.
 */
import type { FixObservation } from "@numisma/engine";
import { fetchJson, isRecord } from "./provider.js";

const BANXICO_SF43718 =
  "https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/oportuno";

export interface FixFetchOptions {
  timeoutMs: number;
  /** The Banxico SIE token, read from `BANXICO_TOKEN`. */
  token: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch the latest USD/MXN FIX (Banxico SF43718). Throws on a missing token, HTTP
 * failure, an unexpected payload shape, a non-numeric / `N/E` rate, or a timeout —
 * the orchestrator surfaces it and refuses the `*-mxn` derivations loudly.
 */
export async function fetchBanxicoFix(options: FixFetchOptions): Promise<FixObservation> {
  if (!options.token) {
    throw new Error(
      "Banxico SF43718 -> BANXICO_TOKEN is not set; export a free Banxico SIE token " +
        "before fetching the USD/MXN FIX.",
    );
  }
  const r = await fetchJson(BANXICO_SF43718, {
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    init: { headers: { "Bmx-Token": options.token, Accept: "application/json" } },
  });
  if (!r.ok) {
    throw new Error(`Banxico SF43718 -> ${r.reason}`);
  }
  const datum = extractLatestDatum(r.body);
  const rate = Number(datum.dato);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Banxico SF43718 -> non-positive FIX rate '${datum.dato}'`);
  }
  return { rate, date: isoDateFromBanxico(datum.fecha) };
}

interface BanxicoDatum {
  fecha: string;
  dato: string;
}

/** Dig the single latest `{ fecha, dato }` out of the SIE `bmx.series[0].datos[0]`. */
function extractLatestDatum(body: unknown): BanxicoDatum {
  if (!isRecord(body)) {
    throw new Error("Banxico SF43718 -> unexpected payload shape");
  }
  const bmx = body.bmx;
  if (!isRecord(bmx) || !Array.isArray(bmx.series)) {
    throw new Error("Banxico SF43718 -> unexpected payload shape");
  }
  const series = bmx.series[0];
  if (!isRecord(series) || !Array.isArray(series.datos) || series.datos.length === 0) {
    throw new Error("Banxico SF43718 -> no FIX observation in payload");
  }
  const datum = series.datos[series.datos.length - 1];
  if (!isRecord(datum) || typeof datum.fecha !== "string" || typeof datum.dato !== "string") {
    throw new Error("Banxico SF43718 -> unexpected FIX observation shape");
  }
  return { fecha: datum.fecha, dato: datum.dato };
}

/** Banxico reports `dd/MM/yyyy`; normalize to the `YYYY-MM-DD` the engine expects. */
function isoDateFromBanxico(fecha: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha);
  if (!match) {
    throw new Error(`Banxico SF43718 -> unexpected FIX date format '${fecha}'`);
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

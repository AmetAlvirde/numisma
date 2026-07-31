/**
 * Node-runnable entry point for retiring one resting rung:
 *
 *   pnpm orders:cancel <orderId> [observedAt]
 *
 * WIRING ONLY — it binds the real filesystem, the real data dir and the real clock to
 * `cancelOrder`, which holds the flow and every refusal. Keeping the wiring in its own
 * module is what lets the test import the flow with no side effects: importing this file
 * runs the act.
 *
 * No readline. The whole assertion is in argv, so this is scriptable and does not need a
 * TTY — unlike `orders:import`, which builds its prompt before its async load.
 */
import { appendOrders, loadOrders, resolveOrdersPath } from "@numisma/preferences";
import { cancelOrder } from "./cancel-order.js";

const orderId = process.argv[2];
const observedAt = process.argv[3];
if (!orderId) {
  process.stderr.write("usage: pnpm orders:cancel <orderId> [YYYY-MM-DDTHH:MM:SS]\n");
  process.exitCode = 1;
} else {
  try {
    const outcome = await cancelOrder({
      orderId,
      observedAt,
      io: {
        ordersPath: resolveOrdersPath(),
        loadOrders,
        appendOrders,
        now: () => new Date(),
        out: (message) => process.stdout.write(message),
        err: (message) => process.stderr.write(`${message}\n`),
      },
    });
    if (outcome.status === "rejected") {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

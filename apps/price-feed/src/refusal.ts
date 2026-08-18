/**
 * The one error type that means "the operator asked for something this command does
 * not accept" — as opposed to "something went wrong while doing the work".
 *
 * WHY A TYPE RATHER THAN A FLAG ON THE CALL SITE. `runPriceFetchCli` renders a
 * refusal as a single readable sentence and swallows the stack, because an operator
 * who mistyped a date needs a correction, not a trace. That rendering must be keyed
 * on WHAT THREW, never on WHICH PATH we are on: gating it on "an `--as-of` was
 * given" would also swallow the stack of an `EACCES` from `mkdir`, an atomic-write
 * failure, or a genuine defect in `buildMarks` — and it would do so on the newer,
 * less-exercised half of the command, where a bug is hardest to see.
 *
 * So: everything thrown by the argument parser and by `runPriceFetch`'s `asOf`
 * validation is a `PriceFetchRefusal`; everything else keeps its stack on both the
 * live and the recovery path.
 */
export class PriceFetchRefusal extends Error {
  override readonly name = "PriceFetchRefusal";

  constructor(message: string) {
    super(message);
  }
}

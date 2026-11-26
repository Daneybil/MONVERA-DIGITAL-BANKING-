export const MIN_USD_DEPOSIT_DOLLARS = 1.0;
export const MIN_USD_DEPOSIT_CENTS = 100;
export const MAX_USD_DEPOSIT_CENTS = 99_999_999; // $999,999.99 single-charge limit

export type UsdDepositValidationResult =
  | { ok: true; amount: number; cents: number }
  | { ok: false; error: string };

/**
 * Validates customer USD deposit amounts across both frontend forms and backend settlement.
 * Enforces a $1.00 USD minimum, positive finite numeric value, and at most 2 decimal places.
 */
export function validateUsdDepositAmount(
  value: unknown,
  options?: { minCents?: number; maxCents?: number }
): UsdDepositValidationResult {
  const minCents = options?.minCents ?? MIN_USD_DEPOSIT_CENTS;
  const maxCents = options?.maxCents ?? MAX_USD_DEPOSIT_CENTS;

  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'object' ||
    (typeof value === 'string' && !value.trim())
  ) {
    return { ok: false, error: 'Please enter a valid positive USD deposit amount.' };
  }

  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(num) || num <= 0) {
    return { ok: false, error: 'Deposit amount must be a positive finite USD amount.' };
  }

  const cents = Math.round(num * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(num * 100 - cents) > 1e-6) {
    return { ok: false, error: 'Deposit amount must have at most 2 decimal places.' };
  }

  if (cents < minCents) {
    return {
      ok: false,
      error: `Minimum deposit amount is $${(minCents / 100).toFixed(2)} USD.`,
    };
  }

  if (cents > maxCents) {
    return {
      ok: false,
      error: `Maximum single deposit amount is $${(maxCents / 100).toFixed(2)} USD.`,
    };
  }

  return {
    ok: true,
    amount: Number((cents / 100).toFixed(2)),
    cents,
  };
}

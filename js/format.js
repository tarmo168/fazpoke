/** Plain signed figures. No currency symbol and no currency name. */

export function formatAmount(value) {
  return Math.abs(value).toLocaleString("en-US");
}

export function formatSigned(value) {
  if (value > 0) return `+${formatAmount(value)}`;
  if (value < 0) return `-${formatAmount(value)}`;
  return "0";
}

export function signedClass(value) {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "even";
}

// Everything the billing API returns arrives as a minor-unit integer or an
// RFC 3339 string. Nothing here renders either one raw.

// Stripe quotes these currencies in whole units, so their "cents" are already the
// amount. Dividing by 100 would price a ¥1700 plan at ¥17.
const zeroDecimalCurrencies = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);

function majorUnits(minorUnits: number, currency: string) {
  return zeroDecimalCurrencies.has(currency.toLowerCase()) ? minorUnits : minorUnits / 100;
}

export function formatMoney(minorUnits: number, currency: string) {
  const code = (currency || "usd").toUpperCase();
  const amount = majorUnits(minorUnits, code);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(amount);
  } catch {
    // An unrecognised currency code makes Intl throw rather than degrade, and a
    // billing screen that renders nothing is worse than one that renders "17.00 XYZ".
    return `${amount.toFixed(zeroDecimalCurrencies.has(code.toLowerCase()) ? 0 : 2)} ${code}`;
  }
}

// The headline price is read at a glance, so a plan that costs a whole unit is
// shown as "$17" rather than "$17.00". Anything with a fractional part keeps it.
export function formatPlanPrice(minorUnits: number, currency: string) {
  const code = (currency || "usd").toUpperCase();
  const amount = majorUnits(minorUnits, code);
  if (!Number.isInteger(amount)) return formatMoney(minorUnits, code);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${code}`;
  }
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(value: string | null | undefined, fallback = "Not scheduled") {
  const parsed = parseDate(value);
  return parsed ? parsed.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : fallback;
}

export function formatShortDate(value: string | null | undefined, fallback = "—") {
  const parsed = parseDate(value);
  return parsed ? parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : fallback;
}

export function formatStatus(status: string) {
  if (!status) return "Unknown";
  const words = status.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatCardBrand(brand: string) {
  if (!brand) return "Card";
  if (brand.toLowerCase() === "amex") return "American Express";
  return brand.split(/[\s_]+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function formatExpiry(month: number, year: number) {
  if (!month || !year) return "";
  return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`;
}

// A card is past its expiry from the first day of the month after the printed one.
export function cardHasExpired(month: number, year: number, now = new Date()) {
  if (!month || !year) return false;
  return new Date(year, month, 1).getTime() <= now.getTime();
}

export function invoiceBadgeVariant(status: string): "success" | "warning" | "destructive" | "secondary" {
  switch (status) {
    case "paid": return "success";
    case "open": return "warning";
    case "uncollectible":
    case "void": return "destructive";
    default: return "secondary";
  }
}

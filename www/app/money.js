// Writing amounts the same way on every screen: whole numbers from 1,000, and two decimals below that
// only when the figure has them, so a per-point fee of NZD 312.36 keeps its cents
const LAKH = 100000;
const CRORE = 10000000;
// Rounding taka figures below a lakh to the nearest hundred, since they are worked out from a rate
const TAKA_ROUNDING = 100;
const WHOLE_FROM = 1000;

function grouped(whole) {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function amountWords(amount) {
  if (Number.isInteger(amount)) {
    return grouped(amount);
  }
  return amount >= WHOLE_FROM ? grouped(Math.round(amount)) : amount.toFixed(2);
}

// Writing a fee charged in taka with the taka sign, exactly as the source gives it, like the worked-out
// taka figures beside other currencies
export function moneyText(currency, amount) {
  return currency === "BDT" ? `৳${amountWords(amount)}` : `${currency} ${amountWords(amount)}`;
}

// Writing two decimals of lakh or crore, but "৳30 lakh" rather than "৳30.00 lakh"
function hundredths(value) {
  return value.toFixed(2).replace(/\.00$/, "");
}

// Writing "৳43,300", "৳6.13 lakh" or "৳1.13 crore", the way families in Bangladesh read large sums
export function takaText(taka) {
  if (taka >= CRORE) {
    return `৳${hundredths(taka / CRORE)} crore`;
  }
  if (taka >= LAKH) {
    return `৳${hundredths(taka / LAKH)} lakh`;
  }
  return `৳${grouped(Math.round(taka / TAKA_ROUNDING) * TAKA_ROUNDING)}`;
}

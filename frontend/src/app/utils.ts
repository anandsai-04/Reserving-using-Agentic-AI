export const CURRENCIES = {
  USD: { symbol: '$', rate: 1.0, label: 'US Dollar (USD)' },
  INR: { symbol: '₹', rate: 83.5, label: 'Indian Rupee (INR)' },
  RUB: { symbol: '₽', rate: 90.0, label: 'Russian Rouble (RUB)' },
  CNY: { symbol: '¥', rate: 7.2, label: 'Chinese Yuan (CNY)' },
  EUR: { symbol: '€', rate: 0.92, label: 'Euro (EUR)' },
  JPY: { symbol: '¥', rate: 155.0, label: 'Japanese Yen (JPY)' }
};

export type CurrencyCode = keyof typeof CURRENCIES;

export function fmt(n: number | null | undefined, currency: CurrencyCode = 'USD'): string {
  if (n == null || isNaN(n)) return '—';
  const c = CURRENCIES[currency];
  const converted = n * c.rate;
  const abs = Math.abs(converted);
  
  if (abs >= 1e9) return `${c.symbol}${(converted / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${c.symbol}${(converted / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${c.symbol}${(converted / 1e3).toFixed(0)}K`;
  return `${c.symbol}${converted.toFixed(0)}`;
}

export function fmtShort(n: number | null | undefined, currency: CurrencyCode = 'USD'): string {
  if (n == null || isNaN(n)) return '—';
  const c = CURRENCIES[currency];
  const converted = n * c.rate;
  const abs = Math.abs(converted);
  
  if (abs >= 1e6) return `${(converted / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(converted / 1e3).toFixed(0)}K`;
  return converted.toFixed(0);
}

// Totals computed locally from state (same definitions the backend `totals` action uses).
//  - nights: nights of confirmed stays falling in the month (blocked dates excluded)
//  - occupancy: nights / (active units × days)
//  - revenue: price of confirmed stays by check-in month (price already includes the cleaning fee)
//  - cleaning: the cleaning_fee part of that revenue (informational; never added again)
//  - discount: discounts granted on those stays (informational; price is already net of them)
//  - expenses: by expense date
import { addDays, daysInMonth, diffDays, num, truthy } from './lib.js';

export function activeUnitCount(units) {
  const n = units.filter((u) => u.active === undefined || u.active === '' || truthy(u.active)).length;
  return n || units.length;
}

export function computeTotals({ year, reservations, expenses, units, settings }) {
  const Y = String(year);
  const active = activeUnitCount(units);
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, nights: 0, revenue: 0, cleaning: 0, discount: 0, expenses: 0, capacity: active * daysInMonth(+Y, i),
  }));
  const ss = /^\d{2}-\d{2}$/.test(settings?.season_start || '') ? settings.season_start : '05-01';
  const se = /^\d{2}-\d{2}$/.test(settings?.season_end || '') ? settings.season_end : '10-31';
  const sStart = `${Y}-${ss}`, sEnd = `${Y}-${se}`; // inclusive
  const inSeason = (d) => d >= sStart && d <= sEnd;
  const season = { nights: 0, revenue: 0, cleaning: 0, discount: 0, expenses: 0, capacity: active * (diffDays(sStart, sEnd) + 1), start: ss, end: se };
  const yStart = `${Y}-01-01`, yEnd = `${+Y + 1}-01-01`;

  for (const r of reservations) {
    if (r.status !== 'confirmed' || !r.check_in || !r.check_out) continue;
    if (r.check_in.startsWith(Y)) {
      const p = num(r.price);
      const disc = Math.max(0, num(r.discount));
      const c = Math.min(num(r.cleaning_fee), p + disc);
      const mo = months[+r.check_in.slice(5, 7) - 1];
      mo.revenue += p;
      mo.cleaning += c;
      mo.discount += disc;
      if (inSeason(r.check_in)) { season.revenue += p; season.cleaning += c; season.discount += disc; }
    }
    if (r.source === 'block') continue;
    let d = r.check_in > yStart ? r.check_in : yStart;
    const end = r.check_out < yEnd ? r.check_out : yEnd;
    for (; d < end; d = addDays(d, 1)) {
      months[+d.slice(5, 7) - 1].nights++;
      if (inSeason(d)) season.nights++;
    }
  }
  for (const e of expenses) {
    if (!e.date || !e.date.startsWith(Y)) continue;
    const a = num(e.amount);
    months[+e.date.slice(5, 7) - 1].expenses += a;
    if (inSeason(e.date)) season.expenses += a;
  }
  const sum = (k) => months.reduce((s, m) => s + m[k], 0);
  const yearRow = { nights: sum('nights'), revenue: sum('revenue'), cleaning: sum('cleaning'), discount: sum('discount'), expenses: sum('expenses'), capacity: sum('capacity') };
  return { months, season, year: yearRow };
}

export function parseDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day || 1);
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addMonths(date: string, months: number): string {
  const d = parseDate(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);

  if (d.getDate() !== day) {
    d.setDate(0);
  }

  return formatDate(d);
}

export function getYear(date: string): number {
  return parseDate(date).getFullYear();
}

export function sameMonthOrAfter(a: string, b: string): boolean {
  const da = parseDate(a);
  const db = parseDate(b);
  return (
    da.getFullYear() > db.getFullYear() ||
    (da.getFullYear() === db.getFullYear() && da.getMonth() >= db.getMonth())
  );
}

export function getNextMonthFirstDay(baseDate = new Date()): string {
  return formatDate(new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 1));
}

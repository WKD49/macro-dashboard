// Week boundaries: Saturday–Friday, local time (European calendar)

export function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day >= 6 ? 0 : day + 1;
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function endOfWeek(d: Date): Date {
  const start = startOfWeek(d);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function isWithinWeek(dateIso: string | null, ref: Date = new Date()): boolean {
  if (!dateIso) return false;
  const date = new Date(dateIso);
  return date >= startOfWeek(ref) && date <= endOfWeek(ref);
}

export function isWithinNextWeek(dateIso: string | null, ref: Date = new Date()): boolean {
  if (!dateIso) return false;
  const nextRef = new Date(ref);
  nextRef.setDate(ref.getDate() + 7);
  return isWithinWeek(dateIso, nextRef);
}

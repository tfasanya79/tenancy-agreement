/**
 * A small iCalendar (.ics) writer.
 *
 * One file, imported into Outlook, Google Calendar or Apple Calendar, puts the
 * statutory deadlines into the diary where they will actually be seen. That is
 * cheaper and more reliable than the app trying to send reminders itself.
 *
 * All events are all-day: a deposit deadline is a date, not an appointment.
 */

export type CalendarEvent = {
  /** Stable across exports, so re-importing updates rather than duplicates. */
  uid: string;
  date: string;
  title: string;
  description?: string;
};

function escape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function stamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

/** Fold long lines at 75 octets, as the specification requires. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest !== '') parts.push(` ${rest}`);
  return parts.join('\r\n');
}

export function buildCalendar(events: readonly CalendarEvent[], options: { name?: string; now?: Date } = {}): string {
  const now = options.now ?? new Date();
  const stampValue = stamp(now);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TenancyDesk//Deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(options.name ?? 'Tenancy deadlines')}`,
  ];

  for (const event of events) {
    const day = event.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.uid}@tenancydesk`);
    lines.push(`DTSTAMP:${stampValue}`);
    lines.push(`DTSTART;VALUE=DATE:${day}`);
    lines.push(`DTEND;VALUE=DATE:${day}`);
    lines.push(`SUMMARY:${escape(event.title)}`);
    if (event.description !== undefined && event.description !== '') {
      lines.push(`DESCRIPTION:${escape(event.description)}`);
    }
    // A reminder the morning before, and on the day.
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:-P1D');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:${escape(event.title)}`);
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

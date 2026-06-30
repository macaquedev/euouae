// The app stores all timestamps as Unix epoch seconds (matching Zyzzyva's
// schema and the scheduler's arithmetic). One definition of that conversion.

export const epochSeconds = (date: Date = new Date()): number => Math.floor(date.getTime() / 1000);

// The study day rolls over at 4am local time (as Anki does): a review in the
// small hours counts toward the previous day, and due dates land at 4am, so a
// late-night session doesn't bleed into "tomorrow".
const DAY_ROLLOVER_HOUR = 4;

/**
 * Unix seconds of the 4am day-rollover `days` study-days after the one
 * `epochSec` falls in. Schedulers snap due dates to this boundary rather than
 * the clock time a review happened, so a card resurfaces at the top of its due
 * day instead of, say, 8pm. Calendar arithmetic keeps it at 4am across DST.
 */
export const startOfDayAfter = (epochSec: number, days: number): number => {
	const d = new Date(epochSec * 1000);
	// A review before the rollover belongs to the previous study day.
	if (d.getHours() < DAY_ROLLOVER_HOUR) d.setDate(d.getDate() - 1);
	d.setHours(DAY_ROLLOVER_HOUR, 0, 0, 0);
	d.setDate(d.getDate() + days);
	return Math.floor(d.getTime() / 1000);
};

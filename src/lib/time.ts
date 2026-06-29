// The app stores all timestamps as Unix epoch seconds (matching Zyzzyva's
// schema and the scheduler's arithmetic). One definition of that conversion.

export const epochSeconds = (date: Date = new Date()): number => Math.floor(date.getTime() / 1000);

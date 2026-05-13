/** Browser's IANA timezone (e.g. "Europe/Stockholm"), sent to the backend for TZ-aware bucketing. */
export const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone

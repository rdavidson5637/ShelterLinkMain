export function buildCalendarSubscribeUrls(feedUrl) {
  const url = String(feedUrl || '');
  const webcal = url.replace(/^https:\/\//i, 'webcal://');
  return {
    apple: webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
  };
}

# Follow-up Notification Setup

UdharBook includes browser notification reminders for scheduled follow-ups.

## Reminder Timing

The app checks for due follow-ups and notifies around:

- 1 hour before
- 30 minutes before
- 10 minutes before
- Exact time
- Missed follow-ups

## Browser Permission

Users are asked for notification permission when the app loads. Notifications work on desktop and supported mobile browsers.

## PWA Service Worker

The service worker is registered at:

```text
/sw.js
```

It displays notifications and opens `/follow-ups` when a reminder is clicked.

## True Push Notifications

Browser push notifications that work when the app has not been opened recently require VAPID keys and a web-push provider. Add these production variables when enabling server push:

```env
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:owner@example.com
```

The current implementation uses PWA/browser best practices for installed/open sessions and service-worker notification display.


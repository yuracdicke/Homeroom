# Homeroom: tasks and homework, with iPhone reminders

A clean planner for daily tasks and homework that works on your phone. You can add it to your iPhone Home Screen like an app and get push notifications before things are due.

## Features
- **Quick add:** type a task and press Enter. It's added to today.
- **Homework mode:** add a class or subject (each gets its own color), a due date and time, a priority and notes.
- **Views:** Today (overdue, due today and anytime), Upcoming (grouped by day), Homework (grouped by class), All, Done.
- **Reminders:** at the due time, 15 min, 1 hr, 3 hr or 1 day before, the morning of, or the evening before.
- Progress ring for today, undo for completing and deleting, dark mode, and it works offline.
- Export and import backups (JSON).

## Run it
```bash
npm install
npm start          # → http://localhost:3000
```

## Getting notifications on your iPhone
Apple only allows web notifications when:
1. the site is served over **HTTPS** (a real web address, not `localhost`), and
2. you've **added it to your Home Screen** (Safari → Share → Add to Home Screen, iOS 16.4+).

The server also has to **stay running**, because it sends the reminders. So you need to host it somewhere that's always on:

| Option | Cost | Notes |
|---|---|---|
| **Railway** (railway.app) | about $5/mo | Deploy from GitHub. Add a Volume mounted at `/app/data`. |
| **Render** (render.com) | $7/mo Starter | Free tier sleeps, so reminders would be missed. Add a Disk at `/opt/render/project/src/data`. |
| **Your own computer / Raspberry Pi** | free | `npm start`, then expose it over HTTPS with `cloudflared tunnel --url http://localhost:3000` or Tailscale Funnel. |

### Settings (environment variables, all optional)
- `PORT`: port to listen on (default 3000).
- `DATA_DIR`: where reminders and keys are stored (default `./data`).
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`: set these if your host has no persistent disk, so notifications keep working after restarts. Copy them from `data/vapid.json` after the first run.
- `VAPID_SUBJECT`: a `mailto:` contact for Apple's push service.

### Then on your iPhone
1. Open your site in **Safari** → **Share** → **Add to Home Screen**.
2. Open **Homeroom** from the Home Screen → tap the 🔔 → **Turn on notifications** → **Allow**.
3. You'll get a test notification right away. Any task with "Remind me" set will now notify you, even when the app is closed.

## How it works
- `public/` is the app (plain HTML, CSS and JS, no build step). Tasks are saved in the phone's local storage.
- `public/sw.js` is the service worker. It handles offline use and shows push notifications.
- `server.js` is a small Express server. The app sends it the list of upcoming reminders, and every 15 seconds it sends any that are due using Web Push.

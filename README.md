# Self-hosted Feedback & Bug Widget

A small, dependency-light system for collecting bug reports and feedback from any
number of websites. You run one server (on `fb.mysite.co`), drop a one-line
`<script>` tag on each site, and triage everything from a single dashboard.

- **Unlimited sites** — each report is tagged with a `site-id` you choose.
- **Automatic screenshots** — captured in the browser with html2canvas, no plugins.
- **Useful context attached** — page URL, viewport, device, browser, and recent
  JavaScript/console errors, so bugs are easier to reproduce.
- **Isolated widget** — renders inside a shadow DOM, so it can't clash with the
  host site's CSS (or be broken by it).
- **One dashboard** — filter by site and status, view screenshots, mark
  new/open/resolved/archived, delete.
- **No native build step** — storage uses Node's built-in SQLite, so there's
  nothing to compile on your server.

---

## 1. Requirements

- **Node.js 22.5 or newer** (uses the built-in `node:sqlite` module).
  Check with `node --version`.

## 2. Install & run

```bash
cd feedback-system
npm install
cp .env.example .env       # then edit .env (set ADMIN_PASSWORD!)
npm start
```

You'll see:

```
Dashboard:  http://localhost:3000
Widget:     http://localhost:3000/widget.js
```

Open `http://localhost:3000/demo.html` to try the widget, and
`http://localhost:3000/` for the dashboard (log in with your `ADMIN_PASSWORD`).

## 3. Configure (`.env`)

| Variable          | Default                  | Purpose |
|-------------------|--------------------------|---------|
| `ADMIN_PASSWORD`  | `changeme`               | Dashboard login. **Set this.** |
| `PUBLIC_URL`      | `http://localhost:3000`  | Your real URL, e.g. `https://fb.mysite.co`. Enables the `Secure` cookie flag over HTTPS. |
| `PORT`            | `3000`                   | Port to listen on. |
| `ALLOWED_ORIGINS` | _(empty = allow all)_    | Comma-separated list of site origins allowed to submit. Leave empty for a normal public widget. |
| `SESSION_SECRET`  | _(derived from password)_| Set a fixed random string so dashboard sessions survive password changes. |
| `MAX_BODY`        | `25mb`                   | Max request size (screenshots are sent inline). |

---

## 4. Add the widget to a site

Paste this before `</body>` on any site. The only required attribute is
`data-site-id` — pick a short unique name per site so reports are grouped.

```html
<script src="https://fb.mysite.co/widget.js" data-site-id="my-store"></script>
```

A floating **Feedback** button appears bottom-right. Clicking it captures a
screenshot of the page and opens the report form.

### Widget options (all optional)

| Attribute           | Default          | Notes |
|---------------------|------------------|-------|
| `data-site-id`      | `default`        | Unique id for this site. Used to group reports. |
| `data-api`          | _(script origin)_| Where to send reports. Defaults to the domain serving the script, so you usually don't need it. |
| `data-color`        | `#2563eb`        | Accent colour (button, highlights). |
| `data-position`     | `bottom-right`   | `bottom-right` / `bottom-left` / `top-right` / `top-left`. |
| `data-label`        | `Feedback`       | Text on the floating button. |
| `data-title`        | `Send feedback`  | Heading inside the modal. |
| `data-categories`   | `bug,idea,feedback,other` | Which category chips to show. Use one value to hide the chips. |
| `data-email`        | `true`           | Show the optional "your email" field. |
| `data-auto-capture` | `true`           | Auto-capture a screenshot when the widget opens. |
| `data-launcher`     | `true`           | Set `false` to hide the floating button and trigger it yourself. |
| `data-help-url`     | _(none)_         | If set, shows a "Help Centre" link in the modal. |

### Trigger from your own button

Set `data-launcher="false"`, then call the global API from any element:

```html
<script src="https://fb.mysite.co/widget.js" data-site-id="my-store" data-launcher="false"></script>
<button onclick="window.FeedbackWidget.open()">Report a problem</button>
```

`window.FeedbackWidget` exposes `open()`, `close()`, and `capture()`.

---

## 5. Using the dashboard

Visit `https://fb.mysite.co/` and sign in.

- **Left rail** — filter by status (New / Open / Resolved / Archived) and by site.
  Unread counts per site are shown as badges.
- **List** — each report shows its category, site, a screenshot thumbnail, the
  message, and how long ago it came in. Search the box to filter by message,
  page URL, or email.
- **Detail panel** — click a report to see the full message, full-size screenshot
  (click to zoom), the captured environment (device, viewport, browser), and any
  JavaScript/console errors recorded on the page when the report was sent.
  Opening a "new" report marks it "open" automatically.
- Change status with the buttons at the bottom of the panel, or delete the report.

---

## 6. Deploy to production

Run it behind a reverse proxy with HTTPS. Example with a process manager + nginx:

**Keep it running** (e.g. with [PM2](https://pm2.keymetrics.io)):

```bash
npm install -g pm2
pm2 start "npm start" --name feedback
pm2 save && pm2 startup
```

**Reverse proxy** (nginx) for `fb.mysite.co` — note the larger body size so
screenshots get through:

```nginx
server {
  server_name fb.mysite.co;
  client_max_body_size 25m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Then issue a certificate (e.g. `certbot --nginx -d fb.mysite.co`) and set
`PUBLIC_URL=https://fb.mysite.co` in `.env`.

Because the widget is loaded from `fb.mysite.co` and embedded on other domains,
the server already sends the right CORS headers for `/widget.js`,
`/vendor/html2canvas.min.js`, and `/api/feedback`. Nothing else is needed on the
embedding sites.

---

## 7. Where your data lives

Everything is under `./data` (created on first run):

- `data/feedback.db` — the SQLite database (all reports).
- `data/uploads/` — screenshot image files.

To **back up**, copy the whole `data` folder. To **reset**, stop the server and
delete it. Screenshots are private — they're only served to a logged-in
dashboard session.

---

## 8. Notes on abuse

The submission endpoint is public (it has to be, to accept reports from visitors).
It's protected by: a per-IP rate limit (20 reports/minute), a hidden honeypot
field, size caps on text and images, and an optional `ALLOWED_ORIGINS` allowlist.
For a feedback widget this is usually plenty. If a specific site gets abused, add
its origins to `ALLOWED_ORIGINS` or put the endpoint behind a WAF/Cloudflare.

---

## File overview

```
feedback-system/
├── server.js              # API + auth + static serving
├── package.json
├── .env.example           # copy to .env and edit
├── tailwind.config.js     # dashboard styling config (build-time only)
├── design/
│   └── tailwind.src.css   # Tailwind source + @font-face (build-time only)
├── public/
│   ├── widget.js          # the embeddable widget
│   ├── dashboard.html     # admin dashboard (Alpine + Pines UI)
│   ├── demo.html          # local test page
│   ├── assets/
│   │   ├── tailwind.css   # compiled dashboard styles (shipped)
│   │   └── alpine.min.js  # Alpine.js runtime (self-hosted)
│   ├── fonts/             # Open Sauce Sans, subset woff2 (self-hosted)
│   └── vendor/
│       └── html2canvas.min.js   # screenshot library (self-hosted)
└── data/                  # created at runtime: db + screenshots
```

## Design & fonts

The dashboard is built with [Pines UI](https://devdojo.com/pines) patterns (Alpine.js + Tailwind CSS) and typeset in **Open Sauce Sans**, self-hosted from `public/fonts/` (subset to Latin, ~10 KB per weight). Alpine and the compiled Tailwind stylesheet are vendored under `public/assets/` — there are **no runtime CDN dependencies**, so the console works behind a locked-down tunnel or offline.

The widget uses the same Open Sauce Sans face inside its shadow DOM, loaded cross-origin from the backend (the `/fonts` route sends `Access-Control-Allow-Origin: *`).

To change the dashboard's look, edit `public/dashboard.html` (Tailwind classes) and recompile the stylesheet:

```bash
npm install            # installs the tailwindcss dev dependency
npm run build:css      # regenerates public/assets/tailwind.css
# or keep it running while you edit:
npm run build:css:watch
```

Tailwind is a **dev dependency only** — production still runs on `express` alone.

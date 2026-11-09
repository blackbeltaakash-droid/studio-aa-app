# studio aa app

Client workspaces fed by text message.

- `public/w/index.html` is the workspace page, served at `/w/<slug>` for any slug.
- `netlify/functions/sms.mts` is the Twilio webhook (`/sms`). It drops each inbound text into the workspace inbox.
- `netlify/functions/api.mts` reads and writes a workspace (`/api/w/<slug>`), folding inbox texts into the live log on read.
- `design/preview.html` is the design source; `scripts/build-page.py design/preview.html` rebuilds the page from it.

Environment variables (Functions scope): `WS_MAP` (JSON, phone number to slug), `DEFAULT_WS` (slug for unmapped numbers), `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` (needed to pull pictures off Twilio; the token also validates Twilio signatures), `REPLY_TEXT` (optional auto reply), `TWILIO_FROM` (the Studio Aa number, needed to reply from the page), `NOTIFY_TO` (optional; your own mobile number. Each request is texted to it, and a text from it is sent on to whoever asked last instead of being filed as a request. Start a reply with `name:` to pick a person).

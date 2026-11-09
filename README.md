# studio aa app

Client workspaces fed by text message.

- `public/w/index.html` is the workspace page, served at `/w/<slug>` for any slug.
- `netlify/functions/sms.mts` is the Twilio webhook (`/sms`). It drops each inbound text into the workspace inbox.
- `netlify/functions/api.mts` reads and writes a workspace (`/api/w/<slug>`), folding inbox texts into the live log on read.
- `netlify/functions/lock.mts` sets and checks the password on a workspace (`/api/w/<slug>/lock` and `/unlock`); `netlify/lib/lock.mts` holds the hashing and the cookie. A browser without the password is sent only the workspace name, cannot save anything and cannot text anyone from the page, and the password itself is never stored. The password is set and removed from the + menu on the board, and a browser stays open for thirty days. Texts still arrive while a workspace is locked, since the webhook does not go through the browser. Pictures under `/media/<slug>/<id>` are not behind the password, but an id is only learnable from a request.
- In the live log, each section (pending, approved, done) folds shut from its chevron, and which sections are shut is saved with the workspace. Approved and done can be cleared in one go from the section head, with an undo for a few seconds.
- `design/preview.html` is the design source; `scripts/build-page.py design/preview.html` rebuilds the page from it.

Environment variables (Functions scope): `WS_MAP` (JSON, phone number to slug), `DEFAULT_WS` (slug for unmapped numbers), `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` (needed to pull pictures off Twilio; the token also validates Twilio signatures), `REPLY_TEXT` (optional auto reply), `TWILIO_FROM` (the Studio Aa number, needed to reply from the page), `NOTIFY_TO` (optional; your own mobile number. Each request is texted to it, and a text from it is sent on to whoever asked last instead of being filed as a request. Start a reply with `name:` to pick a person).

# Records of Event

A public, open-source archive of raw footage from protests and other events.
Anyone can start an archive for an event, share its QR code, and everyone who was there can upload what they filmed. Videos are kept as original files, fingerprinted (SHA-256) so anyone can prove they haven't changed, and shown in the order they were filmed.

- **No accounts.** Uploaders get a private receipt link to check or remove their videos.
- **Safe uploads.** Location and phone details are removed from MP4/MOV files on the uploader's device before anything is sent. IP addresses are never stored.
- **Reviewed.** A moderator approves each video before it goes public (configurable).
- **Verifiable.** Every record has a number (`ROE-261010-0042`), a fingerprint, a download link, and a public manifest per event.

## How it works

| Part | What it is |
|---|---|
| `web/` | The site: plain HTML/CSS/JavaScript, bundled by esbuild into `dist/` |
| `server/app.js` | The whole backend: JSON API, media links, moderation, link previews |
| `api/index.js` | The Vercel serverless function that runs `server/app.js` |
| Postgres | Events, records, reports (Neon, Supabase or any Postgres). The schema is created automatically on first run |
| S3-compatible storage | The video files (Cloudflare R2 recommended — viewers watching video costs nothing) |

Uploads go straight from the browser to storage in 8 MB parts using short-lived signed URLs, so large files never pass through Vercel. Uploads resume by themselves after a network drop. Playback works the same way: the API hands out signed links, and posters and videos load straight from storage.

Videos can also be added by pasting a public link: Google Drive ("Anyone with the link"), Dropbox, OneDrive, or any direct link to a video file. The server checks the link, then copies the video into storage in 16 MB parts while the uploader's browser keeps the copy going, so it resumes after a dropped connection. Location and phone details are removed and fingerprints are taken just like for uploaded files, and the link itself isn't stored once the copy is done. Links to YouTube, Instagram, TikTok and similar sites can't be copied; people save the video and upload the file instead. Private network addresses are refused.

`npm run build` writes `dist/`: the app is split into content-hashed files under `dist/assets/` (cached forever by browsers; the upload, moderation and verify code loads only when needed), and `dist/index.html` plus `server/template.js` are rewritten to point at them. Fingerprinting runs in a Web Worker built to `dist/hash-worker.js`.

## Deploy (about 20 minutes)

### 1. Put the code on GitHub
Create an empty repository on GitHub, then from this folder:

```bash
git remote add origin https://github.com/<you>/recordsofevent.git
git push -u origin main
```

### 2. Storage — Cloudflare R2
1. In the Cloudflare dashboard → **R2** → **Create bucket**, name it `recordsofevent`. Keep it private (no public access).
2. Bucket → **Settings** → **CORS policy** → paste:
   ```json
   [
     {
       "AllowedOrigins": ["https://recordsofevent.com", "https://<your-project>.vercel.app"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 86400
     }
   ]
   ```
   `ExposeHeaders: ETag` is required — without it uploads stop with an error.
3. Bucket → **Settings** → **Object lifecycle rules** → add a rule to *abort incomplete multipart uploads after 1 day*.
4. R2 → **Manage API tokens** → **Create API token** with *Object Read & Write* on this bucket. Note the **Access Key ID**, **Secret Access Key** and the **S3 endpoint** (`https://<account-id>.r2.cloudflarestorage.com`).

### 3. Vercel
1. [vercel.com/new](https://vercel.com/new) → import the GitHub repository. Framework preset: **Other** (settings come from `vercel.json`).
2. Project → **Storage** → **Create** → **Neon (Postgres)** → connect it to the project. This sets `DATABASE_URL`.
3. Project → **Settings** → **Environment Variables** — add:

   | Name | Value |
   |---|---|
   | `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
   | `S3_BUCKET` | `recordsofevent` |
   | `S3_ACCESS_KEY_ID` | from step 2.4 |
   | `S3_SECRET_ACCESS_KEY` | from step 2.4 |
   | `ADMIN_PASSWORD` | a long random password for `/admin` |
   | `APP_SECRET` | output of `openssl rand -hex 32` (any long random string) |
   | `SITE_URL` | `https://recordsofevent.com` |
   | `CONTACT_EMAIL` | address for takedown and safety requests |
   | `OPERATOR_NAME` | who runs the site (shown on the policy pages) |
   | `REPO_URL` | your GitHub repository URL (footer link) |
   | `CRON_SECRET` | any random string (protects the daily cleanup job) |

   All options are listed in [`.env.example`](.env.example).
4. **Deployments** → **Redeploy** so the variables take effect.
5. **Settings** → **Domains** → add `recordsofevent.com` and follow the DNS instructions.
6. Optional but worth it: **Settings** → **Functions** → **Function Region** — pick the region closest to your Neon database (shown in the Neon console). Every page and API call talks to the database, so a function on another continent adds that distance to each request.

### 4. First run
1. Open `https://recordsofevent.com/new` and create the first event.
2. Upload a test clip from your phone.
3. Open `/admin`, sign in with `ADMIN_PASSWORD`, approve the clip and the event.

## Moderation

`/admin` has a review queue (keyboard: `J`/`K` move, `A` approve, `R` reject, `S` sensitive), events (approve, hide, edit summary, sources and figures), reports, hidden clips, recently published clips, and a log of every moderator action.

- **Labels**: *Verified*, *Place checked*, *Not yet verified*, *Disputed*.
- **Removal** keeps the record number with a public note and reason; the file is deleted.
- Three separate reports on one clip hide it automatically until a moderator looks.
- Set `MODERATION=post` to publish videos immediately and review afterwards.

## Local development

Needs Node.js 20 or newer. No cloud accounts needed — it uses an embedded Postgres and a local folder for videos.

```bash
npm install
npm run dev
```

Open http://localhost:3000 (moderation at `/admin`, password `admin` unless `ADMIN_PASSWORD` is set). Put settings in a `.env` file to use a real database or bucket. `npm run build` produces the production bundle in `dist/`.

## Limits and costs

- Default limits: 5 GB per file, 50 GB per person per day (`MAX_FILE_GB`, `DAILY_UPLOAD_GB`), plus rate limits on events, uploads, reports and sign-in.
- Vercel Hobby is free for personal, non-commercial projects; Neon has a free tier; R2 charges about $0.015 per GB stored per month and nothing for viewing.
- Videos added by link pass through the Vercel function while they're copied, which counts toward the function's bandwidth and run time. Set `LINK_IMPORTS=off` to hide the option.
- Videos are stored and played as uploaded. Browsers that can't play a format (for example HEVC on some desktops) offer the original file as a download.

## Licence

Code: MIT. Uploaded footage is published under CC BY 4.0 by its uploaders.

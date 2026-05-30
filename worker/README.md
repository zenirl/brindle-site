# Brindle photo Worker (Cloudflare R2)

Stores sitter-sent photos in R2 instead of base64 inside Firestore docs.

## One-time setup

1. **Cloudflare account** with **R2 enabled** (dashboard → R2 → accept terms; a
   card on file is required even though the free tier covers Brindle's usage).
2. Authenticate the CLI:
   ```sh
   npx wrangler login
   ```
3. Create the bucket:
   ```sh
   cd brindle-site/worker
   npx wrangler r2 bucket create brindle-photos
   ```
4. **Lifecycle rule** so objects auto-delete and storage never grows
   (the owner's phone already keeps a permanent copy in its gallery):
   ```sh
   npx wrangler r2 bucket lifecycle add brindle-photos \
     --name expire-14d --expire-days 14
   ```
   (Or set it in the dashboard: R2 → brindle-photos → Settings → Object lifecycle →
   "Delete objects 14 days after upload".)

## Deploy

```sh
cd brindle-site/worker
npx wrangler deploy
```

Wrangler prints the Worker URL, e.g. `https://brindle-photos.<your-subdomain>.workers.dev`.

## After deploy

Put that URL into the sitter page constant:
`brindle-site/sitter/app.js` → `const PHOTO_WORKER = "https://brindle-photos.<your-subdomain>.workers.dev";`
then bump the `?v=` cache-busters in `sitter/index.html` and push the site.

## Endpoints

- `POST /upload?code=XXXXXXXX` — body is JPEG bytes; validates the share code
  against Firestore, caps size, stores `r2://<code>/<uuid>.jpg`, returns
  `{ key, url }`.
- `GET /p/<code>/<uuid>.jpg` — serves the image (free R2 egress).

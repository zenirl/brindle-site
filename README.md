# petlog-site

Public website for [Brindle](https://github.com/zenirl/petlog) (private repo). Hosted on GitHub Pages at <https://zenirl.github.io/petlog-site/>.

## What's here

| Path | Purpose |
| --- | --- |
| `/` | Landing page (about Brindle) |
| `/privacy/` | Privacy policy (linked from the app) |
| `/sitter/?code=XXX` | Pet sitter web app — opens a shared snapshot by code, lets the sitter check off feedings, walks, and meds. Updates flow back to the owner's app via Firestore. |

## Stack

- Jekyll (built-in GitHub Pages renderer) for Markdown → HTML
- Vanilla HTML + JS + CSS for the sitter app (no build pipeline)
- Firebase Web SDK 10.x from CDN for Firestore + anonymous auth

## Deploy

Pushes to `main` auto-deploy via GitHub Pages.

## Companion repo

[zenirl/petlog](https://github.com/zenirl/petlog) — the Android app (private).

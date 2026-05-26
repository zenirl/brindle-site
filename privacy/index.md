---
layout: default
title: Privacy Policy
permalink: /privacy/
---

# Pet Log — Privacy Policy

**Last updated:** 2026-05-25

Pet Log ("the app") is a local-first pet health tracker published by Zenirl. This policy explains what the app does and does not do with your data.

## What we collect

**Nothing on our servers** when you use the app locally. There is no analytics, no advertising SDK, no crash reporter, no telemetry attached to your in-app activity.

## Where your data lives

All pet records, photos, and log entries you create are stored only on your device, in the app's private storage.

## Backups

The app participates in **Android Auto Backup**. When you sign in to a Google account on your Android device, Google may back up app data (including Pet Log's database and photos) to your personal Google Drive, encrypted with a key tied to your device PIN/password. This is a Google service — Zenirl has no access to these backups.

You can disable Auto Backup at any time in *Android Settings → Google → Backup*.

## Export

The app lets you export your data to a JSON file via the system share sheet. Where that file goes (Google Drive, Gmail, WhatsApp, etc.) is entirely your choice. Zenirl never sees the file.

## Pet sitter sharing (optional, opt-in)

If you tap **Share with sitter** in the app, Pet Log uploads a one-time snapshot of the chosen pet's care information (feeding schedule, meds, vet contact, behavior notes, recent activity) to our Firebase project so the sitter can open it via a web link without installing anything.

- The snapshot is tied to a random 8-character share code that acts as the URL token.
- It expires automatically after 7 days.
- You can revoke a share at any time from the app, which deletes it from our servers.
- The sitter's check-ins (e.g. "fed at 8 PM") are written to the same share document and visible only to you and anyone who has the code.

Pet sitter sharing is the only feature that uploads data off your device, and it is fully optional.

## Permissions

Pet Log requests only what it needs, on demand: access to a single photo you pick via the system photo picker, and notification permission (Android 13+) so reminders can ring. The app does not browse your photo library and does not access location, contacts, microphone, or camera.

## Children's data

Pet Log is not directed at children under 13.

## Contact

For questions about this policy, open an issue at <https://github.com/zenirl/petlog-site/issues> or email <support@zenirl.com>.

## Changes

If we change this policy, the "Last updated" date above will change and the new version will be published at <https://zenirl.github.io/petlog-site/privacy/>.

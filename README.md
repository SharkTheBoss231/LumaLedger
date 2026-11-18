# LumaLedger v1.1

**Two Currencies. One Clear Ledger.**

LumaLedger is an offline-first financial tracker for businesses and schools that handle Liberian Dollars (LRD) and United States Dollars (USD).

## v1.1 Offline Core
- IndexedDB local database (not LocalStorage) for business profiles and transactions
- Automatic one-time migration of v1.0 LocalStorage data on the same site origin; original v1.0 data is not deleted
- Progressive Web App manifest and service worker application-shell cache
- Core screens and chart work without third-party CDN scripts, fonts, or runtime services
- Up to 10 automatic local recovery snapshots
- Password-protected encrypted JSON backups (AES-256-GCM with PBKDF2-SHA-256)
- Backup import validation, preview, confirmation, and pre-import recovery snapshot
- v1.0 plain JSON backups remain importable
- Historical USD transactions retain the exchange rate used when entered
- CSV export includes the rate used and LRD equivalent

## Run locally
Use VS Code Live Server or another local HTTP server. Service workers require HTTPS or localhost; opening `index.html` directly with `file://` does not enable PWA offline caching.

## Publish with GitHub Pages
Upload all files in this folder to the repository root (or a dedicated branch/folder), then enable GitHub Pages from that branch. The first visit requires internet access so the app shell can be cached. After a successful first load, reload once while online, then test by switching the device to airplane mode.

## Data and safety notes
- Records are stored in the browser's IndexedDB on the current device and site origin. They do not automatically sync between devices.
- Local recovery snapshots are on the same device and are not a substitute for an exported backup.
- Encrypted backup passwords cannot be recovered. Store the password separately and securely.
- A browser reset, site-data clearing, device loss, or storage failure can still destroy local data. Export encrypted backups regularly and keep copies in a safe place.
- The first install/load on a new device needs internet access to fetch the app, unless the app files are transferred separately.
- Browser-side encryption protects exported backup files. IndexedDB itself is not encrypted at rest; use device-level security too.
- The app does not send records to a server and does not automatically synchronize devices.

## Exchange rates
The exchange rate is manually entered by the user. It is not a live market feed. Each new transaction stores the profile rate at entry time so later rate changes do not rewrite historical conversions.

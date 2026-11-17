# LumaLedger

**Two Currencies. One Clear Ledger.**

LumaLedger is a lightweight, mobile-friendly financial tracker for businesses that record transactions in Liberian Dollars (LRD) and United States Dollars (USD).

## Features in v1.0
- Multiple business profiles with separate transaction records
- Record income and expenses in LRD or USD
- Custom exchange rate per business profile
- Dashboard with balances and monthly totals
- Seven-day cash-flow chart
- Search and filter transaction history
- Monthly financial report
- Export transactions as CSV
- Download and restore a JSON backup
- Browser LocalStorage for offline use after the page assets have loaded

## Run locally
1. Download or clone this repository.
2. Open `index.html` in a modern browser, or use VS Code Live Server.
3. Add a business profile and set its exchange rate.
4. Start recording transactions.

## Publish with GitHub Pages
1. Create a GitHub repository named `lumaledger`.
2. Upload `index.html`, `style.css`, `script.js`, and `README.md` to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, select **Deploy from a branch**.
5. Select branch **main** and folder **/(root)**, then save.
6. Wait for GitHub Pages to publish the site.

## Important data note
Version 1.0 stores records in the current browser's LocalStorage. Data does not automatically synchronize between devices or users. Use **Settings → Download backup** regularly. CSV and backup files contain financial records, so store them securely.

The chart uses Chart.js from a CDN, and the interface uses Google Fonts. Those visual extras need an internet connection to load; the core transaction functions work in the browser without a backend.

## Exchange-rate note
The exchange rate is manually configured by the user for each profile. It is not a live market feed. Confirm the rate you want to use before recording transactions.

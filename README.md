# Anya Chat Intelligence

Static GitHub Pages dashboard and admin publisher for BITS Pilani Digital chat analytics.

## Entry points

- `index.html` — production dashboard; reads only encrypted dashboard data.
- `admin/index.html` — admin-only upload and publishing console.
- `data/chat_analytics.xlsx` — encrypted live workbook.
- `data/dashboard-config.json` — published data path, worksheet, and freshness metadata.

The dashboard is intentionally static: data is decrypted in the browser and no end-user upload control is exposed. The admin publisher retains only the live encrypted workbook. The visible product name is **Anya**; the encrypted payload format remains `AANYAENC1` for compatibility.

## Conversation-plan runway

The dashboard’s Commercial Runway uses the agreed contract: 65,000 included conversations annually, a ₹2,00,000 conversation bundle, a ₹2,00,000 annual platform fee, and ₹1,00,000 per additional 25,000 conversations. It calculates billable conversations as `ceil(Agent Messages / 5)` for each unique exported session, reflecting up to five user–Anya exchanges per billable conversation. The annualised figure uses the all-time published-data run rate and is an estimate, not an invoice.

## Workbook contract

The admin console accepts the `Chats Export` worksheet with these required columns:

- `Chat Created At (IST)`
- `Chat ID`
- `Agent Messages`
- `Total Tokens`
- `Summary`
- `Full Conversation`

Use the non-production fixture at `tests/fixtures/chat_analytics_fixture.xlsx` for validation work. Do not add raw exports, CSVs, credentials, or decrypted production data to this repository.

## Local checks

Run:

```bash
node tests/dashboard-smoke.test.js
node tests/admin-smoke.test.js
git diff --check
```

The smoke check validates inline JavaScript syntax, static HTML IDs, the production encryption marker, legacy-page removal, SheetJS integrity pinning, the sanitized workbook fixture, and key admin-token safeguards.

## Security boundary

GitHub Pages cannot provide server-side authentication or secret storage. Treat dashboard access as sensitive, use least-privilege GitHub tokens only in the admin console, rotate credentials outside the repository, and handle any Git-history purge as a separately reviewed operation.

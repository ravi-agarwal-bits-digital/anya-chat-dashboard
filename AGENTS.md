# Anya Chat Intelligence

## Project
Static HTML/CSS/JavaScript analytics dashboard for BITS Pilani Digital.

## Important files
- `index.html`: production chat analytics dashboard
- `admin/index.html` or `admin-index.html`: admin upload console
- `data/chat_analytics.xlsx`: encrypted live workbook
- `data/dashboard-config.json`: dashboard publication configuration, when available

## Architecture constraints
- Static GitHub Pages only.
- No backend, SSO, database, or Cloudflare.
- Preserve `AANYAENC1` encryption compatibility.
- Do not change the current password or password hash unless explicitly requested.
- Do not expose passwords, tokens, repository secrets, or strategic information.
- Do not add upload controls to the end-user dashboard.
- Admin validates and publishes data; dashboard handles analytics.
- Preserve the current light navy/gold BITS Pilani Digital theme.
- Visible product name is “Anya”; keep `AANYAENC1` unchanged internally.
- Do not introduce teal/turquoise styling.

## Working rules
- Inspect before editing.
- Explain root cause before making significant changes.
- Prefer the smallest safe patch.
- Never rewrite analytics calculations casually.
- Preserve existing filters, drawers, exports, encryption and workbook compatibility.
- Create a separate branch for meaningful changes.
- Do not commit directly to `main`.
- Do not modify `index.html` unless the task explicitly requires it.

## Required validation
After every code change:
1. Run JavaScript syntax validation.
2. Check duplicate static HTML IDs.
3. Confirm `AANYAENC1` remains present.
4. Confirm no plaintext password appears.
5. Test against the available chat analytics Excel fixture.
6. Review `git diff` before committing.

## Current analytics definitions
- Answer gap includes gated answers and generic deflections.
- Contact captured requires a usable phone number or valid email.
- Callback detection requires usable contact plus a valid callback value or explicit callback language.
- High-intent recovery means meaningful/high-intent chats without captured contact.
- Drop-off outcomes must be mutually exclusive and account for every analysed chat exactly once.

## Definition of done
A change is complete only when:
- requested behavior works
- existing analytics still work
- syntax and duplicate-ID checks pass
- responsive behavior is preserved
- the diff contains no unrelated changes
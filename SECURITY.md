# Security notes

## Scope

This is a static GitHub Pages deployment. It has no backend, SSO, database, or server-side session layer. Browser-side encryption protects the workbook at rest in the repository, but it is not a substitute for server-side authorization.

## Operating rules

- Never commit raw chat exports, CSVs, credentials, or decrypted data.
- Use a fine-grained GitHub token restricted to this repository and Contents write permission for publishing only.
- Keep the token session-only; do not persist it in browser storage.
- Keep `AANYAENC1` payload compatibility intact unless a migration has been explicitly planned and tested.
- Rotate compromised credentials outside the repository. Removing a secret from the current branch does not remove it from Git history.

## Incident response

If a credential, passphrase, or plaintext export is exposed:

1. Revoke/rotate the external credential immediately.
2. Restrict public access while investigating.
3. Preserve a private backup before any history rewrite.
4. Purge affected Git history through a reviewed force-push process.
5. Re-encrypt retained data with the approved replacement secret.

Do not put replacement secrets in issues, pull requests, commits, or dashboard source files.

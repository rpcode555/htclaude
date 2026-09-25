# Security policy

## Secrets

- Never commit `.env`, `server/.env`, Telegram session strings, Firebase service-account credentials, Supabase service-role keys, or live developer API keys.
- Keep only placeholder values in `.env.example`.
- Store runtime metadata in an ignored runtime database or an authenticated server-side database. The tracked database must be a sanitized seed with no user records or secrets.
- Rotate a credential immediately if it has ever been committed, even if it is later removed from the current branch.

## Required incident response for an exposed credential

1. Revoke or rotate the exposed credential at its provider.
2. Remove the affected runtime data and replace it with a sanitized seed.
3. Ask repository maintainers to purge it from Git history. History rewriting is disruptive and must be coordinated before force-pushing.
4. Review access logs and invalidate any sessions or tokens derived from the credential.
5. Run the test suite, build, and secret scan before publishing the cleaned history.

A typical maintainer-only history cleanup removes the runtime database from all historical commits with `git filter-repo`, expires reflogs, verifies the rewritten repository, and force-pushes all affected refs. Take a backup and require explicit approval before running those destructive commands.

## Reporting a vulnerability

Do not open a public issue containing credentials, session strings, personal file metadata, or a working exploit. Revoke any exposed secret first, then share a minimal reproduction and affected versions through the repository owner's private security reporting channel.

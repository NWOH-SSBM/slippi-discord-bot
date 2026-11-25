# Contributing

Thanks for helping improve the NWOH-SSBM Slippi Discord Bot.

## Development expectations

- Use the Node.js version specified in `.node-version`.
- Keep changes focused and maintainable.
- Add or update tests when changing behavior.
- Run the following checks before opening a pull request:

  ```bash
  npm run check
  npm test
  npm run format:check
  ```

- Do not commit credentials, tokens, local `.env` files, database files, or production data.
- Avoid adding Discord Gateway intents or bot permissions unless a feature requires them.
- Document configuration changes and operational implications.

## Pull requests

1. Create a branch from the latest `main`.
2. Make the change and add tests where applicable.
3. Open a pull request describing the motivation, implementation, and testing performed.
4. Resolve review conversations and obtain the required approval before merging.

The `main` branch is protected. Organization administrators have a ruleset bypass for exceptional maintenance, but the normal pull-request workflow is preferred.

## License

By submitting a contribution, you agree that it will be distributed under this project's GNU General Public License version 3.0 only. You retain copyright in your contribution; no separate copyright assignment is required.

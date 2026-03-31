# Claude Code — Project Rules

## Security

Do NOT read `.env` or `.env.*` files — they contain secrets. If you need to know about environment variables, ask the user.

## Commits

Do NOT add `Co-Authored-By: Claude` or any Anthropic authorship lines to commits.
This causes issues on some services. Commits should be authored only by the human developer.

## Environment

All work happens exclusively inside Docker containers. There are no local Node/npm installs — do not attempt to run `npm`, `node`, or any project commands directly on the host machine.

### Docker setup

- **Production:** `docker compose up` (uses `compose.yml` + `Dockerfile`)
- **Development:** `docker compose -f compose.yml -f compose.dev.yml up` (mounts `src/`, `public/`, config files; runs `npm run dev`)

### Running commands inside the container

```bash
# Execute a command in the running dev container
docker compose -f compose.yml -f compose.dev.yml exec app <command>

# Example: install a package
docker compose -f compose.yml -f compose.dev.yml exec app npm install <package>

# Run a one-off command (container not required to be up)
docker compose -f compose.yml -f compose.dev.yml run --rm app <command>
```

Always prefer `exec` when the container is already running, and `run --rm` for one-off tasks.

# Claude Code — Project Rules

## Security

Do NOT read `.env` or `.env.*` files — they contain secrets. If you need to know about environment variables, ask the user.

## Commits

Do NOT add `Co-Authored-By: Claude` or any Anthropic authorship lines to commits.
This causes issues on some services. Commits should be authored only by the human developer.

## Versioning & Releases

With every push, create a git version tag following [Semantic Versioning](https://semver.org/):
- **Patch** (`x.y.Z`) — bug fixes, minor tweaks, dependency updates
- **Minor** (`x.Y.0`) — new features, backward-compatible additions
- **Major** (`X.0.0`) — breaking changes, major rewrites

```bash
git tag v1.2.3
git push origin v1.2.3
```

For **minor and major** releases, also create a GitHub release with release notes:

```bash
gh release create v1.2.0 --title "v1.2.0 — Short description" --notes "$(cat <<'EOF'
## What's new
- Feature or change description

## Bug fixes
- Fix description

## Breaking changes (major only)
- Description of breaking change
EOF
)"
```

Patch releases do not require release notes — a tag alone is sufficient.

Always update the `version` field in `package.json` to match the new tag before committing.

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

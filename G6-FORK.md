# About this fork

Based on [Evolution API](https://github.com/evolution-foundation/evolution-api) 2.3.7.
Upstream's LICENSE, NOTICE and TRADEMARKS files are unchanged and still apply.

## What is different from upstream 2.3.7

One fix, in the bundled Baileys 7.0.0-rc.9 (`patches/baileys+7.0.0-rc.9.patch`):

- WhatsApp sends contacts' Status updates to linked devices as a `<status>` stanza.
  Upstream never acknowledges it, so WhatsApp holds back incoming messages and closes
  the connection every 50 minutes. This fork acknowledges it.
- One failing stanza no longer stops the rest of the offline backlog.

Evolution's own source is untouched. Build label: `2.3.7-g6.1`.
Background: [Baileys #2858](https://github.com/WhiskeySockets/Baileys/issues/2858),
[Evolution #2778](https://github.com/evolution-foundation/evolution-api/issues/2778).

Not covered: the rarer disconnects whose log line says `ack class="notification"`.

## Deploy

Image: `ghcr.io/svsvssiva/evo-server-fork:2.3.7-g6.1`

1. On the server, sign in to GHCR once. The repo is private, so this needs a GitHub
   personal access token (classic) with only the `read:packages` scope. Paste the
   token when asked for a password:

   ```bash
   docker login ghcr.io -u svsvssiva
   ```

2. Use the same compose file and environment as the existing servers. Change only the image:

   ```yaml
   image: ghcr.io/svsvssiva/evo-server-fork:2.3.7-g6.1
   ```

3. Start it and open the API's home page. It must report `"version":"2.3.7-g6.1"`.

To build on the server instead, clone this repo there and run:

```bash
docker build -t evo-server-fork:2.3.7-g6.1 .
```

## Verify the fix on a live number

The fix shows as an absence. Give it at least three hours per test number.

Count the Status disconnects. Unpatched servers show about one per number every 50 minutes:

```bash
docker logs --since 3h <evolution-container> 2>&1 | grep 'stream errored out' | grep -c '"class":"status"'
```

Expected: `0`.

In GChat, the test business should stop logging a disconnect every 50 minutes, and
`scripts/chat-latency-report.sh "<business>"` should show no `sweep` rows and a p90 of a few seconds.

## Roll back

Move the number back to its previous server in GChat (superadmin, Move server) and scan the QR again.

## Prove the patch without WhatsApp

```bash
docker run --rm --entrypoint node -v "$PWD/patches:/evolution/patches:ro" \
  ghcr.io/svsvssiva/evo-server-fork:2.3.7-g6.1 \
  --test --test-force-exit patches/baileys-status-ack.test.mjs
```

Expected: 3 of 3 pass. The official `evoapicloud/evolution-api:v2.3.7` image fails all three.

## Release a new build

Commit, then push a tag shaped like `2.3.7-g6.2`. GitHub Actions builds the image, runs
the test inside it and publishes it to GHCR under that tag.

## Retire this fork

When Evolution releases a version whose Baileys includes the `<status>` fix, switch back to the official image.

# patches/

`patch-package` patches for third-party dependencies. The `postinstall` hook in
`package.json` applies them on every `npm ci` / `npm install`, including inside the
Docker builder, which copies this directory before `npm ci`.

## baileys+7.0.0-rc.9.patch

Makes Baileys acknowledge WhatsApp's top-level `<status>` stanza and keeps the
offline queue running when one stanza fails. Without it WhatsApp holds back inbound
messages and closes the stream every 50 minutes (Baileys #2858, Evolution #2778).

The patch is tied to Baileys 7.0.0-rc.9. `patch-package --error-on-fail` and a guard
in the `Dockerfile` stop the build if it no longer applies. Remove it when Evolution
ships a Baileys release that contains the fix.

## baileys-status-ack.test.mjs

Proof for the patch. It never contacts WhatsApp. Run it inside any Evolution image:

```bash
docker run --rm --entrypoint node -v "$PWD/patches:/evolution/patches:ro" <image> \
  --test --test-force-exit patches/baileys-status-ack.test.mjs
```

The official `evoapicloud/evolution-api:v2.3.7` image fails all three tests.

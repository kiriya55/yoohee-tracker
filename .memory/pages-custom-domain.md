---
name: Pages custom domain diagnosis
description: Hosting topology and distinction between deployment health and custom-domain TLS.
type: project
---

## Why
The site is hosted at `yoohee-tracker.pages.dev`; `yoohee-tracker.kiriya55.cn` is a CNAME to it. GitHub Cloudflare Pages check-runs expose deployment results separately from the resource-sync Action. A successful resource Action does not verify the custom domain.

## How to apply
Compare HTTPS on the pages.dev hostname and custom hostname before changing application code. If pages.dev serves the app but custom-domain TLS fails before HTTP, inspect Pages custom-domain association/status, certificate issuance/renewal and DNS/CAA in Cloudflare. Do not infer an exact dashboard cause solely from a failed handshake.

## Related
[[resource-sync-noise]]

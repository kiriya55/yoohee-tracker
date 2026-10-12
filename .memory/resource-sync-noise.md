---
name: Resource sync noise beyond timestamps
description: Announcement IDs and non-gacha timesets can create low-value automated commits despite timestamp filtering.
type: project
---

## Why
`scripts/classify-staged-changes.mjs` ignores only `verifiedAt` and `generatedAt`. Resource indexes also contain `updateSignals.haoplay.sourceNoticeIds` and general announcement timesets (illustration contests, outfits). Changes to these trigger substantive commits and refresh 219 timestamps per index. App runtime only carries updateSignals through parsing; pool schedule matching uses poolType and upItemIds. Genuine gacha schedule/name/image updates must not be suppressed.

## How to apply
When reducing auto-commit noise, distinguish diagnostic notice IDs and non-gacha announcements from user-facing catalog, names, images and gacha schedules. Avoid blanket-ignore of timesets or rate-up signals. Preserve timestamps on otherwise unchanged entries to keep real diffs readable.

## Related
[[pages-custom-domain]]

# RFC-015: Replace polling with push sync

**Status:** In review, updated 12 October 2026. **Author:** Jonas Weber. **Reviewers:** Marcus Lee, Aisha Khan (security), platform on-call.

## Context

Skiff learns about changes made elsewhere (a transcript finishing, a teammate editing a note, a theme being assigned) by polling. While the app is in the foreground it calls `GET /v2/sync/pull` every 60 seconds, as described in [Offline sync design](doc:Offline sync design). In the 2026.9 release data, 91% of those calls returned no changes. They are also the largest single part of sync's battery use, 1.3% of a typical day, and they account for 38% of requests to the sync endpoints.

In the background we depend on the operating system's schedule, which gives us a pull every 15 minutes at best and often much less on iOS. A transcript that finishes at 14:02 can appear on a locked phone at 14:40.

## Proposal

Tidepool sends a silent push message to a user's devices whenever the sync log for their workspace advances: APNs background notifications on iOS and high-priority FCM data messages on Android. The payload carries no content, only a hashed workspace id and the new log position. On receipt the app runs a pull. The foreground timer drops from 60 seconds to 5 minutes and stays as a safety net, because push delivery is not guaranteed.

## Options compared

:::table[Ways to learn about changes]{width=wide caption=bottom}
| Option | Typical latency | Battery | Server cost | Works when app is suspended |
| :----- | --------------: | :------ | :---------- | :-------------------------- |
| Poll every 60 s (today) | 30 s | Highest | High: 38% of sync requests | No |
| Silent push, 5 min fallback poll | 2 to 5 s | Lowest | Low: one message per change | Yes, throttled by iOS |
| Server-sent events while foreground | 1 s | Medium | Medium: one open connection per device | No |
| WebSocket | 1 s | Medium | Highest: stateful gateway | No |
:::

Silent push is the only option that helps when the app is not in front of the user.

## Prototype results

For two weeks, 40 internal devices (22 iOS, 18 Android) received a silent push for every sync log advance in the Acme workspace, and logged when it arrived.

| | iOS | Android |
| :-- | --: | ------: |
| Delivered, app in foreground | 99.8% | 99.6% |
| Delivered, app in background | 94% | 97% |
| Median latency | 3.1 s | 2.4 s |
| p95 latency | 11 s | 7 s |

iOS background delivery fell to 71% for devices in low power mode. That is acceptable only because the fallback poll remains.

## Rollout

Behind a remote config switch, per platform, in three steps:

1. **2026.11 beta:** the app registers for push and runs a pull on receipt, but the 60-second timer stays.
2. **2026.12, 20%:** the foreground timer moves to 5 minutes for the 20% cohort.
3. **2027.1, everyone**, if the cohort's save-to-visible p95 is no worse than the 19 s measured in September and its sync battery share is below 1.0%.

## Open questions

1. **Can the 60-second timer go entirely?** Not yet. At 94% background delivery we keep a 5-minute foreground fallback. Revisit after a month of production data.
2. **How do we avoid storms?** Messages are collapsed per device (`apns-collapse-id`, FCM `collapse_key`), which leaves at most one message in flight.
3. **Who owns the tokens?** Device tokens are stored in the platform team's push registry and deleted when APNs or FCM reports them invalid. Tokens of devices not seen for 90 days are deleted, matching the tombstone window.

:::callout[Settled]{type=info}
The payload names a workspace by a salted hash, not its id. Aisha accepted this on 30 September.
:::

:::callout[Harbourview Health]{type=info}
Confirmed with their IT team on 9 October: background notifications are allowed on managed iPhones, and blocked inside the Android work profile. Their Android users will keep the 60-second timer, so the switch must be per device policy and not only per platform.
:::

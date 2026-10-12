# Q1 2027 themes and bets

Q1 runs 4 January to 26 March, thirteen weeks. We have 16 engineers (11 on web and platform, 5 on mobile), 2 designers and 1 researcher. After the 25% platform allowance and the on-call rota, roughly 140 engineer-weeks are available for bets. The year-level plan is in [2027 roadmap overview](doc:2027 roadmap overview); this document is the working detail for the quarter.

## Themes

:::cards
### Themes people trust

Clustering v2 replaces the keyword model with embeddings and shows why an item landed where it did. Success is measured on a labelled set of 1,200 items from six customers, not on opinion.

### Capture in the field

Voice notes in Skiff turn a recording into a transcript and a candidate theme within two minutes of syncing. This is the feature Lantern Logistics and Northwind Retail asked for first.

### Fewer clicks to decide

Merge, split and move-to-theme need to work on forty items at a time with the keyboard. The research synthesis found the one-at-a-time flow was the most common complaint from heavy users.

### Ready for regulated buyers

Region-pinned workspaces moved to Q2, but the design has to be settled in Q1 so the storage changes in clustering v2 do not have to be redone. Aisha's team needs two engineer-weeks of design time from the platform squad.
:::

## Bets and sizing

:::table[Q1 bets]{width=wide caption=bottom}
| Bet | Engineer-weeks | Design weeks | Confidence | Measure of success |
| :-- | -------------: | -----------: | :--------- | :----------------- |
| Feedback clustering v2 | 70 | 8 | Medium | 95% of labelled items grouped as a person would |
| Skiff voice notes | 38 | 6 | Medium | 80% of notes transcribed in under 2 minutes |
| Bulk theme actions | 18 | 4 | High | Median triage session 30% shorter |
| Region-pinning design | 2 | 0 | High | Design approved by Aisha and Marcus |
| Slack integration | 12 | 2 | Low | 100 workspaces connected by 26 March |
:::

The total is 140 engineer-weeks, which is all of it. That leaves no slack, which is why the Slack integration is conditional: see [Spec: Slack integration](doc:Spec: Slack integration). Voice notes gave up two weeks to pay for region-pinning design, after Jonas confirmed the transcript review screen can slip to Q2.

## Risks

- Transcription cost per minute is unknown at scale. We have a quote from one vendor and a self-hosted option to test.
- The labelled set for clustering is biased towards English. We will add German and French samples from Northwind Retail before sign-off.
- Pinecrest Bank's renewal is on 1 April. If region pinning slips beyond Q2, we lose negotiating position.

## Checkpoints

- **30 January:** clustering v2 prototype scored on the labelled set. Below 85%, we stop and reconsider the approach.
- **27 February:** voice notes in TestFlight and the Play internal track for Lantern Logistics.
- **13 March:** go or no-go on Slack, based on the clustering score and remaining capacity.

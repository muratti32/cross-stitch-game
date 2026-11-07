# Run Seasonal Events without event currency, Coin rewards, or streaks

**Status: proposed** (issue #286; depends on Showcase Decor, issue #283)

We add Seasonal Events as a Stitch Coin sink that keeps the game's relaxed tone. An event is operator-scheduled and server-authoritative. It lasts three to four weeks, never overlaps another, and runs about four times a year. It features about six event-tagged Official Patterns, two of them free. The rest follow the normal Pattern Unlock Price Tiers. No event grants temporary access, because access that ends with the event would feel like a lock.

Event Progress counts successful Stitch Actions on the event's Patterns and reuses the Daily Task evidence path and its deduplication. Reaching 3,000 grants one free item of that event's Showcase Decor. Event Progress never grants Stitch Coin, because an event faucet without a matching sink inflates the economy after the event ends. It never requires consecutive days, matching the no-streak rule of Daily Tasks, and it resets when the event ends.

The Event Showcase Shop sells four to six event-themed Showcase Decor items for 80–200 Stitch Coin each, about 600–900 in total. That total is close to the Daily Task income over the event window. There is no event token, because ADR-0011 keeps exactly two currencies. Event decor may be sold again when the event recurs, so missing a year is not a permanent loss.

Event titles and short descriptions follow the Catalog Category model: operator-managed codes with a label per locale. An event cannot become active until every released App Display Language has its labels. This stays within ADR-0051 and needs no app release per event. Guest Players take part through the Guest Ledger (ADR-0026). Guest availability waits on #281.

## Considered options

- Event token currency: rejected because it adds a third balance and leftover-token inflation.
- Coin reward for Event Progress: rejected because it is a new faucet working against the sink's purpose.
- Bundling event text as app strings: rejected because every event would need a store release.
- Exclusive decor that never returns: rejected because the FOMO pressure conflicts with the relaxed tone.

# Mirror the six App Store locales on Google Play

**Status: accepted** — supersedes the "deferred" Google Play option in ADR-0066.

Google Play gains the six locales ADR-0066 added to the App Store, taking it from 33 to 39: `tr-TR`, `en-GB`, `en-CA`, `en-AU`, `fr-CA` and `es-419`. Play offers no `es-MX`; `es-419` (Latin America) is the Play listing Mexican users see, so it stands in for it. ADR-0066 deferred this because Play had no push tooling and every locale was a manual paste; the `play-store` MCP server (`play-store-mcp`) now writes listings through the Android Publisher API, so the cost no longer lands on a human.

Each new listing takes its title and short description from its parent's canonical file in `metadata/play/` (`en-US`, `fr-FR`, `es-ES`), and its full description from the parent's live Play text, because the repository deliberately keeps the older locales' full descriptions empty. The English variants use British spelling (`Colour`, `colour`). `tr-TR` uses the App Store name `Kanaviçe&Etamin Nakış Oyunu` and a Turkish translation of the `en-US` Play description, using the app's own Turkish terms (`Kişisel Desen`, `Premium Üyelik`, `AI Kredisi`, `Stitch Coin`). Unlike the older 33, the six files carry their full description, since a translated or re-spelled text that exists only in the console cannot be regenerated.

Screenshots are not part of this decision: new Play listings fall back to the default-language (`en-US`) graphics.

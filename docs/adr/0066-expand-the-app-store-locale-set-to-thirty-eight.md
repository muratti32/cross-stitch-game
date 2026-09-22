# Expand the App Store locale set to thirty-eight

**Status: accepted**

The App Store listing gains six localizations — `tr`, `en-GB`, `en-CA`, `en-AU`, `fr-CA`, `es-MX` — taking the set from 32 to 38. Google Play keeps its 33 locales for now; its listing is still entered by hand in the console under ADR-0065, and the six additions are an App Store search decision, not a translation decision.

The reason to add a locale here is not that users cannot read English. It is that Apple indexes a separate hundred-character `keywords` bag per localization, and a storefront reads only the localizations mapped to it. Apple documents which language a storefront *displays* and says nothing about which it *indexes*; the mapping below is industry observation (AppTweak, MobileAction, Phiture), repeatedly tested but never confirmed by Apple, and is recorded here as an assumption the ranking data can later falsify. Under it the US storefront reads `en-US` and `es-MX`, the UK reads `en-GB` and `en-AU`, Australia reads the same pair, Canada reads `en-CA` and `fr-CA`, and Ireland, Singapore, South Africa and India read `en-GB`.

That mapping decides what goes in each bag. A localization *replaces* the primary language in its storefront rather than adding to it, so a bag with no partner must be complete on its own: `en-CA`, whose only partner carries French, repeats the `en-US` core terms with British spellings, and `fr-CA` and `es-MX` repeat their French and Spanish cores rather than acting as overflow. Where two English bags cover each other — `en-GB` and `en-AU` in both the UK and Australia — the core sits in `en-GB` and `en-AU` holds terms that appear nowhere else (`diamond`, `tapestry`, `quilting`), which buys a second hundred characters in both storefronts. Keywords never combine across localizations, so no bag may hold half a phrase.

Turkish is the one locale added for its own market rather than for a bag. The research found two head terms rather than one, `kanaviçe` and `etamin`, both returning a full cross-stitch result set, and a false friend: `goblen` is the dominant Turkish retail word for the craft and returns nothing but `Goblin*` idle games in the App Store index, so it is excluded despite its commercial weight. The name `Kanaviçe&Etamin Nakış Oyunu` carries both head terms.

The listing name and subtitle stay identical to their parent locale in the five variant locales, and only the keyword bag and the British spelling of the subtitle differ. Screenshots are not part of this decision: Apple documents that a new localization inherits the primary language's screenshots, but only for the console flow, and whether a localization created through the API inherits them is unverified. The rollout therefore adds `tr` alone first and checks the screenshot sets before the remaining five follow.

## Considered options

- Add all six with disjoint keyword bags, as first planned: rejected once the storefront mapping was checked, because a disjoint `en-GB` bag removes `embroidery`, `needlework`, `craft` and `pattern` from the UK storefront instead of adding to them.
- Add `en-AU` only, and leave `en-GB` and `en-CA` alone: rejected, because Canada then keeps no English bag of its own once `fr-CA` exists, and the UK keeps whichever bag the unverified half of the mapping says it keeps.
- Add the matching six locales to Google Play at the same time: deferred, because Play has no push tooling here and the existing 33 locales are already a manual paste; the cost lands on a human, not a script.
- Localize `description` per variant locale: rejected, because Apple does not index it; the English variants take the `en-US` text with British spellings, and `fr-CA` and `es-MX` take their parent's text unchanged.
- Research all six markets to the depth of the first ten: rejected for the five variant locales, whose names and subtitles are inherited, and accepted for `tr`, which is a greenfield market with no existing localization and no ranking baseline.

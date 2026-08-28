# Localize operator-managed catalog taxonomy

Every released App Display Language includes localized labels for all active Catalog Categories and Catalog Tags. Both taxonomy types keep stable language-neutral codes and operator-managed per-locale labels; player-authored and moderator-authored text remains in its original language under ADR-0051.

English is the required source label. A new or relabeled taxonomy item cannot become active, and a new App Display Language cannot ship, until labels exist for every released language. Runtime lookup still falls back to English for resilience, but any fallback caused by unexpectedly incomplete active data raises an operational error rather than counting as a valid translation.

This extends ADR-0040 and replaces only its decision to keep Catalog Category labels single-valued. We accept the backend schema, operator workflow, and release-coordination cost because an otherwise localized catalog would mix the player's App Display Language with English taxonomy labels.

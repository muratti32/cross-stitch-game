# Redirect pending rewarded-ad grants after Guest Economy Promotion

A Guest can sign in while a rewarded-ad attempt is still verifying. The grant for that attempt arrives later, through the AdMob SSV callback or the client claim, and today it credits the attempt's owner, the Guest. After a Guest Economy Promotion the Guest Ledger is closed, so those Coins would be stranded.

We do not make the player wait. Sign-in is never blocked on an ad, and the preview is not delayed until pending attempts settle. Instead the Guest Promotion Preview reports how many unconsumed, unexpired rewarded-ad attempts the Guest owns, and the disclosure tells the player those rewards will arrive on the account. The backend counts these attempts itself, because the device cannot enumerate them after an app restart and a client-supplied list would not be trusted anyway.

Every rewarded-ad grant resolves its recipient inside the grant transaction. When the attempt's owner is a Guest whose transfer package is committed in economy mode, the grant, its Reward Day pool consumption, and its balance change go to the target Registered Account. The lookup takes a share lock on the Guest's transfer package row, which serializes it against the promotion commit: a grant that starts first lands on the Guest Ledger before the commit's serializable read and is carried by the commit's retry, and a grant that starts later is redirected. Both the SSV path and the client claim path use this one rule, and both stay idempotent by source key (`ad:<transactionId>`, `ad_client:<nonce>`). The target account may submit the client claim for a nonce its promoted Guest opened.

A Guest Data-Only Promotion transfers no reward value, so its commit expires the Guest's pending attempts and their later grants are refused.

The redirected grant obeys the target account's Reward Day pool, so an account that already reached its daily ad limit receives no Coins for the redirected attempt. Attempt status polling stays owner-scoped: the account receives 404 for a Guest-owned attempt, the client treats that as terminal, and the balance refresh shows the redirected Coins.

This extends ADR-0026, ADR-0027 and ADR-0033 for issue #281.

# OAS-938 Performative Matcha Multiplayer Join

Manual Studio/Appium regression assets for the Performative Matcha lobby join
flow.

Run the primary lane with `OASIZ_TEST_EMAIL=oasiztest+2@gmail.com`. Run the
secondary lane with an override such as
`OASIZ_TEST_EMAIL=oasiztest+1@gmail.com`. In both cases the password must come
from `OASIZ_TEST_PASSWORD`.

The two lanes are intended to overlap: keep the primary player waiting in the
public lobby while the secondary lane joins from Club Jibble. The focused SDK
unit regression for the root cause lives in
`packages/sdk/tests/sdk.test.ts`.

When importing these files through `oasiz test-case`, keep
`launch-manifest.json` metadata-only. The CLI rewrites the first Appium
`deep_link` command when a manifest contains `deep_link`, `uri`, or `game_id`;
this workflow must keep the explicit login route as the first deep link so
authentication happens before any game route is opened.

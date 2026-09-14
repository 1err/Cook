# Instacart shopping alternative

User-approved scope: add the discussed official Instacart shoppable-list flow alongside the current Weee experience. Preserve all existing local changes and Weee behavior. No deployment, scraping changes, checkout automation, or account creation. The user has no API key and requests a setup-ready implementation.

## Design

- Web and mobile shopping screens get an independent Instacart panel. Original mode exports aggregated ingredients; smart mode exports visible unchecked purchase items. No Weee lookup or LLM call is required to use Instacart.
- Use a deliberate two-step action: create shopping link, then open the returned Instacart page. This avoids browser popup blocking and lets the user control external navigation.
- The panel explains that users review products, quantities, prices and checkout on Instacart. Opening it never marks items purchased or changes Weee progress.
- `POST /shopping-list/instacart` requires existing cookie/bearer auth. Request: `{title: string, items: [{name: string, quantity: string}]}`. Response: `{url: string}`. No user credentials or private recipe IDs leave the server.
- A server-only API key and explicit development/production environment select a fixed official API origin. Upstream requests use a bounded timeout, no redirect following, and sanitized typed errors. Missing configuration returns `instacart_not_configured` with HTTP 503. No fabricated live links.
- Preserve source quantity text in item display text; structured measurements are sent only when unambiguous and supported. Users review final package quantities on Instacart.
- Validate HTTPS Instacart result hosts on server and clients. UI clears generated links and suppresses late responses after list/week changes or unmounts. Disable duplicate requests and empty-list export.
- All new visible strings have English and Chinese translations. Mobile uses existing theme and button components; web uses its existing CSS conventions.

## Verification

Tests cover authentication, validation, upstream contract, absent/bad keys, timeout/rate-limit failures, unsafe links, source quantities, checked/hidden exclusion, late responses, duplicate clicks, open failures, and preservation of the existing Weee controls. Run shared/API tests, web/mobile shopping regressions, backend shopping/provider regressions, type checks and the web build. Browser-check the real unconfigured state and the successful flow with explicitly mocked provider responses. Live provider verification remains pending a developer API key.

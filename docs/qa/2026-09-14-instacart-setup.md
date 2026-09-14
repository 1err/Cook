# Test and connect Instacart

Cooking now offers an independent Instacart shopping panel on web and iOS. Original mode sends the aggregated list; smart mode excludes hidden and already-have items. Weee lookup, selections and progress remain separate. Users review and buy on Instacart. The feature does not place orders or write into an existing cart.

## Current verification boundary

No Instacart account or key is configured. Automated tests exercise provider requests using mocked responses. A successful simulated link is not a real shopping list. Real list generation, item matching, final quantities, delivery availability and checkout must be checked with the developer account.

## Connect a development key

**Access blocker verified September 14, 2026:** the [official Developer Platform application page](https://company.instacart.com/business/developers) says new applications are closed and no waitlist is available. The steps below apply after developer access is granted; the dashboard instructions alone do not provide a new-account signup path. No exception route or reopening date has been confirmed. Live testing is blocked by obtaining developer access, not just by entering a key.

1. Sign up for the [Instacart Developer Platform](https://docs.instacart.com/developer_platform_api/get_started/api-keys) and obtain a development API key.
2. Put `INSTACART_API_KEY` in the backend's private `backend/.env` file. Set `INSTACART_ENVIRONMENT=development`. Never put the key in a `NEXT_PUBLIC_` or `EXPO_PUBLIC_` variable, source control, or a screenshot.
3. Recreate the local backend after configuration. Existing Docker Compose already reads `backend/.env`; no new forwarding is needed. A native local backend reads the same file when started from `backend/`.
4. Open Shopping with a populated week. Select **Shop on Instacart**, wait for the list-ready message, then select **Shop on Instacart** again. The first action generates a link; the second opens it. Test both original and smart modes, with one item checked and one hidden.
5. On Instacart choose a store and check products and quantities. Freeform quantities such as `1 bag` or `2 cups + 50 g` are preserved as display text rather than guessed package counts. Review them before buying. A development link should not be assumed to support real fulfillment.

## Production

Request production access through Instacart's [approval process](https://docs.instacart.com/developer_platform_api/guide/concepts/launch_activities/approval_process/). Prepare a short app demonstration and a generated landing-page link. Configure an approved production key in the server's secret environment and set `INSTACART_ENVIRONMENT=production`. Deployment was not part of this change.

## Expected errors

- No key, invalid key, or inactive provider access: the panel says Instacart is not connected yet; Weee remains usable.
- Provider timeout, outage, invalid result, or rate limit: retryable message with no invented link.
- Empty remaining list: disabled shopping action.
- Stale smart list: refresh before exporting.
- Change week, list mode, checked/hidden items, or quantities while creating: discard the old response.

## Integration contract

Authenticated `POST /shopping-list/instacart` takes `{title, items: [{name, quantity}]}` and returns `{url}`. App limits: 1–100 items, title 1–120 characters, name 1–200 characters, quantity up to 200 characters. It calls the official `/idp/v1/products/products_link` endpoint, with `link_type=shopping_list`, seven-day expiry and `line_item_measurements` only for safely recognized quantities/units. English request locale supports UTF-8 names; the app does not translate ingredient names.

The key defaults to the development origin `connect.dev.instacart.tools`; production uses `connect.instacart.com`. There is a 20-second overall provider deadline, with shorter connection/request timeouts. Returned URLs must be HTTPS on exactly `www.instacart.com` or `instacart.com`, without credentials or nonstandard ports. If a real development response uses a different landing-page host, verify it with Instacart before extending the allowlist.

Links live only in the current panel session and reset when its inputs change. No provider responses, keys or ingredient lists are logged by the adapter, and there is no persistent shopping-link cache or new database migration.

Brand assets were copied unmodified from [Instacart's official logo archive](https://docs.instacart.com/assets/files/Instacart_logos-57199d80485c89007384e11523992fe8.zip). The main CTA follows the [published button design](https://docs.instacart.com/developer_platform_api/guide/concepts/design/cta_design). The approved English CTA stays in English in both UI locales; supporting text is translated.

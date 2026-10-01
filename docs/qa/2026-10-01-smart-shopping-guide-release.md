# Smart shopping guide release — October 1, 2026

The website smart shopping controls now explain the recommended sequence in English and Chinese: check off ingredients already at home before loading products, load Weee picks and choose products, then review/copy a request and paste/send it in Muse. Numbered steps sit beneath the controls in three desktop columns and stack on phones.

Production application source: `737553f5163e0ff2ccc2b6dee58ad7328198dba1`. Vercel deployment: `dpl_ACp7BxcHJxfTdvKeSQ119r39SueK`. Both `chef-world.com` and `www.chef-world.com` are READY on this deployment. Rollback: `dpl_PkRxsiYXCeoxqXeLWmnBXax7BqRb`.

The isolated release starts from `7abb9485199e1b4656c85c8cd02722a6c77ed9f9`, whose 289 frontend upload files all match the previous production source. The existing recipe source-link editor, shopping progress, and responsive controls are preserved. Application changes are limited to the guide component/styles and seven translation keys per language; backend services were not deployed.

Validation passed: 854 website tests, the local and Vercel production builds, exact SHA-1/SHA-256 checks for all 289 uploaded source files, and six browser cases each on the local production build, protected candidate, and public live deployment. Each set covers English and Chinese at 1440, 390, and 320 px, checks accessibility/overflow/console health, confirms a checked ingredient is excluded from product lookup, selects an alternative product, and verifies the copied Muse request contains that product and omits the checked ingredient. API responses are fixtures; page assets are the actual built/deployed assets. These checks did not execute a real Muse task or mutate a retailer cart.

After promotion, 44 public page/script/style requests across both domains returned 200 and the deployed bundles contained both language versions of the guide. The bounded five-minute website error-log scan returned zero entries.

Evidence: `/private/tmp/chef-shopping-guide-release-20261001` (`release-receipt.json`, `upload-source-proof.json`, `public-checks.json`, and local/candidate/live browser results and screenshots).

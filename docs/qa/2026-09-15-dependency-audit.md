# Dependency and delivery verification — 2026-09-15

The JavaScript high/critical gate and the Python runtime dependency gate both pass locally. This is not a claim that every dependency is free of advisories or that a production image has been deployed.

## Declared and resolved versions

| Component | Final version and scope |
| --- | --- |
| Next.js | `15.5.24`, root tooling and web app |
| React / React DOM | `19.1.5`, root/web; hoisted web testing tools resolve the same instances |
| Native React | `19.1.0`, unchanged; React Native `0.81.5` and Expo `54.0.37` retained |
| React types | `@types/react 19.1.17`, `@types/react-dom 19.1.11`; manifests constrain `~19.1.0` |
| Metro family | All 14 `metro` / `metro-*` packages pinned to `0.83.8` through coordinated overrides |
| PostCSS | `8.5.28`, resolved from the `^8.5.23` security override |
| Other compatible patches | `shell-quote 1.10.0`; `brace-expansion 1.1.18 / 2.1.4 / 5.0.9`; `browserslist 4.28.9`; `js-yaml 3.15.2`; `ws 6.2.6 / 7.5.13`; `@xmldom/xmldom 0.8.15 / 0.9.12`; Vitest `4.1.11` |
| Python runtime patches | FastAPI `0.141.1`, Starlette `1.3.1`, python-multipart `0.0.32`, python-dotenv `1.2.2`, PyJWT `2.13.0` |
| Retained Python compatibility pins | OpenAI `1.55.3`, HTTPX `0.27.2`, Pydantic `2.10.3` |
| Package manager | npm `11.19.1`; Node `>=22.9.0`, with Node 22 used in CI and web containers |

Next 15 App Router requires React 19. The two client friend routes now use `useParams`, and obsolete local React aliases were removed from the web TypeScript configuration. Native React remains separately pinned by Metro. See the [official Next 15 migration guide](https://nextjs.org/docs/app/guides/upgrading/version-15), [Next security fix](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4), and [React patched release guidance](https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components).

Metro's [0.83.8 maintenance release](https://github.com/react/metro/releases/tag/v0.83.8) replaces `image-size` to address its parser advisories. The resolved graph contains no `image-size`. This avoids an Expo SDK major upgrade. Python patch references include [Starlette's form-parsing advisory](https://github.com/advisories/GHSA-82w8-qh3p-5jfq), [python-multipart releases](https://pypi.org/project/python-multipart/), [python-dotenv's advisory](https://github.com/advisories/GHSA-mf9w-mj56-hr94), and [PyJWT 2.13.0](https://pypi.org/project/PyJWT/2.13.0/).

## Scan results and remaining findings

| npm audit package aggregates | Critical | High | Moderate | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before remediation | 2 | 14 | 21 | 1 | 38 |
| Final lockfile | 0 | 0 | 21 | 0 | 21 |

Other patched issues include the [critical shell-quote escaping advisory](https://github.com/advisories/GHSA-w7jw-789q-3m8p), its [parser denial of service](https://github.com/advisories/GHSA-395f-4hp3-45gv), and [PostCSS source-map file disclosure](https://github.com/advisories/GHSA-r28c-9q8g-f849). The retained before-scan JSON contains the complete advisory list for the compatible leaf patches.

The remaining 21 aggregates propagate two leaf advisories through their dependents; they are not 21 distinct vulnerabilities:

- [`decode-uri-component 0.2.2`](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), through `query-string 7.1.3` and React Navigation. This belongs to the mobile runtime dependency graph and concerns malformed encoded input causing excessive work.
- [`uuid 7.0.3`](https://github.com/advisories/GHSA-w5hq-g745-h8pq), required by `xcode 3.0.1`. This belongs to native project generation/build tooling and concerns caller-supplied output buffers. Expo package aggregates also inherit this tooling dependency; their presence does not establish that vulnerable code runs on a device.

The final npm report supplies no automatic compatible fix for these two chains. No findings are suppressed. The CI threshold is high, so these moderate findings remain visible in the uploaded report while the gate passes.

`pip-audit -r backend/requirements.txt` reports **no known vulnerabilities** and exits 0. A separate audit of the complete temporary development environment reports 10 advisory rows across `pip 26.0` and `pytest 8.3.3`, representing five distinct advisories after duplicate identifiers are collapsed. These affect the installer and test tool, not the runtime requirements audited by CI. Reported fixes are pip `26.2` and pytest `9.0.3`; upgrading the pytest major and its async plugin was outside this compatible runtime patch set. The installed-environment scan exits 1 and is retained without suppression. The earlier PyJWT scan also included disputed `CVE-2025-45768`; the final `2.13.0` scan no longer reports it, and it was not hidden by an ignore rule.

## Reproduction and delivery evidence

Use Node 22 and the pinned npm without changing the host's global installation:

```sh
npx --yes npm@11.19.1 ci
npx --yes npm@11.19.1 audit --package-lock-only --audit-level=high
python -m pip install pip-audit==2.10.1
python -m pip_audit -r backend/requirements.txt
npm run test:delivery
npm run test:docker-contexts
```

The local client suites and final builds ran on the available Node `25.2.1`. CI and web containers are configured for Node 22; the pending container/CI checks provide the release-runtime verification.

npm `11.6.2` was observed ignoring overrides beneath linked workspace dependencies. npm `11.19.1` correctly resolved the full patched Metro family. `packageManager`, `engines`, and `.npmrc` enforce the selected version: an old-npm `ci --dry-run` fails with `EBADENGINE`, while the pinned command passes. CI, both web Docker stages, and Vercel installation use the same version. The lock retains official npm registry URLs; two interrupted large downloads were recovered through a public mirror only after their bytes matched SHA512 integrity from official npm metadata.

Verification completed: Next production compilation, type validation and all routes; both client TypeScript checks; 51 web suites / 329 tests; 42 native suites / 283 tests; 32 shared-package and ten API-client tests; Metro resolution test; and an actual iOS Hermes bundle export. CI also executes both shared workspace suites. The OpenAI client constructs with the retained HTTPX pin without making a provider request. The backend regression suite and disposable PostgreSQL concurrency suite are recorded in the engineering review.

All 11 delivery/hygiene regression tests pass, including dirty-context rejection, exact build-output digest deployment, concurrent release rejection, rollback detection and secret-output redaction. Actual BuildKit context fixtures verify 15 private-file exclusions and six preserved source/example cases. Both web Docker workspace install modes pass `npm ci --dry-run` validation against an isolated fixture containing exactly the Docker-copied manifests. These are scoped checks, not completed production image builds.

The full backend image attempt was stopped after slow base-layer download and at dependency installation; it did not finish building or start the final runtime. The final full web image was not built locally. Both full image checks are configured in CI and remain release prerequisites; no new remote CI execution or branch-protection enforcement was verified. Production containers use an unprivileged account; Compose explicitly uses root only for the existing local development upload bind mount. No cloud deployment or commit was performed.

Machine-readable local reports are under ignored `audit-results/`: `npm-before.json`, `npm-final.json`, `python-runtime.json`, and `python-installed.json`. CI uploads its own current dependency reports on both success and failure.

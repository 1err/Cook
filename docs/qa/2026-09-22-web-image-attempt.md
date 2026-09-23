# Fresh web image attempt — September 22, 2026

**Result: failed during dependency download; fresh-image and container-runtime gates remain incomplete.** No image was pushed or deployed. No older application image was substituted, and no backend or paid-provider request was made.

## Exact inputs

- Source: committed `git archive` of `72c0c9459d6719567fe8c26c3df919ec4ebe95c0`; no working-tree edits, local dependencies, or previous application output entered the context.
- Dockerfile: that commit's `apps/web/Dockerfile`, with repository-root context.
- Target platform: `linux/amd64`.
- Official cached Node base: `node@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85`.
- Platform-specific base manifest: `sha256:b64da1de5a51067ab8e75f0bc8dbd0905d8894baa22261f439a4572f41291e50`; inspected as Linux/amd64, Node 22.23.2, with official Docker Node source annotation at revision `bc0a422bce0f729dd85790639d9f1918143f1235`.
- Build arguments: pinned `NODE_IMAGE` above and `NEXT_PUBLIC_API_BASE=https://api.chef-world.com`.
- Build flags: `--no-cache --pull=false --provenance=false --load`, plus a source-revision label. No application build layer was reused. The cached official base resolved locally immediately.

## Observed failure

The build exited with status 1 after **442.6 seconds**. Both fresh global npm 11.19.1 installs succeeded. The runtime-stage locked dependency install failed at Dockerfile line 42:

```text
RUN npm ci --omit=dev --workspace @cooking/web --include-workspace-root=false --no-audit --no-fund
npm error code ECONNRESET
npm error network aborted
```

The builder's concurrent project dependency install was canceled after that failure. Application compilation, final image export, and container probes did not run. This is direct evidence of a dependency-fetch connection reset; it does not establish a source-code or lockfile defect, nor does it identify which network intermediary reset the connection.

The release owner stopped further broad retries because other independent network operations were also failing. No retry, dependency-version change, or source workaround was applied in this attempt.

## Evidence and remaining gate

Local evidence directory: `/private/tmp/chef-beta-web-image-20260922/`.

- `build.log`: complete plain-progress build output.
- `build-result.json`: exact source/base, elapsed time, exit status, and intended local image tag.
- `official-base-metadata.json`: inspected official base/platform provenance.
- `source-72c0c9459d6719567fe8c26c3df919ec4ebe95c0.tar` and matching `context-.../`: committed build input.
- `build.py`, `run_probe.py`, `probe.mjs`: local build/probe tooling; probe scripts were syntax-checked but not executed against an application image.

After connectivity recovers, rebuild the final committed source with the same verified base or another explicitly verified official base. Then verify non-root runtime, anonymous HTML, recovery security headers, and locally served recovery fonts. The prepared probe uses a temporary container with external networking disabled, one CPU, 768 MiB memory, and no published ports. Earlier host-based unit/build/browser results do not replace this unfinished fresh-container gate.

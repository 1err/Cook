# Chef World public website release — September 21, 2026

The approved English public website and recipe-library masonry update are live at https://chef-world.com. The www hostname redirects to the canonical domain.

## Release identity

- Application source: `49d84124383b03352581c673b971d87dc90509f2` on local branch `codex/public-site-release-20260921`.
- Production baseline: `748ae762788a022fa31538a62cd4873fa5548607`, matching the prior manually deployed application source.
- Vercel project: `cook` / `prj_x4dQTj1LKA5VUlOpZrgNG15fDcr0`.
- Production deployment: `dpl_8vkC14nEoW91VtfJG91ViRLNZUox` / https://cook-8dje5hk1c-jerrys-projects-08f739a2.vercel.app.
- Previous deployment / rollback reference: `dpl_By4DGBhUbSE4jnMJhtWMbW2bvt2e`.

## Scope

The release adds the concise English homepage, About, Contact, Privacy and Terms pages; consistent navigation; a direct Open app link; public-page session-expiry handling; language-preference preservation; and the shortest-column responsive recipe layout. Contact is jerryxiang24@gmail.com. The Privacy Notice also discloses the existing Jina Reader video-import fallback.

The source was isolated from the existing production release. Existing dependencies, authentication security and shopping features were preserved. No backend or database deployment was needed. No source was pushed to GitHub and no partnership email was sent.

Vercel received 157 allowlisted frontend/runtime/config files, excluding backend source, mobile implementation, tests, documentation, Git metadata, dependencies, build output and private environment files. The bundle came from the exact source commit above. Its SHA-256 manifest hash is `b484403327c2e7ae3f3f7669f2a77e0b29bdfe3c6b356c21fde7b8b0957def16` (the local manifest includes the Vercel project link file, which Vercel excludes from upload).

## Verification

- Clean release production build and type checks passed with Next.js 15.5.24 and the production API URL.
- 341 web unit tests passed in 52 files.
- Production-mode browser checks: 47 passed; four intentionally skipped duplicate viewport cases. These tests use API fixtures and cover public pages, session expiry, language preservation, app entry, navigation, accessibility, and recipe layout after image loads, filtering and resizing.
- Vercel build passed and generated 22 static pages. The staged homepage was checked before promotion.
- After promotion, the public domain resolved to the exact deployment above with READY status.
- Live anonymous browser checks passed at 1440px and 390px for all five public pages, with HTTP 200, correct English document language, no horizontal overflow, no page errors and no detected WCAG A/AA violations.
- Live Open app redirected guests to sign-in with the correct library return destination. The saved Chinese app preference was preserved. The browser used https://api.chef-world.com and observed the expected anonymous 401.
- Live robots.txt, sitemap.xml and backend health returned HTTP 200; www redirected to chef-world.com.

Live checks were read-only and did not exercise a signed-in user's recipe data or perform grocery/provider actions. Accessibility automation is not a complete accessibility audit.

Live checks completed: 2026-09-22T04:08:58.960Z

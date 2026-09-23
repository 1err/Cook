# Backend image attempt — September 22, 2026

Result: **fresh image gate failed**. No image was pushed, task definition
registered, migration run in production, or service updated.

The context was a clean committed backend archive from
`fcd133398230cc8c6989bb6b5a06b319a281de56`, tree
`f2c9d37e8b706a101afea7260fcc7bb7e0821547`. The integrated release's backend tree
`d7b2538febd64636196fe72721a3f23b3aafaacf` adds only the public RDS CA bundle and
its README; its final image refresh was not attempted after the prerequisite
fresh build failed.

The first attempt stalled on downloading the current official Python base. An
exact-digest public ECR mirror attempt also timed out. The subsequent full
`linux/amd64 --no-cache --pull=false` build used a verified cached **official
Python base**, not an old Chef World application image:

- Base index: `python@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea`.
- AMD64 image: `sha256:2fe5997d249a808b8eeea52c58a1dbffbba28754dc11699ef5c029f2d818ce79`.
- Python 3.12.14, Debian 13.6, OpenSSL 3.5.7; created September 1, 2026.
- A temporary Dockerfile changed only `FROM` to the verified base digest.

The fresh requirements installation failed after **1,094.5 seconds** with a
PyPI `ReadTimeoutError` while downloading `pydantic-core`. Chromium installation
never began. A bounded parallel download recovery also timed out; 23 of 54 wheels
were independently verified against official PyPI SHA-256 values, with 31 files
still incomplete. These partial downloads do not constitute an image or runtime
verification.

There is no completed image ID. Non-root Chromium, Linux containment, isolated
PostgreSQL image runtime checks, and final-image TLS checks remain **unrun**.
No task-owned containers remain. No older application image was substituted.

Detailed local evidence, including logs, base provenance, result JSON and the
prepared runtime harness, is under
`/private/tmp/chef-beta-backend-fcd1333-x8hlj3jf/`.

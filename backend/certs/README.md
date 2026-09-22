# Amazon RDS trust bundle

`rds-us-east-1-bundle.crt` is the public Amazon RDS root CA bundle, downloaded
2026-09-22 over HTTPS from
https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem.

SHA-256: `b1711d12bae51838581281e23b6cb97b1074016873b4dafc80ed14002462dd77`.
It contains the three regional RSA2048, RSA4096 and ECC384 roots; no private keys.

The production overlay sets `DATABASE_SSL=true` and
`DATABASE_CA_FILE=/app/certs/rds-us-east-1-bundle.crt`. The existing database
client then requires certificate validation and hostname verification. Local
development keeps its existing settings. Refresh from the official source when
AWS announces a CA change, then verify a new release connection before rollout.

Reference: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html

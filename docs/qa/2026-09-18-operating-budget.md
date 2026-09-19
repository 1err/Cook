# Operating budget evidence — September 18, 2026

Owner ceiling: **USD 150/month combined**, including hosting and AI. Changes to that ceiling require the owner's decision; projected growth is not permission to increase spending.

## Read-only observations

AWS Cost Explorer reported estimated account-wide unblended charges of **$45.8765593898** for September 1 inclusive through September 19 exclusive, queried September 18. This is a partial-month estimate, not a final invoice, app-only attribution or a forecast.

| AWS service | Estimated accrued USD |
| --- | ---: |
| VPC | 16.93187641 |
| ECS | 10.4437592833 |
| Load balancing | 9.5294547909 |
| RDS | 8.1032499812 |
| Route 53 | 0.5071296 |
| ECR | 0.3608924137 |
| S3 | 0.0001969107 |

Read-only resource inspection found one desired/running API task at 0.5 vCPU and 1 GiB, and single-AZ PostgreSQL 17.9 on `db.t4g.micro` with 20 GiB gp2 and one-day backup retention. No new resources or paid provider requests were created. Vercel/OpenAI invoices, provider account ownership, future egress/worker expense and staging cost remain unverified.

## Required worksheet before rollout

Fill with current verified monthly estimates, not the illustrative numbers in test fixtures:

| Component | Monthly USD |
| --- | --- |
| Existing fixed AWS, excluding separately counted API/worker | Unverified |
| One API task, multiplied by maximum two tasks | Unverified |
| One durable worker | Unverified |
| Variable storage, requests, transfer, logs and monitoring | Unverified |
| Vercel and other operating services | Unverified |
| App-wide AI allocation | Unallocated; code default $0 |
| Release overlap / bounded staging amortization | Unverified |
| Contingency | Unallocated |
| Combined maximum estimate | Must be at most $150 |

`scripts/prepare-scaling.py` refuses incomplete/negative/nonfinite estimates and totals above $150. This is a preparation guard, not a cloud billing kill switch. Actual AWS/Vercel bills can exceed estimates; independent provider/billing controls and alerts must be verified. The default hosting reserve is $150 and the default AI allowance $0, so a deployer cannot silently spend the full ceiling again on AI.

No end-to-end affordability claim is made until this worksheet and live billing controls are verified. The new code must not be deployed with its default zero AI allowance while promising that paid import remains enabled.

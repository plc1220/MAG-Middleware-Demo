# MAG Middleware — BAYNO demo

Documentation and implementation of the SAS-derived BAYNO streaming demonstration.

## Start here

- [Consolidated architecture and operations](bayno-demo/consolidated/README.md)
- [Cloud Run app, Google sign-in and streaming agent](cloudrun/README.md)
- [Pipeline acceptance](bayno-demo/consolidated/ACCEPTANCE.md)
- [Ten-second cadence acceptance](cloudrun/CADENCE-ACCEPTANCE.md)
- [Cadence evidence](cloudrun/CADENCE-ACCEPTANCE.json)
- [Streaming chat verification](cloudrun/CHAT-STREAM-ACCEPTANCE.md)
- [Google sign-in verification](cloudrun/AUTH-ACCEPTANCE.md)

## Demonstration

The Cloud Run webapp controls durable PostgreSQL run records. A VM worker generates
30 immutable CSV files at ten-second intervals across a five-minute window.
Managed Confluent SFTP Source, Kafka and Flink validate and transform the files.
Managed SFTP and PostgreSQL sinks deliver results; the independent verifier
compares identities, counts and canonical hashes at both destinations.

The walkthrough includes a reconstructed graph of the six exported SAS jobs.
The Gemini assistant uses Confluent MCP and shows streamed replies and observable
tool activity. Run and Flink changes require the existing approval controls.
Google sign-in permits verified mile.cloud Workspace accounts.

This is a SAS-derived demo, not certified production parity: authoritative detail
validation includes and the complete production feed specification were absent.
Acceptance reports record observations from their stated dates, not current health.

## Repository layout

| Folder | Contents |
|---|---|
| `cloudrun/` | Webapp, agent, run controls, tests and verification reports |
| `bayno-demo/consolidated/` | Current VM worker, reference rules, Flink SQL and connector deployment tools |
| `infra/mag-bayno-vm/` | VM provisioning and transport/database setup |
| `SAS Package File/` | Supplied SAS export evidence; treat as confidential |
| `src/app/ai-chat/` | Original Astryx template reference and license |
| `sftp-demo/`, other `bayno-demo/` files | Retained earlier demos and historical implementations |

Secrets and private runtime files are excluded. Deployment requires authorized
GCP/Confluent access and separately provisioned credentials. Review deployment
scripts before use; they can change live infrastructure. Do not make this repository
public without reviewing the supplied SAS material and organization-specific metadata.

The earlier Sites checkout remains a separate local repository and is not embedded here.

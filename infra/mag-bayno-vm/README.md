> Consolidated runtime: see [the current guide](../../bayno-demo/consolidated/README.md). Managed SFTP source/sink access now uses the regional connector egress allowlist on port 22, alongside IAP administration. New chroot paths are `/incoming`, `/archive`, `/ingestion-error` and `/outgoing`; original `/dropbox` paths remain retained.

# MAG BAYNO transport and database VM

The VM hosts a chrooted SFTP dropbox and PostgreSQL. Confluent Cloud still runs Kafka, the managed connectors, and Flink. The SFTP ingress and PostgreSQL port accept connections only from Confluent's GCP `asia-southeast1` connector egress ranges. SSH administration is through Google IAP.

Provisioning is performed from the repository root with `./infra/mag-bayno-vm/scripts/deploy.sh`. It creates a separate VPC, subnet, firewall rules, static address, and an `e2-micro` VM in `asia-southeast1-a` (the machine type permitted by the project policy); it also generates a dedicated local SFTP key and stores the PostgreSQL password in Secret Manager. The VM service account can read only that password secret.

To run the feed generator from the laptop after provisioning:

```sh
./bayno-demo/start-cloud-feed-generator.sh
```

The generator writes unique synthetic pipe-delimited files into `/dropbox/incoming`. The SFTP connector moves completed files to `/dropbox/finished` and malformed files to `/dropbox/error`. The PostgreSQL database is `magbayno`, with final table `public.mag_bayno_hist`. Connect through an IAP TCP tunnel for interactive inspection rather than broadening the database firewall:

```sh
gcloud compute ssh mag-bayno-demo --tunnel-through-iap \
  --zone=asia-southeast1-a --project=my-rd-coe-demo-gen-ai \
  -- -L 15432:localhost:5432
```

The instance and static external IP incur recurring charges while they exist. Stop the VM when not demoing; delete it and release the address when the environment is no longer needed.

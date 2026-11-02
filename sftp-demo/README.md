# MAG SAS package and BAYNO feed SFTP demo

A local-only SFTP endpoint serving the three XML metadata files from the SAS transport package, the original static fixture, and generated BAYNO mock feeds. The XML files are SAS job/package metadata; generated feeds use an explicitly synthetic, stream-friendly layout. Authentication is public-key-only, the endpoint is published only on `127.0.0.1:2222`, and only `/dropbox/{incoming,finished,error}` is writable. The package XML and static fixture remain read-only. SSH keys and the server host key are stored in the ignored `secrets/` directory.

## Start / stop

```sh
docker compose up -d --build
docker compose down
```

From the repository root, the continuous feed generator starts the SFTP service and uploads one unique file every 10 seconds:

```sh
./bayno-demo/start-feed-generator.sh
```

Stop it with `Ctrl-C`. To upload just one file, pass `--max-files 1`; use `--interval-seconds 5` to change the interval.

## Connection

- Host: `127.0.0.1`
- Port: `2222`
- Username: `magdemo`
- Metadata XML: `/data`
- Synthetic BAYNO feed: `/bayno/FMCS0000_BAYNO000_20261029090000_00001P0001`
- Generated feed files: `/dropbox/incoming`
- Bridge archive target: `/dropbox/finished`
- Client key: `secrets/client_ed25519`

The `/bayno` directory is mounted read-only from `../bayno-demo/fixtures`; the generator uploads new files into `/dropbox/incoming` using a temporary name and then renames each file when upload completes. The local bridge reads completed files and moves them to `/dropbox/finished` after Kafka confirms delivery. Failed or incomplete transfers remain in `/dropbox/incoming` for resume. This endpoint is not reachable from Confluent Cloud while it remains loopback-only. The demo does not expose the host or claim to reproduce the production feed layout.

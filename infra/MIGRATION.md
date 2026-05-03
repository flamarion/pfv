# Migration runbook: managed MySQL + Redis -> self-hosted droplet

Source of truth for moving prod data from DO Managed MySQL + Managed Redis to
the new `pfv-data-01` droplet provisioned by `infra/terraform`.

Plan window: pick a quiet hour. Total downtime: ~10–20 min for the size of the
PFV dataset today. Mostly waiting on dump + import.

## Pre-flight checklist

- [ ] Terraform applied; droplet reachable via `ssh root@<public_ipv4>`.
- [ ] Ansible playbook applied; `mysql --version` and `redis-cli ping` work
      on the droplet.
- [ ] App Platform's outbound VPC routing reaches the droplet's private IP.
      Sanity check from a worker / ad-hoc droplet inside the VPC:
      `mysql -h <droplet_private_ipv4> -u pfv_app -p -e 'SELECT 1'`.
- [ ] Latest weekly DO backup of the managed DB exists. As an extra belt:
      take a fresh mysqldump from the managed DB endpoint (see step 4) before
      the cutover starts.
- [ ] `doctl` configured and authenticated locally.
- [ ] App Platform spec file checked out and ready to edit (per
      `reference_do_spec_sync.md`: deploy via direct `doctl apps update`,
      not the GitHub deploy action).

## Cutover

### 1. Snapshot the managed DB (belt-and-suspenders)

DO control panel -> Databases -> pfv mysql cluster -> Backups -> "Create
backup". Wait until it shows up green. Or via API:

```bash
doctl databases backups list <db-cluster-id>
```

Skip this if the most recent automated backup is fresh enough for your
comfort.

### 2. Quiesce the app

Take the App Platform service offline so no writes happen during the dump:

```bash
# Scale backend to 0 instances. Adjust component name as needed.
doctl apps update <app-id> --spec <path-to-spec-with-instance-count-zero>
# Or use the UI: App -> Components -> backend -> Settings -> 0 instances.
```

Confirm `/health` returns "service unavailable" (or the route 502s) before
moving on.

### 3. Dump from managed MySQL

From a workstation or one-shot droplet that has network access to the managed
DB:

```bash
mysqldump \
  --single-transaction \
  --routines \
  --triggers \
  --quick \
  --hex-blob \
  --set-gtid-purged=OFF \
  -h <managed-host> \
  -P <managed-port> \
  -u doadmin -p \
  --ssl-mode=REQUIRED \
  pfv2 | gzip > pfv2_$(date +%Y%m%d-%H%M%S).sql.gz
```

(`--set-gtid-purged=OFF` keeps the dump portable; the new droplet isn't a
GTID replica.)

### 4. Import into the droplet

Copy the dump up:

```bash
scp pfv2_*.sql.gz root@<droplet_public_ipv4>:/var/backups/mysql/migration/
```

On the droplet:

```bash
gunzip -c /var/backups/mysql/migration/pfv2_*.sql.gz | mysql pfv2
```

(Root creds are in `/root/.my.cnf` thanks to the mysql role.)

### 5. Verify

```bash
mysql pfv2 -e 'SHOW TABLES'
mysql pfv2 -e 'SELECT COUNT(*) FROM users'
mysql pfv2 -e 'SELECT COUNT(*) FROM transactions'
mysql pfv2 -e 'SELECT COUNT(*) FROM accounts'
```

Counts should match the managed DB. If you can pre-record managed-side
counts in step 3, do so and diff here.

### 6. Update App Platform secrets

Edit the App Platform spec file directly and push with `doctl` (the
`digitalocean/app_action/deploy` GH Action silently prefers `app_name` over
the spec; see `reference_do_spec_sync.md`):

```yaml
envs:
  - key: DATABASE_URL
    scope: RUN_TIME
    type: SECRET
    value: mysql+aiomysql://pfv_app:<password>@<droplet_private_ipv4>:3306/pfv2
  - key: REDIS_URL
    scope: RUN_TIME
    type: SECRET
    value: redis://default:<password>@<droplet_private_ipv4>:6379/0
```

Push:

```bash
doctl apps update <app-id> --spec .do/app.yaml
```

### 7. Bring the app up

Scale instances back to 1+:

```bash
# Same spec, instance_count restored to >=1.
doctl apps update <app-id> --spec .do/app.yaml
```

Watch the deploy:

```bash
doctl apps logs <app-id> --type RUN --follow
```

Wait for `/api/v1/health` and `/api/v1/ready` to go green.

### 8. Smoke test (manual)

- [ ] Log in.
- [ ] Open the dashboard. Charts render.
- [ ] Create a transaction.
- [ ] Run a CSV import.
- [ ] Hit the rate-limited endpoint a few times rapidly. Expect 429 after
      threshold (confirms Redis rate-limit storage works).
- [ ] Check `/var/log/mysql/slow.log` on the droplet for any unexpected
      slow queries during the smoke test.

### 9. Decommission grace period

Keep the managed DB and Redis running for 24h with no writes. If anything
goes wrong you can flip `DATABASE_URL`/`REDIS_URL` back and redeploy.

After 24h of clean operation:

```bash
doctl databases delete <mysql-cluster-id>
doctl databases delete <redis-cluster-id>
```

## Rollback

If smoke tests fail or production behaves badly:

1. Revert the App Platform spec change (replace `DATABASE_URL` and
   `REDIS_URL` with the managed endpoints).
2. `doctl apps update <app-id> --spec .do/app.yaml` to redeploy with the
   prior config.
3. Investigate the droplet path before retrying. Common causes:
   - VPC peering not actually attached (check the droplet is in the VPC
     used by App Platform).
   - MySQL `bind-address` left at `127.0.0.1` (check
     `/etc/mysql/mysql.conf.d/pfv.cnf`).
   - ufw blocking the connection (check `ufw status verbose`).
   - Firewall rule missing (`doctl compute firewall list`).
   - Wrong password on `pfv_app` (check `/root/.my.cnf` and the secret).

## Posture notes

- MySQL listens on `0.0.0.0`. MySQL 8 only accepts a single `bind-address`,
  so we rely on the DO Cloud Firewall + host ufw to restrict to VPC. Both
  layers must allow 3306 from the VPC CIDR for App Platform to connect.
- Redis is bound to `127.0.0.1 <private_ipv4>` and `requirepass` is set.
  Auth + VPC + protected-mode all required.
- No TLS on either service. Traffic stays inside DO's VPC; revisit if we
  add a second region or move to a multi-tenant network.
- Backups: nightly logical dump in `/var/backups/mysql/` (7-day retention)
  plus DO weekly droplet snapshots. To restore: copy a `.sql.gz` off the
  droplet, `gunzip -c <file> | mysql pfv2`. Or restore the snapshot from the
  DO console and re-point DNS / spec at the new droplet.

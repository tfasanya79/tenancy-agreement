# Deploying TenancyDesk

TenancyDesk is one Node process with one SQLite file and one web page. There is no build step, no database server and nothing to compile: Node 24 runs the TypeScript source directly.

This guide covers four things: running it on your own computer, running it in Docker, running it on a small server, and looking after the data afterwards.

> **Read this first.** TenancyDesk has **no login** — no accounts, no password. Anyone who can reach the port can read and change every tenant pack. Never put it directly on the public internet. Sections 3 and 4 show the safe ways to expose it.

---

## 1. Choose your setup

| Setup | What you need | Roughly what it costs | Trade-offs |
| --- | --- | --- | --- |
| **Just me, on my laptop** | A computer with Node 24, the project folder, a DeepSeek API key | Nothing beyond DeepSeek usage — pennies per pack | Only runs while the terminal window is open. Data lives on that one machine, so a lost laptop is lost paperwork unless you back `data/` up. |
| **Always on, small VPS** | A 1–2 GB Linux instance, Docker, a way to reach it privately (VPN or authenticating proxy) | A few pounds a month for the instance | Runs all the time, so packs are there when you need them. You own updates, backups and access control. Exposing it badly is the main risk. |
| **Existing Docker host** | A machine already running Docker and Compose | Nothing extra, if you already pay for the host | Least new setup, and upgrades are one command. Same rule applies: do not publish the port publicly. |

A 1 GB instance is enough. The process idles at roughly 100 MB of memory; the disk grows with generated documents, not with the database.

---

## 2. Running on your own computer

### Step 1 — install Node 24

Download the **LTS** installer from [nodejs.org](https://nodejs.org) and run it. Node 24 or newer is required; older versions cannot run TypeScript directly.

```bash
node -v
```

You should see `v24.x.x` or higher. If you see anything lower, install the current LTS before carrying on.

### Step 2 — switch on pnpm

Node ships with a package-manager shim called corepack:

```bash
corepack enable
pnpm -v
```

### Step 3 — install the project

```bash
cd tenancydesk
pnpm install
```

This installs three runtime packages and the TypeScript tools. There is nothing to build.

### Step 4 — create your `.env`

```bash
cp .env.example .env
```

On Windows PowerShell:

```bash
copy .env.example .env
```

Open `.env` in any text editor and put your DeepSeek key in it:

```bash
DEEPSEEK_API_KEY=sk-your-key-here
```

If you do not have a key yet, set `OFFLINE_MODE=true` instead. Everything still works — you type the details in by hand and generate documents — but the assistant is switched off.

You can also fill in your agency details (`AGENCY_NAME`, `AGENCY_EMAIL`, `AGENCY_PHONE`, `AGENCY_ADDRESS`, `AGENCY_CLIENT_MONEY_SCHEME`, `AGENCY_REDRESS_SCHEME`) so every new pack starts pre-filled.

### Step 5 — run the health check

```bash
pnpm doctor
```

It prints one line per thing it checked: Node version, `.env`, templates, whether the data folder is writable, the interface files, the API key, and whether the port is free. Fix anything marked `✗` and run it again.

### Step 6 — start it

```bash
pnpm start
```

You will see:

```
  Open your browser at:  http://localhost:3000
  Assistant:  ready (deepseek-chat)
  Templates:  9 loaded from ./templates
  Your data:  ./data  (back this folder up)
```

Open [http://localhost:3000](http://localhost:3000). Press `Ctrl+C` in the terminal to stop.

### Keeping it running

**The terminal window is the app.** Close the window and the app stops. Options, by system:

| System | Keep it running |
| --- | --- |
| Windows | Leave the PowerShell window open and minimised. To run it at logon, add a Task Scheduler task that runs `pnpm start` in the project folder. |
| macOS | Leave Terminal open. `nohup pnpm start > tenancydesk.log 2>&1 &` keeps it alive after you close the window; `launchd` is the proper way if you want it at login. |
| Linux | `tmux new -s tenancydesk` then `pnpm start`, and detach with `Ctrl+B` then `D`. For a permanent service, use `systemd`. |

For anything beyond occasional use, section 4 is the better answer — a small server keeps the app in one place and your laptop out of it.

---

## 3. Running with Docker

### What is in the box

Three files at the project root:

| File | What it does |
| --- | --- |
| `Dockerfile` | Builds a `node:24-alpine` image, installs pnpm 10, runs `pnpm install --prod --frozen-lockfile`, copies `src/`, `templates/`, `public/`, `scripts/`, `docs/`, `README.md`, `LICENSE`, then runs as the unprivileged `node` user with `CMD ["node", "src/server.ts"]`. It exposes port 3000 and health-checks `/api/health` every 30 seconds. |
| `docker-compose.yml` | One service, `tenancydesk`, from image tag `tenancydesk:1.0.0`, with `restart: unless-stopped`, `NODE_ENV=production`, `DATA_DIR=/data`, the port published on `127.0.0.1:3000` **only**, a named volume for the data, and `./templates` mounted read-only so you can edit wording without rebuilding. |
| `.dockerignore` | Keeps `node_modules`, `data/`, `samples/`, `.git`, `.github` and every `.env*` file out of the image. |

### Step 1 — install Docker

Docker Engine 24+ with the Compose v2 plugin, or Docker Desktop. Check both:

```bash
docker --version
docker compose version
```

### Step 2 — create the `.env` file

Compose reads `.env` and passes it into the container. The build fails without one:

```bash
cp .env.example .env
chmod 600 .env
```

Then edit `.env` and set `DEEPSEEK_API_KEY` (or `OFFLINE_MODE=true`). Leave `DATA_DIR` alone — Compose overrides it to `/data`.

### Step 3 — start it

```bash
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000). The first run builds the image, which takes a minute or two.

### Step 4 — watch it

```bash
docker compose ps
docker compose logs -f
docker compose logs -f --tail=100
```

`docker compose ps` shows `healthy` once the health check has passed. Press `Ctrl+C` to stop following the logs — that does not stop the app.

### Step 5 — day-to-day commands

```bash
docker compose restart          # restart after editing .env
docker compose down             # stop and remove the container (data is kept)
docker compose down -v          # stop and DELETE the data volume — never do this lightly
```

### Where the data lives

The database and every generated document live in the named volume `tenancydesk-data`, mounted at `/data` inside the container:

```
/data/tenancydesk.db            the SQLite database
/data/documents/<pack-id>/      generated .docx, .html and .md files
```

To find the folder on the host:

```bash
docker volume inspect tenancydesk-data
```

When you run with `pnpm start` instead of Docker, the same files are at `./data` in the project folder.

> **This volume is real tenant personal data** — names, dates of birth, addresses, ID references, deposit amounts, signed tenancy documents. Back it up (§5), restrict who can read it (`chmod 700` on `./data`, or the Docker volume on a host only you log into), and use full-disk encryption. On a shared Docker host, remember that anyone in the `docker` group can read that volume.

---

## 4. Running on a small VPS

This is provider-agnostic: Hetzner, DigitalOcean, Scaleway, OVH, a VPS from your ISP — the steps are the same.

### Step 1 — create the instance

| Setting | What to pick |
| --- | --- |
| Memory | 1 GB minimum, 2 GB comfortable |
| Disk | 20 GB is plenty to start |
| Image | Debian 12 or Ubuntu 22.04/24.04 LTS |
| Access | SSH key, not a password |

### Step 2 — create a non-root user

```bash
adduser tenancy
usermod -aG sudo tenancy
```

Log out and back in as `tenancy` for the rest of this section.

### Step 3 — install Docker

Follow Docker's own instructions for your distribution ([docs.docker.com/engine/install](https://docs.docker.com/engine/install/)) — usually the convenience script for a fresh host:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker tenancy
```

Log out and back in again so the group change takes effect, then check:

```bash
docker run --rm hello-world
```

### Step 4 — get the code

```bash
git clone <your-repo-url> ~/tenancydesk
cd ~/tenancydesk
```

### Step 5 — create `.env`

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Set `DEEPSEEK_API_KEY` and your `AGENCY_*` details. Keep the file readable by you only — it holds a billable secret.

### Step 6 — start it

```bash
docker compose up -d
docker compose ps
```

The port is published on `127.0.0.1:3000` only, so it is not reachable from the internet. Confirm that from your own machine — it should fail to connect:

```bash
curl --max-time 5 http://<your-server-ip>:3000/api/health
```

### Step 7 — put something private in front of it

**The app has no login.** There is no password to guess because there is no account: any request that arrives is treated as the letting agent. So the access control has to come from outside the app. Pick one:

| Option | Good for | What it looks like |
| --- | --- | --- |
| **VPN (Tailscale or WireGuard)** | One person, one laptop | Install the client on the server and your devices. Reach the app at its private VPN address. Nothing is exposed publicly. Strongly recommended. |
| **IP allow-list** | A fixed office IP | Firewall rule allowing only your IP on port 443, everything else dropped. Fragile if your IP changes. |
| **Authenticating reverse proxy** | Several people, or access from anywhere | nginx with TLS and `basic_auth` in front of `127.0.0.1:3000`. Below. |

If you only need to check something occasionally, an SSH tunnel needs no extra software at all:

```bash
ssh -L 3000:127.0.0.1:3000 tenancy@<your-server-ip>
```

Then browse `http://localhost:3000` on your own machine while that command is open.

#### nginx with TLS and basic auth

Install nginx, the password tool and certbot:

```bash
sudo apt update
sudo apt install -y nginx apache2-utils certbot python3-certbot-nginx
```

Create a password and put the config in place:

```bash
sudo htpasswd -c /etc/nginx/.tenancydesk.htpasswd yourname
sudo nano /etc/nginx/sites-available/tenancydesk
```

```nginx
server {
    listen 80;
    server_name tenancy.example.co.uk;

    # Redirect everything to HTTPS.
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name tenancy.example.co.uk;

    # certbot fills these in for you.
    ssl_certificate     /etc/letsencrypt/live/tenancy.example.co.uk/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tenancy.example.co.uk/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # Security headers. The app sends no cookies, so a strict policy costs nothing.
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options            "DENY" always;
    add_header X-Content-Type-Options     "nosniff" always;
    add_header Referrer-Policy            "no-referrer" always;
    add_header Content-Security-Policy    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'" always;

    # The only door into the app.
    auth_basic           "TenancyDesk";
    auth_basic_user_file /etc/nginx/.tenancydesk.htpasswd;

    client_max_body_size 4m;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # The assistant streams its progress as server-sent events.
        proxy_buffering    off;
        proxy_read_timeout 300s;
    }
}
```

Enable it and reload:

```bash
sudo ln -s /etc/nginx/sites-available/tenancydesk /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Then get a certificate:

```bash
sudo certbot --nginx -d tenancy.example.co.uk
```

Certbot rewrites the certificate lines and installs a renewal timer. Check it works:

```bash
sudo certbot renew --dry-run
```

Finally, close the door you do not need — the app port should not be reachable from outside at all:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### Step 8 — the same thing with systemd and Caddy, no Docker

Already have a server running other services behind Caddy? This is the smaller
footprint: one systemd unit, one reverse-proxy block, no container. It is the
setup the project has been deployed with, and the one to copy.

**Node 24 as a normal user.** Do not fight the distribution's Node. With nvm:

```bash
source ~/.nvm/nvm.sh
nvm install 24 && nvm alias default 24
npm install -g pnpm@10
```

**Get the code and install.** There is nothing to build:

```bash
git clone <your-repo-url> ~/tenancydesk
cd ~/tenancydesk
pnpm install
pnpm test          # 263 tests, no API key needed
```

**Configuration in one root-owned file**, so the key is not in the project folder
and does not end up in a git commit:

```bash
sudo nano /etc/tenancydesk.env     # mode 600
```

```ini
DEEPSEEK_API_KEY=sk-...
PORT=8111
HOST=127.0.0.1          # loopback only: the proxy is the door
DATA_DIR=/home/you/tenancydesk/data
NODE_ENV=production
AGENCY_NAME=Your Agency Ltd
AGENCY_EMAIL=you@example.com
AGENCY_PHONE=...
AGENCY_ADDRESS=...
AGENCY_CLIENT_MONEY_SCHEME=
AGENCY_REDRESS_SCHEME=
```

```bash
sudo chown root:root /etc/tenancydesk.env && sudo chmod 600 /etc/tenancydesk.env
mkdir -p ~/tenancydesk/data && chmod 700 ~/tenancydesk/data
```

**The unit**, `/etc/systemd/system/tenancydesk.service`. Note `TZ`: the app works
in UK tenancy dates, so a server on UTC should be told the local zone or a
deadline computed just after midnight will be a day out.

```ini
[Unit]
Description=TenancyDesk - tenancy paperwork, one pack per tenant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=you
Group=you
WorkingDirectory=/home/you/tenancydesk
EnvironmentFile=/etc/tenancydesk.env
Environment=NODE_ENV=production
Environment=TZ=Europe/London
ExecStart=/home/you/.nvm/versions/node/v24.22.0/bin/node src/server.ts
Restart=on-failure
RestartSec=3
TimeoutStopSec=10
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/you/tenancydesk/data
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes

[Install]
WantedBy=multi-user.target
```

The last group locks the process down: read-only filesystem except the data
folder, no privilege escalation, no access to other users' home directories. The
app needs to write in exactly one place, so this costs nothing.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tenancydesk
sudo systemctl status tenancydesk --no-pager
curl -s http://127.0.0.1:8111/api/health
```

**Caddy**, with a password and automatic TLS. Add a *new* host block to
`/etc/caddy/Caddyfile`; do not touch the blocks that are already there:

```
tenancy.example.co.uk {
	encode zstd gzip
	basicauth /* {
		agency <bcrypt-hash>
	}
	reverse_proxy 127.0.0.1:8111 {
		flush_interval -1
	}
}
```

`caddy hash-password --plaintext 'your-password'` produces the hash. The
`flush_interval -1` is for the assistant, which streams its progress as
server-sent events — without it the reply can arrive in one lump at the end.

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

If the validate step fails on a block you did not write (an `{env.*}` placeholder,
say), check the running service's own `EnvironmentFile` — Caddy resolves those at
`run` time, and the offline checker does not. A reload that fails leaves the
previous configuration running, so reloading is the safe way to find out.

**Check the door, then check it again from outside the network.** No password must
mean `401`, and the port itself must be unreachable:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://tenancy.example.co.uk/              # 401
curl -s -o /dev/null -w '%{http_code}\n' -u agency:'the-password' https://tenancy.example.co.uk/   # 200
curl --max-time 5 http://<server-ip>:8111/api/health                                 # must fail
```

**Nightly backup**, `/usr/local/bin/tenancydesk-backup.sh`, run from
`/etc/cron.d/tenancydesk-backup` at 02:15. SQLite's own `.backup` gives a
consistent copy while the app runs — copying the file with `cp` does not (see the
WAL caveat in §5).

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP="$(date +%F)"
DATA="/home/you/tenancydesk/data"
DEST="/home/you/backups/tenancydesk"
install -d -m 700 "${DEST}"
TMP="$(mktemp -d)"; trap 'rm -rf "${TMP}"' EXIT
install -d "${TMP}/stage"
sqlite3 "${DATA}/tenancydesk.db" ".backup '${TMP}/stage/tenancydesk.db'"
sqlite3 "${TMP}/stage/tenancydesk.db" 'PRAGMA integrity_check;'      # prints "ok"
[ -f /etc/tenancydesk.env ] && install -m 600 /etc/tenancydesk.env "${TMP}/stage/tenancydesk.env"
for extra in documents uploads; do
  [ -d "${DATA}/${extra}" ] && cp -a "${DATA}/${extra}" "${TMP}/stage/${extra}"
done
tar czf "${DEST}/tenancydesk-${STAMP}.tar.gz" -C "${TMP}/stage" .
chmod 600 "${DEST}/tenancydesk-${STAMP}.tar.gz"
find "${DEST}" -maxdepth 1 -name 'tenancydesk-*.tar.gz' -mtime +30 -delete
```

```
15 2 * * * root /usr/local/bin/tenancydesk-backup.sh >> /var/log/tenancydesk-backup.log 2>&1
```

Run it once by hand and open the archive. A backup nobody has opened is a guess.
Then copy it off the machine — a backup on the same disk is not a backup.

**Updating** is three commands:

```bash
cd ~/tenancydesk && git pull && pnpm install && sudo systemctl restart tenancydesk
```

Take a backup first (§5), and read `CHANGELOG.md` — template changes alter what a
pack says, which matters more than code changes.

---

## 5. Backups

### What to back up

| Path | Why |
| --- | --- |
| `data/tenancydesk.db` | Every pack: entered details, notes, cover messages, the assistant's run log |
| `data/documents/` | The generated `.docx`, `.html` and `.md` files for each pack |
| `.env` | Your API key and agency details — without it you retype everything |
| `templates/` | Only if you edited the wording; otherwise it comes back with the code |

Keep backups encrypted. `.env` contains a billable secret and `data/` contains tenant personal data.

### How often

| How much you use it | Suggested backup |
| --- | --- |
| A pack a month | After each pack, plus a weekly copy |
| Several packs a week | Nightly, keeping 30 days |
| Any use at all | One copy off the machine. A backup on the same disk is not a backup. |

### A copy-paste example

Running locally with `pnpm start`:

```bash
mkdir -p backups
tar czf "backups/tenancydesk-$(date +%F).tar.gz" data .env templates
```

Copy it somewhere else:

```bash
rsync -av --progress backups/ you@backup-host:~/tenancydesk-backups/
```

Running in Docker:

```bash
docker compose stop
docker run --rm \
  -v tenancydesk-data:/data \
  -v "$PWD/backups:/backup" \
  alpine tar czf "/backup/tenancydesk-$(date +%F).tar.gz" -C /data .
docker compose start
```

Or copy the volume straight to another machine with `rsync`, keeping the app stopped while it runs.

### The WAL caveat

The database runs in SQLite's WAL (write-ahead log) mode. New data can sit in `tenancydesk.db-wal` for a moment before it is folded into `tenancydesk.db`. That means:

- copy `tenancydesk.db` **together with** `tenancydesk.db-wal` and `tenancydesk.db-shm` if they exist, **or**
- stop the app first (`docker compose stop`, or `Ctrl+C`) and then copy the file.

Copying only `tenancydesk.db` while the app is running can silently lose the last few minutes of work.

### Restoring

Stop the app, unpack the archive over the project folder (or into the volume), check that `.env` came back, then start it and open the pack list. Restore once on purpose, before you need to do it in a hurry — an untested backup is a hope, not a plan.

```bash
docker compose stop
tar xzf backups/tenancydesk-2026-10-19.tar.gz
docker compose start
```

---

## 6. Updating

Back up `data/` first, then:

```bash
cd ~/tenancydesk
docker compose stop
git pull
docker compose build
docker compose up -d
```

Running locally instead of Docker:

```bash
git pull
pnpm install
pnpm test
pnpm doctor
pnpm start
```

Two habits worth keeping:

- **Read `CHANGELOG.md` before you upgrade**, and `git log` if a release does not have one. Template and rule changes can alter what a pack says, which matters more than the code changing.
- **Run `pnpm test`** after updating. It needs no API key and no network, and it will tell you if a template or a rule broke.

Templates you have edited yourself live in `templates/` and are not touched by `git pull` unless the upstream file changed — if it did, git will say so and you decide which wording wins.

---

## 7. Monitoring and troubleshooting

### The three things to check

```bash
pnpm doctor                      # local run: one line per check
docker compose logs -f --tail=100  # Docker: what the app is saying
curl -s http://localhost:3000/api/health
```

`/api/health` answers without a login and is safe to poll:

```json
{
  "ok": true,
  "store": { "packs": 12, "documents": 61, "runs": 34 },
  "templates": 9,
  "templateWarnings": [],
  "assistantAvailable": true,
  "model": "deepseek-chat",
  "offlineMode": false
}
```

If `ok` is not `true`, or the request hangs, the process is not running. `templateWarnings` should be an empty list; anything in it means a template is malformed.

### Disk space

Generated documents are small (tens of kilobytes each) but they add up over years, and the database never shrinks on its own.

```bash
df -h                                   # free space on the volume
du -sh data/documents                   # how much the documents take
ls data/documents | wc -l               # how many packs have files
```

Keep at least a gigabyte free. A full disk makes SQLite fail mid-write, which is the one failure mode that can damage the database.

### Common problems

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `EADDRINUSE` / "Is something else already using port 3000?" | Another program, or a second copy of the app, has the port | Change `PORT=3001` in `.env` and restart; or stop the other program (`lsof -i :3000` on macOS/Linux, `Get-NetTCPConnection -LocalPort 3000` on Windows). |
| `EACCES: permission denied` on `./data` | The folder belongs to another user, or the container cannot write to the mount | `sudo chown -R $(whoami) data` for a local run. In Docker, `chown` the volume to the `node` user, or run `docker compose down` and fix the mount's ownership before starting again. |
| Assistant says "No DeepSeek API key is set" | `DEEPSEEK_API_KEY` is empty, or the app was not restarted after editing `.env` | Put the key in `.env`, restart (`docker compose restart` or `Ctrl+C` and `pnpm start`), then `pnpm doctor` to confirm the key works. |
| Assistant says "switched off (OFFLINE_MODE)" | `OFFLINE_MODE=true` in `.env` | Set it to `false` and restart. Everything except the assistant works either way. |
| "No templates found. Expected a templates folder" | Started from the wrong directory, or `TEMPLATES_DIR` points somewhere else | `cd` into the project root and start again, or fix `TEMPLATES_DIR` in `.env`. |
| `docker compose up` says the env file is missing | `.env` was never created | `cp .env.example .env`, add your key, run it again. |
| Container is `unhealthy` but the page loads | Health check failing on a changed `PORT` | Keep `PORT=3000` inside the container, or update the health check and the port mapping together. |
| `no space left on device` | Disk full — the database cannot write | Free space (`docker system prune`, delete old backups, archive finished packs), then restart. Run `pnpm doctor` afterwards. |
| Browser cannot reach the server from your laptop | Compose publishes the port on `127.0.0.1` only — by design | Use an SSH tunnel: `ssh -L 3000:127.0.0.1:3000 user@server`, or put nginx in front (§4). |
| Documents generate, but the assistant is slow or times out | DeepSeek is slow or rate limiting | Wait and retry; the client retries by itself. Generate documents by hand in the meantime. |

---

## 8. Uninstalling or moving to another machine

Moving house is three steps: stop it, copy two things, start it.

```bash
# on the old machine
docker compose stop
tar czf tenancydesk-move.tar.gz data .env templates
```

Copy `tenancydesk-move.tar.gz` to the new machine, install Node 24 or Docker there as above, put the project in place, unpack the archive over it, and start. Packs, documents and settings all come across; nothing is tied to the old machine's identity.

To remove it completely:

```bash
docker compose down -v          # removes the container AND the data volume
rm -rf ~/tenancydesk
```

Deleting the volume deletes every tenant pack and every generated document. If the tenancies are over and the retention period has passed, that is the point; if not, take a backup first and keep it somewhere encrypted. You are the data controller for that data, so disposing of it is your decision to record, not the software's.

---

*TenancyDesk is not legal advice, and this guide is not a security audit. See [SECURITY.md](../SECURITY.md) for what the app does and does not protect, and `docs/RULES.md` for the rules the checks are based on.*

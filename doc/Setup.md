# FanCPA Cloudflare Setup

Condensed from `template/doc/Setup.md`. Run setup from the **FanCPA repo root**, not from `template/`.

## 1. Verify API token

```bash
export CLOUDFLARE_API_TOKEN=your_token

docker run --rm -v "$PWD":/app -w /app \
  -e CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
  node:20 npx wrangler whoami
```

Required permissions: `D1:Edit`, `Workers R2 Storage:Edit`, `Cloudflare Pages:Edit`, `Workers Scripts:Edit`.

Enable R2 first: Dashboard → R2 Overview → Enable (free tier, may require billing card).

## 2. Create D1 + R2 (alpha + prod)

**Do not run `template/scripts/setup-cloudflare.sh`** — it creates `portfolio-*` resources and edits `template/wrangler.toml`.

Use the FanCPA script instead:

```bash
cd /Users/chenghaochen/Projects/FanCPA-Web
chmod +x scripts/setup-cloudflare.sh
CLOUDFLARE_API_TOKEN=your_token ./scripts/setup-cloudflare.sh # Choose: preview+prod → y
```

What it does:

| Option | Creates | Migrations |
|--------|---------|------------|
| `alpha` | `fancpa-db-alpha` + `fancpa-images-alpha` | alpha only |
| `prod` | `fancpa-db` + `fancpa-images` | prod only |
| `alpha+prod` | both (recommended) | both |
| `all` | above + `fancpa-db-preview` + `fancpa-images-preview` | all three |

It also updates `wrangler.toml` with real database IDs.

What it does **not** do:

- Create the Pages project
- Connect GitHub
- Configure branch control
- Set encrypted secrets

## 3. Alpha branch → alpha environment

Cloudflare Pages only has two wrangler envs: `preview` and `production`. **Alpha maps to `[env.preview]`** in `wrangler.toml`.

Dashboard → Pages → fancpa-web → Settings → Builds → **Branch control**:

```
Production branch: main          (automatic deployments ON)
Preview branch:   Custom → alpha
```

Result:

- Push/merge to `alpha` → deploys Preview env → `https://alpha.fancpa-web.pages.dev`
- Push/merge to `main` → deploys Production env → `https://fancpa-web.pages.dev`

Create the `alpha` branch in GitHub if it does not exist yet:

```bash
git checkout -b alpha
git push -u origin alpha
```

## 4. Connect GitHub + Pages project

Dashboard → Pages → Create → Connect to Git → `fancpallc/FanCPA-Web`

| Setting | Value |
|---------|-------|
| Build command | `npm run build` |
| Build output | `dist` |
| Root directory | `/` |

After first deploy, configure bindings under Settings → Functions:

- **Preview:** D1 `fancpa-db-alpha` (binding `DB`), R2 `fancpa-images-alpha` (binding `R2_BUCKET`)
- **Production:** D1 `fancpa-db` (binding `DB`), R2 `fancpa-images` (binding `R2_BUCKET`)

Bindings should auto-sync from `wrangler.toml` once committed with real IDs.

## 5. Verify

```bash
curl https://alpha.fancpa-web.pages.dev/api/health
curl https://fancpa-web.pages.dev/api/health
```

## Template script vs FanCPA script

| | `template/scripts/setup-cloudflare.sh` | `scripts/setup-cloudflare.sh` |
|--|--|--|
| Run from | `template/` | FanCPA repo root |
| D1 names | `portfolio-db*` | `fancpa-db*` |
| R2 names | `portfolio-images*` | `fancpa-images*` |
| Updates | `template/wrangler.toml` | `wrangler.toml` |
| Sets up alpha+prod? | Yes, if run from template with `alpha+prod` | Yes, with `alpha+prod` |

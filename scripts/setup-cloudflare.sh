#!/bin/bash
set -e

# Setup Cloudflare D1 + R2 for FanCPA alpha / prod / preview
# Uses Docker to bypass host proxy. Prompts for API token securely.
# Idempotent: safe to re-run, will reuse existing DBs/R2 and apply pending migrations.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}=== FanCPA Cloudflare Setup (D1+R2) ===${NC}"
echo ""

if ! command -v docker &> /dev/null; then
  echo -e "${RED}Docker not found. Install Docker Desktop.${NC}"
  exit 1
fi

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo -e "${YELLOW}Get token: https://dash.cloudflare.com/profile/api-tokens → Create Custom Token${NC}"
  echo "Perms: D1:Edit, Workers R2 Storage:Edit, Cloudflare Pages:Edit, Workers Scripts:Edit"
  echo ""
  read -s -p "Enter CLOUDFLARE_API_TOKEN: " CLOUDFLARE_API_TOKEN
  echo ""
  if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo -e "${RED}Token empty, abort.${NC}"
    exit 1
  fi
fi

CLOUDFLARE_API_TOKEN=$(echo "$CLOUDFLARE_API_TOKEN" | tr -d '\n' | xargs)

echo ""
echo "Options:"
echo "  preview     → only preview (e.g., alpha.fancpa-web.pages.dev)"
echo "  prod        → only prod (fancpa-web.pages.dev)"
echo "  preview+prod → both (recommended)"
echo ""
read -p "Which envs? [preview/prod/preview+prod] [default: preview+prod]: " ENVS
ENVS=${ENVS:-preview+prod}

ENVS_TO_CREATE=()
if [[ "$ENVS" == "preview" ]]; then
  ENVS_TO_CREATE=("preview")
elif [[ "$ENVS" == "prod" ]]; then
  ENVS_TO_CREATE=("production")
elif [[ "$ENVS" == "preview+prod" ]]; then
  ENVS_TO_CREATE=("preview" "production")
else
  echo -e "${RED}Invalid: $ENVS. Use preview, prod, or preview+prod${NC}"
  exit 1
fi

echo ""
echo -e "${YELLOW}Will create D1+R2 for: ${ENVS_TO_CREATE[*]}${NC}"
read -p "Continue? [y/N]: " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

wrangler_run() {
  docker run --rm \
    -v "$PWD":/app \
    -v fancpa_setup_node_modules:/app/node_modules \
    -w /app \
    -e CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
    node:20 sh -c 'npm install --no-audit --no-fund --no-save > /dev/null 2>&1 && npx wrangler "$@"' _ "$@"
}

create_d1() {
  local name=$1
  echo -e "${GREEN}Creating D1: $name${NC}" >&2
  local output
  output=$(wrangler_run d1 create "$name" 2>&1 || true)
  echo "$output" >&2
  local id
  id=$(echo "$output" | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -1)
  if [ -z "$id" ]; then
    echo -e "${YELLOW}  Already exists? Checking list...${NC}" >&2
    local list_out
    list_out=$(wrangler_run d1 list 2>&1 || true)
    id=$(echo "$list_out" | grep -A3 "\"$name\"\|'$name'\| $name " | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -1)
    if [ -z "$id" ]; then
      id=$(echo "$list_out" | grep -B1 -A5 "$name" | grep -oE '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' | head -1)
    fi
  fi
  if [ -n "$id" ]; then
    echo -e "${GREEN}  -> ID: $id${NC}" >&2
  else
    echo -e "${RED}  -> Failed to get ID for $name${NC}" >&2
  fi
  echo "$id"
}

create_r2() {
  local name=$1
  echo -e "${GREEN}Creating R2 bucket: $name${NC}" >&2
  local output
  output=$(wrangler_run r2 bucket create "$name" 2>&1 || true)
  echo "$output" >&2
  if echo "$output" | grep -q "already exists\|Created bucket\|created"; then
    echo -e "${GREEN}  Bucket $name ready${NC}" >&2
    return 0
  fi
  if echo "$output" | grep -q -i "enable R2"; then
    echo -e "${RED}  R2 not enabled! You must enable R2 Storage in the Cloudflare dashboard.${NC}" >&2
    echo -e "${YELLOW}  Go to: https://dash.cloudflare.com/?to=/:account/r2/overview${NC}" >&2
    echo -e "${YELLOW}  Note: This may require adding a credit card to your account.${NC}" >&2
    echo -e "${YELLOW}  After enabling, re-run this script.${NC}" >&2
    return 1
  fi

  echo -e "${RED}  -> Failed to create or verify R2 bucket $name.${NC}" >&2
  return 1
}

migrate_d1() {
  local name=$1
  local env_flag=$2
  echo -e "${GREEN}Migrating D1: $name (remote)${NC}" >&2
  if [ -n "$env_flag" ]; then
    wrangler_run d1 migrations apply "$name" --remote --env "$env_flag" 2>&1 | tail -30 >&2
  else
    wrangler_run d1 migrations apply "$name" --remote 2>&1 | tail -30 >&2
  fi
}

verify_d1() {
  local name=$1
  echo -e "${GREEN}Verifying tables in $name${NC}" >&2
  wrangler_run d1 execute "$name" --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" 2>&1 | tail -20 >&2
}

PREVIEW_ID=""
PROD_ID=""

for env in "${ENVS_TO_CREATE[@]}"; do
  case $env in
    preview)
      PREVIEW_ID=$(create_d1 "fancpa-db-preview")
      if [ -z "$PREVIEW_ID" ]; then
        echo -e "${RED}Fatal: Could not create or find D1 database 'fancpa-db-preview'. Aborting.${NC}" >&2
        exit 1
      fi
      create_r2 "fancpa-images-preview" || exit 1
      ;;
    production)
      PROD_ID=$(create_d1 "fancpa-db")
      if [ -z "$PROD_ID" ]; then
        echo -e "${RED}Fatal: Could not create or find D1 database 'fancpa-db'. Aborting.${NC}" >&2
        exit 1
      fi
      create_r2 "fancpa-images" || exit 1
      ;;
  esac
done

for env in "${ENVS_TO_CREATE[@]}"; do
  case $env in
    preview) [ -n "$PREVIEW_ID" ] && migrate_d1 "fancpa-db-preview" "preview" ;;
    production) [ -n "$PROD_ID" ] && migrate_d1 "fancpa-db" "production" ;; # This is correct for prod
  esac
done

for env in "${ENVS_TO_CREATE[@]}"; do
  case $env in
    preview) [ -n "$PREVIEW_ID" ] && verify_d1 "fancpa-db-preview" ;;
    production) [ -n "$PROD_ID" ] && verify_d1 "fancpa-db" ;; # This is correct for prod
  esac
done

echo -e "${YELLOW}Updating wrangler.toml with IDs...${NC}"

python3 <<PY
import re
import sys

path = "wrangler.toml"
with open(path, "r") as f:
    content = f.read()

preview_id = "${PREVIEW_ID}".strip()
prod_id = "${PROD_ID}".strip()

def update_db_id(content, db_name, new_id, env_name=None):
    """Safely update a database_id for a specific db_name, optionally within an env."""
    if not new_id:
        return content

    # Regex to find a [[d1_databases]] block by its database_name and replace its ID
    db_block_pattern = re.compile(
        r'(\[\[d1_databases\]\][^\[]*?database_name\s*=\s*"' + re.escape(db_name) + r'"[^\[]*?database_id\s*=\s*")[^"]*(")',
        flags=re.DOTALL
    )
    replacement = rf'\g<1>{new_id}\g<2>'

    if env_name:
        # Find the specific [env.name] section and apply the update only within it
        env_section_pattern = re.compile(r'(\[env\.' + re.escape(env_name) + r'\].*?)(?=\n\[env\.|\Z)', flags=re.DOTALL)
        
        found = False
        def env_repl(match):
            nonlocal found
            found = True
            section = match.group(1)
            return db_block_pattern.sub(replacement, section, count=1)
        
        content = env_section_pattern.sub(env_repl, content, count=1)
        if not found:
            print(f"  - Warning: [env.{env_name}] section not found in wrangler.toml", file=sys.stderr)
        return content
    else:
        # Apply to top-level config only, avoiding env sections
        parts = content.split('\n[env.')
        parts[0] = db_block_pattern.sub(replacement, parts[0], count=1)
        return '\n[env.'.join(parts)

if preview_id:
    content = update_db_id(content, "fancpa-db-preview", preview_id, "preview")

if prod_id:
    content = update_db_id(content, "fancpa-db", prod_id, "production")
    content = update_db_id(content, "fancpa-db", prod_id) # Also update top-level default
    
with open(path, "w") as f:
    f.write(content)

print("Updated wrangler.toml")
PY

echo ""
echo -e "${GREEN}=== Setup Complete ===${NC}"
for env in "${ENVS_TO_CREATE[@]}"; do
  case $env in
    preview) echo -e "  - ${GREEN}preview env:${NC} fancpa-db-preview, fancpa-images-preview" ;;
    production) echo -e "  - ${GREEN}prod env:${NC}    fancpa-db, fancpa-images" ;; # This is correct for prod
  esac
done
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Commit wrangler.toml with real IDs"
echo "  2. Cloudflare Dashboard → Pages → Create → Connect GitHub → fancpallc/FanCPA-Web"
echo "  3. Build: npm run build | Output: dist"
echo "  4. Branch control: Production = main, Preview = any non-main branch (or set a custom one like 'alpha' if you want a dedicated preview branch)"
echo "  5. Bindings: Preview → fancpa-db-preview + fancpa-images-preview, Production → fancpa-db + fancpa-images"

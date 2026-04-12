# Codex Skills & MCP Guide (Local Setup)

This guide documents where your skills live, what each one does, and how to use them with your current Codex setup. It also covers MCP servers (Vercel/Supabase) and the Superpowers skill pack.

---

## Where Skills Live

Most skills are installed in:

- `~/.codex/skills/`

Examples (your current installs):
- `~/.codex/skills/ui-ux-pro-max`
- `~/.codex/skills/frontend-skill`
- `~/.codex/skills/playwright`
- `~/.codex/skills/playwright-interactive`
- `~/.codex/skills/vercel-deploy`

System skills are bundled under:
- `~/.codex/skills/.system/`

**Superpowers** is a skill pack discovered via a symlink:
- Repo clone: `~/.codex/superpowers`
- Symlink for Codex discovery: `~/.agents/skills/superpowers` → `~/.codex/superpowers/skills`

---

## How Skill Routing Works

Skills are driven by `SKILL.md` files. You can invoke a skill by:

- Explicitly naming it in your request (e.g., “use `playwright`”).
- Asking for a task that clearly matches the skill description.

If you want to force a specific skill, just include its name in backticks.

---

## Installed Skills (What They Do + How To Use)

### 1) `ui-ux-pro-max`
**Use it for:** UI/UX design decisions, layout, typography, spacing, interaction patterns, and accessibility.

**Key workflow (design system):**
```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
python3 "$CODEX_HOME/skills/ui-ux-pro-max/scripts/search.py" \
  "<product_type> <industry> <keywords>" --design-system -p "Project Name"
```

**Persist a design system (recommended):**
```bash
python3 "$CODEX_HOME/skills/ui-ux-pro-max/scripts/search.py" \
  "<query>" --design-system --persist -p "Project Name"
```

**Deep dive on a domain (style, color, typography, ux, chart):**
```bash
python3 "$CODEX_HOME/skills/ui-ux-pro-max/scripts/search.py" \
  "<keyword>" --domain <domain>
```

---

### 2) `frontend-skill`
**Use it for:** Premium, art-directed UI and landing pages with strong hierarchy and motion.

**How it works:** It’s a design-direction skill. It doesn’t require commands; it shapes how I build UI:
- One dominant visual idea per section
- Full-bleed hero preferred
- Sparse, strong copy
- Minimal UI clutter (no default card grids)

**Best prompt pattern:**
```
Use frontend-skill. Build a landing page for <product>. 
Style: <mood>, <material>, <energy>. 
Hero, support, detail, final CTA.
```

---

### 3) `playwright`
**Use it for:** Browser automation, scraping, screenshots, navigation, and UI-flow debugging from the terminal.

**Prereq check:**
```bash
command -v npx >/dev/null 2>&1
```

**Set the wrapper once (recommended):**
```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
```

**Core loop:**
```bash
"$PWCLI" open https://example.com --headed
"$PWCLI" snapshot
"$PWCLI" click e3
"$PWCLI" snapshot
"$PWCLI" screenshot
```

**Notes:**
- Always `snapshot` before using element refs like `e12`.
- Re-snapshot after navigation or major DOM changes.
- Default to CLI commands (not Playwright test specs).
- Artifacts go in `output/playwright/`.

---

### 4) `playwright-interactive`
**Use it for:** Persistent, iterative debugging with a live Playwright session (handles stay alive between steps).

**Requirements:**
- Enable `js_repl` in `~/.codex/config.toml`:
  ```toml
  [features]
  js_repl = true
  ```
- Start Codex with sandbox disabled:
  - `--sandbox danger-full-access`

**Setup (one-time per workspace):**
```bash
npm init -y
npm install playwright
node -e "import('playwright').then(() => console.log('playwright import ok'))"
```

**Use when:**
- You want to keep browser state between runs
- You’re debugging a local UI or Electron app interactively

---

### 5) `vercel-deploy`
**Use it for:** Deploying a project to Vercel.

**Default behavior:** Always deploy **preview** unless you explicitly request production.

**CLI flow:**
```bash
command -v vercel
vercel deploy [path] -y
```

**Fallback script (no auth / CLI failure):**
```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
bash "$CODEX_HOME/skills/vercel-deploy/scripts/deploy.sh" /path/to/project
```

---

## MCP Servers (Vercel + Supabase)

Your MCP servers are defined in:
- `~/.codex/config.toml`

Current entries:
```toml
[mcp_servers.vercel]
url = "https://mcp.vercel.com"

[mcp_servers.supabase]
url = "https://mcp.supabase.com/mcp"
```

**Notes:**
- Supabase is currently **read + write** for all projects.
- You can scope it later:
  ```toml
  url = "https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF"
  ```
- Restart Codex after changes to `config.toml`.

---

## Superpowers Skill Pack

Installed via:
- Repo: `~/.codex/superpowers`
- Symlink: `~/.agents/skills/superpowers`

**Update:**
```bash
cd ~/.codex/superpowers && git pull
```

**Verify:**
```bash
ls -la ~/.agents/skills/superpowers
```

---

## Installing More Skills (Curated or Experimental)

Use the system skill installer:
```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
python3 "$CODEX_HOME/skills/.system/skill-installer/scripts/list-skills.py"
```

Install a curated skill:
```bash
python3 "$CODEX_HOME/skills/.system/skill-installer/scripts/install-skill-from-github.py" \
  --repo openai/skills \
  --path skills/.curated/<skill-name>
```

Install an experimental skill:
```bash
python3 "$CODEX_HOME/skills/.system/skill-installer/scripts/install-skill-from-github.py" \
  --repo openai/skills \
  --path skills/.experimental/<skill-name>
```

**Always restart Codex after installing new skills.**

---

## Quick Verification

List local skills:
```bash
ls ~/.codex/skills
```

Check Superpowers discovery:
```bash
ls -la ~/.agents/skills/superpowers
```

---

## Practical Defaults (Recommended)

- Use `ui-ux-pro-max` for design systems and UX reviews.
- Use `frontend-skill` when the UI must feel premium and art‑directed.
- Use `playwright` for automation and scraping.
- Use `playwright-interactive` only for persistent debugging sessions.
- Use `vercel-deploy` only when you’re ready to publish.

If you want, tell me the next task and I’ll route to the right skill automatically.

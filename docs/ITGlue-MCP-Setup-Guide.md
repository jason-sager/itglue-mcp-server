# Connect Claude to IT Glue — Setup Guide

*About 10 minutes · uses the `@jasonsager/itglue-mcp-server` connector*

This lets Claude find and read your IT Glue documentation. You'll create a personal API key, add one block to your Claude config, then (optionally) build a local search cache so Claude can search across everything — including document contents — instantly.

## Step 1 — Get your personal IT Glue API key

Everyone uses their **own** key, so activity is traceable and access can be turned off individually. Don't share keys.

1. Sign in to IT Glue. You need the **Administrator** role to see API keys — if you don't have it, ask IT.
2. Go to **Admin → Settings → API Keys**.
3. Click **+** to create a new key.
4. Name it `Firstname - Claude MCP` so it's obvious whose it is (e.g. `Jason - Claude MCP`).
5. **Leave the "Password Access" box UNCHECKED.** This keeps credentials completely out of reach.
6. Click **Generate**, then **copy the key somewhere safe immediately** — IT Glue will not show it again.

> ⚠️ **Heads up:** a key left unused for 90 days is automatically revoked. If Claude suddenly can't connect after a long break, generate a fresh key and repeat this step.

## Step 2 — Add the connector to your Claude config

Open your Claude config file: **Settings → Developer → Edit Config** (this opens `claude_desktop_config.json`).

You're adding an `"itglue"` entry under a top-level `"mcpServers"` key. There are two cases:

- **No `"mcpServers"` yet?** Paste the whole block below as the **first** entry inside the outer `{ }` — right after the opening brace is easiest.
- **Already have `"mcpServers"`?** Add just the `"itglue": { ... }` entry inside it, alongside any others.

```json
{
  "mcpServers": {
    "itglue": {
      "command": "npx",
      "args": ["-y", "@jasonsager/itglue-mcp-server"],
      "env": {
        "ITGLUE_API_KEY": "paste-your-key-here"
      }
    }
  }
}
```

1. Replace `paste-your-key-here` with the key from Step 1 (keep the quotation marks).
2. Save the file, then **fully quit and reopen Claude**.

> 💡 **JSON nudge:** this file is strict JSON. Every entry inside a `{ }` needs a comma after it *except the last one* — so if you're adding `"mcpServers"` next to existing keys, put a comma between them, and never leave a trailing comma before a closing `}`. If Claude won't start after editing, a stray or missing comma is almost always the cause.

> 🌍 **Not in the US?** Inside the `"env"` block, add `"ITGLUE_BASE_URL": "https://api.eu.itglue.com"` for the EU, or `"https://api.au.itglue.com"` for Australia. Most of us are US — ask IT if unsure.

## Step 3 — Build the local search cache *(recommended)*

Out of the box, Claude looks documents up live, one organization at a time, by title. Building a local cache lets it search **across every organization instantly** and search **inside document contents**, not just titles. The cache lives on your machine, is compressed, and stores content as keyword terms only (not human-readable).

You don't touch any files for this — just ask Claude in chat:

- **"Index all IT Glue document titles."** — quick; covers every organization.
- **"Index the contents of \<organization\>."** — for orgs you search often. This reads document bodies, so it takes longer (one organization at a time).
- **"Search IT Glue for \<topic\>."** — add *"including content"* to search inside documents, not just titles.
- **"Refresh the IT Glue index."** — run occasionally to pick up new or changed documents (only the changes are re-fetched, so it's fast).

> 💡 **Tip:** ask *"What's in the IT Glue search index?"* anytime to see which organizations are cached and whether the data is stale.

---

## Quick check & troubleshooting

- After restarting, ask Claude **"List my IT Glue organizations."** If you get a list back, you're connected.
- No IT Glue tools showing up? Check, in order: (1) the JSON is valid — **commas**; (2) the key is pasted correctly, inside quotes; (3) you **fully restarted** Claude; (4) the key hasn't been 90-day-revoked (Step 1).

---

*Connector: `@jasonsager/itglue-mcp-server` (npm). Unofficial, community-maintained; based on [Junto-Platforms/itglue-mcp-server](https://github.com/Junto-Platforms/itglue-mcp-server). Not affiliated with or endorsed by Kaseya/IT Glue.*

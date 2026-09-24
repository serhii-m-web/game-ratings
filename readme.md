# Game Ratings

A shared game scoreboard: rows are games, columns are players. Data lives in Supabase and syncs for everyone in real time.

## Features

- Sign in with a 4-digit PIN: only your column unlocks
- Guest PIN `0000`: view the table only — no adding games and no scores
- Anyone else signed in can add games; scores go only in your own column
- Steam search (from 2 characters): title and banner are filled from the suggestion
- After save, the title becomes read-only text; duplicates are blocked
- List filter and sort by name, date, or rating (default: newest first)
- Scores from 0 to 10, step 0.1: `7.5`, `7,5`, or `75` → `7.5`. Saved on blur
- Admin: delete games, manage players (name, PIN, add and remove)
- Switch player without logging out: the PIN overlay can be dismissed (Cancel / Escape / backdrop)
- Share copies a link to the table

## Stack

- Vite 4, TypeScript, Handlebars
- SCSS
- [Supabase](https://supabase.com): Postgres, RLS, RPC, Realtime, Edge Function `search-games`

## Local setup

You need Node 18+ and npm.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the project keys:

   ```bash
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
   ```

3. Start the dev server:

   ```bash
   npm run dev
   ```

Vite uses sources from `src/` and environment variables from the repo root.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Local server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the build |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## How to use

**Guest PIN: `0000`** — opens the table in view-only mode.

1. Open the table and enter your PIN — your column unlocks.
2. **Add game** creates an empty row. Start typing a title and pick a Steam result.
3. Enter a score in your column. Other players’ cells stay locked.
4. **Search list** filters games already on the board.
5. **Switch player** opens another person’s PIN overlay without dropping the session immediately.
6. An admin sees **Players** and can delete games.

## Backend

The client reads tables directly and writes through `SECURITY DEFINER` RPCs (a valid session is required).

| Table | Purpose |
| --- | --- |
| `players` | Players, PIN hash, admin/guest flags, column order |
| `games` | Title and banner. Unique on `lower(trim(title))` |
| `ratings` | Score `0…10` per game + player |
| `player_sessions` | Session token, 30-day lifetime |

Main RPCs: `unlock_with_pin`, `get_session`, `add_game`, `update_game`, `delete_game`, `set_rating`, `add_player`, `update_player`, `delete_player`, `import_board`.

Steam search goes through the `search-games` Edge Function. Realtime is subscribed to `games`, `ratings`, and `players`.

The anon key ships in the client bundle — that is expected. Write protection comes from RLS and session checks in RPCs, not from hiding the key.

## Deploy to GitHub Pages

A push to `main` runs `.github/workflows/static.yml`: Vite build and publish of `dist/`.

The repo needs these Actions secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Local `.env` is not committed.

## Structure

```
src/
  index.html
  js/          # board, API, Steam search
  sections/    # board markup
  styles/      # SCSS
  templates/   # header / footer
public/        # favicon
```

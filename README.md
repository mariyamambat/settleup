# SettleUp 💸

Shared-expense tracker for roommates and trip groups, with uneven splits and a **minimal-payments settle-up algorithm**.

**Live app:** https://settleup-8vjl.onrender.com · **Demo video:** https://drive.google.com/file/d/1W3-s8vsz9AqXAIIiMtAEveuTjUYATktK/view?usp=drive_link

## Problem Statement
Groups sharing costs (flatmates, trips) lose track of who paid what. Splits are rarely equal, and settling pairwise creates a mess of small payments.

## Target Users
College students, roommates and friend groups who share bills in INR.

## Solution
Members log expenses with equal, exact-amount or percentage splits. The app keeps an exact ledger in integer cents, computes each person's net balance, and suggests the fewest payments that clear every debt.

## Key Features
- Sign up / log in (bcrypt-hashed passwords, JWT sessions)
- Create groups and add registered members by email (owner only)
- Add expenses: equal (subset of members), exact amounts, or percentages; validated server-side so shares always sum to the total
- Live balances and suggested payments (greedy debt simplification, at most n-1 transfers)
- "Mark paid" settlements, rejected if they exceed what you actually owe
- Delete expenses (payer or group owner only)
- Loading, empty, success and error states; network-failure handling

## Tech Stack
Node.js 22.13+, Express, SQLite (built-in `node:sqlite`), vanilla JS frontend, helmet, express-rate-limit, node:test.

## Architecture
- `lib/settle.js` – pure functions: `splitAmount`, `netBalances`, `simplify` (unit tested, no I/O)
- `server.js` – REST API, SQLite schema, auth middleware (`auth`, `member` membership check), centralised error handler
- `public/` – single-page frontend; all user content HTML-escaped (XSS-safe) under helmet's CSP
- Data model: `users`, `grps`, `members`, `expenses`, `splits`, `settlements`. Balances are *derived* from these tables, never stored, so they can't drift.
- Writes that touch several tables use SQLite transactions.

## Local Setup
    git clone <your-repo-url> && cd settleup
    npm install
    cp .env.example .env     # then set a long random JWT_SECRET
    npm run dev              # http://localhost:3000
    npm test

## Environment Variables
| Name | Purpose |
|---|---|
| `JWT_SECRET` | Required. 16+ random chars used to sign tokens |
| `PORT` | Optional, default 3000 |
| `DB_PATH` | Optional SQLite file path, default `data.db` |

## Deployment
Deployed on Render (Web Service): build `npm install`, start `npm start`, env var `JWT_SECRET`. Note: free-tier disks are ephemeral, so attach a persistent disk and set `DB_PATH` to it for permanent data.

## Security Notes
No secrets in the repo (`.env` is git-ignored); passwords hashed; rate-limited auth endpoints; JSON body size limit; every group route verifies membership; parameterised SQL only.

## Limitations / Future work
Members must already be registered; no email notifications; no multi-currency.

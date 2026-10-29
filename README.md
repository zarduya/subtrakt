# Subtrakt

**Find every subscription and free trial hiding in your Gmail, and get reminded before they renew.**

Live app: [subtrakt.vercel.app](https://subtrakt.vercel.app)

<!-- Add a screenshot of the dashboard here, e.g. ![Subtrakt dashboard](docs/dashboard.png) -->

## The problem

Subscriptions and free trials are easy to forget. They renew quietly, and the only record is a receipt buried somewhere in your inbox.

## What it does

1. **Sign in with Google.** Subtrakt asks only for read-only Gmail access.
2. **Scan.** It searches your inbox for billing, renewal, receipt and trial emails, and filters out noise such as login codes, password resets and delivery updates.
3. **Extract with an LLM.** Each matching email's subject, sender and date go to Claude (Haiku), which returns structured JSON: service name, amount, currency, billing cycle, renewal date, status and whether it's a free trial.
4. **Clean up.** Results are de-duplicated by service, keeping the most recent email for each one.
5. **Remind.** Subscriptions are saved to a Postgres database, and reminders are created for 7 days and 1 day before each renewal. A daily scheduled job emails them out.

## How the AI extraction works

- **Structured output:** the system prompt defines a strict JSON schema, and the response is parsed before it's stored, and any reply that isn't valid JSON is skipped rather than saved.
- **Privacy by design:** only email metadata (subject, sender, date) is sent to the model, never the full email body.
- **Iterated on real data:** the prompt and the Gmail search query were refined by testing against real receipts, to catch services the first version missed and to drop false positives.

## Tech stack

| Area | Tools |
|---|---|
| Frontend and API | Next.js (App Router), React, TypeScript |
| Auth | NextAuth with Google OAuth (`gmail.readonly` scope) |
| AI | Anthropic Claude API |
| Database | Supabase (PostgreSQL) |
| Email | Resend |
| Hosting and scheduling | Vercel, Vercel Cron (daily at 08:00) |

## Run it locally

```bash
npm install
npm run dev
```

Create a `.env.local` file with your own keys (never commit it):

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
ANTHROPIC_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
```

## What I'd improve next

- Read the email body (with consent) to capture prices that only appear inside receipts.
- Build a small labelled test set of receipts to measure extraction accuracy over time.
- Protect the scheduled reminder endpoint with a secret, so only the cron job can trigger it.

## About

Built by Surya Prakash Vaddewata, an MSc Data Science student at the University of Hertfordshire, using AI-assisted development (Claude Code).



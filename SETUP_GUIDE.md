# Daily Duo Streak — Deploy to Vercel

This is a Next.js app with a shared Supabase database. It is not connected to your accounts yet; follow the steps below to create your own backend and deploy it.

## A. Create the Supabase project
1. Go to https://supabase.com/ and create a project.
2. In Project Settings → API, copy the **Project URL** and the **publishable/anon key**.
3. Open SQL Editor → New query. Copy all of `supabase/schema.sql` into it and run it.
4. In Authentication → Providers, make sure Email is enabled.
5. For a quick first test, you can turn email confirmation off in Authentication settings; for public use, keep confirmation on and configure the site URL / redirect URLs.
6. In Authentication URL Configuration, add your Vercel URL after deployment to Site URL and Redirect URLs.

## B. Run locally (optional)
1. Install Node.js LTS.
2. Extract the project ZIP.
3. Copy `.env.example` to `.env.local`.
4. Fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Run:
   ```bash
   npm install
   npm run dev
   ```
6. Open http://localhost:3000.

## C. Deploy to Vercel
1. Create a GitHub repository and upload these project files.
2. Go to https://vercel.com/new and import that repository.
3. In Vercel → Project Settings → Environment Variables, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy. If you add/change environment variables after deploying, redeploy the project.
5. Add the deployed URL to Supabase Authentication URL Configuration.

## D. Use it together
1. Open the deployed app and create an account.
2. Create a duo and choose your display name.
3. Copy the invite code and send it to your friend.
4. Your friend creates her own account and joins with that code.
5. The app creates today's page the first time a member opens it, with three suggested tasks per person. Both can add tasks and mark tasks complete.

## Current implementation notes
- Daily page creation and suggested task generation happen when a member opens the app on a new day; this is not a background midnight job.
- Streak is calculated from the days/tasks currently loaded in the app. This starter loads recent days but currently loads task records for today's page only, so the calendar/streak history needs a follow-up query to be fully accurate for past days. The UI and core collaboration are implemented, but don't treat streak history as production-ready until this query is added.
- If you need tasks generated at a precise time while neither of you opens the app, use a scheduled automation (e.g. Make or a Supabase scheduled Edge Function). You do not need that for a simple first version.
- Never expose a Supabase service-role key in client-side environment variables. Only use the publishable/anon key in `NEXT_PUBLIC_*`.

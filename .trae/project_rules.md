## Supabase Integration Rules

- All database queries must use the Supabase helpers in `lib/supabase/`.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to client components.
- Always enable RLS on new tables and scope user-owned rows by `auth.uid()`.
- Cache prediction records for 30 days in `predictions_cache`.
- Store user-generated content with `user_id` when authenticated.
- Use `client_id` fallback only for local/non-authenticated development flows.
- Prefer database functions or shared helpers for repeated prediction cache queries.


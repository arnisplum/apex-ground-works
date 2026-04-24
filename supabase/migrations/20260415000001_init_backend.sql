-- Apex Ground Works — initial backend schema (Smart Quote + staff invites)
-- Apply via Supabase CLI (`supabase db push`) or SQL Editor after review.

-- ---------------------------------------------------------------------------
-- quote_requests: persisted Smart Quote intake + AI summary
-- ---------------------------------------------------------------------------
create table if not exists public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'submitted'
    constraint quote_requests_status_check
      check (status in (
        'draft',
        'submitted',
        'ai_processing',
        'ai_ready',
        'ai_failed',
        'reviewed',
        'closed'
      )),
  source text not null default 'smart_quote',

  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  project_address text not null,
  project_description text not null,
  project_type text,
  timing text,

  attachment_manifest jsonb not null default '[]'::jsonb,

  ai_summary text,
  ai_model text,
  ai_generated_at timestamptz
);

create index if not exists quote_requests_created_at_idx
  on public.quote_requests (created_at desc);

create index if not exists quote_requests_status_idx
  on public.quote_requests (status);

comment on table public.quote_requests is 'Smart Quote submissions; written by Edge Function (service role) or controlled insert policy.';

-- ---------------------------------------------------------------------------
-- staff_profiles: one row per authorized Google user (post-invite)
-- ---------------------------------------------------------------------------
create table if not exists public.staff_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'estimator'
    constraint staff_profiles_role_check
      check (role in ('admin', 'estimator')),
  created_at timestamptz not null default now()
);

create unique index if not exists staff_profiles_email_lower_idx
  on public.staff_profiles (lower(email));

comment on table public.staff_profiles is 'Internal staff; created when an invited user first signs in with Google.';

-- ---------------------------------------------------------------------------
-- staff_invites: admin adds email before first login (no client RLS access)
-- ---------------------------------------------------------------------------
create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null default 'estimator'
    constraint staff_invites_role_check
      check (role in ('admin', 'estimator')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  accepted_at timestamptz
);

create unique index if not exists staff_invites_one_pending_per_email
  on public.staff_invites (lower(email))
  where accepted_at is null;

comment on table public.staff_invites is 'Pending invites; managed via Dashboard or service-role admin API.';

-- ---------------------------------------------------------------------------
-- quote_notes: internal estimator notes (optional from day one)
-- ---------------------------------------------------------------------------
create table if not exists public.quote_notes (
  id uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists quote_notes_quote_id_idx
  on public.quote_notes (quote_request_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists quote_requests_set_updated_at on public.quote_requests;
create trigger quote_requests_set_updated_at
  before update on public.quote_requests
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Link Google (or any) auth user to staff_profiles when invite exists
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user_staff_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv_id uuid;
  inv_role text;
begin
  select i.id, i.role
  into inv_id, inv_role
  from public.staff_invites i
  where lower(i.email) = lower(new.email)
    and i.accepted_at is null
    and (i.expires_at is null or i.expires_at > now())
  order by i.created_at desc
  limit 1;

  if inv_id is null then
    return new;
  end if;

  insert into public.staff_profiles (id, email, role)
  values (new.id, new.email, inv_role)
  on conflict (id) do update
    set email = excluded.email;

  update public.staff_invites
  set accepted_at = now()
  where id = inv_id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_staff_invite on auth.users;
create trigger on_auth_user_created_staff_invite
  after insert on auth.users
  for each row
  execute function public.handle_new_user_staff_invite();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.quote_requests enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.staff_invites enable row level security;
alter table public.quote_notes enable row level security;

-- Staff can read all quote requests
drop policy if exists "Staff select quote_requests" on public.quote_requests;
create policy "Staff select quote_requests"
  on public.quote_requests
  for select
  to authenticated
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.id = (select auth.uid())
    )
  );

-- Staff can update operational fields (adjust columns as admin UI grows)
drop policy if exists "Staff update quote_requests" on public.quote_requests;
create policy "Staff update quote_requests"
  on public.quote_requests
  for update
  to authenticated
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.staff_profiles sp
      where sp.id = (select auth.uid())
    )
  );

-- quote_notes: staff only
drop policy if exists "Staff select quote_notes" on public.quote_notes;
create policy "Staff select quote_notes"
  on public.quote_notes
  for select
  to authenticated
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.id = (select auth.uid())
    )
  );

drop policy if exists "Staff insert quote_notes" on public.quote_notes;
create policy "Staff insert quote_notes"
  on public.quote_notes
  for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.staff_profiles sp
      where sp.id = (select auth.uid())
    )
  );

-- staff_profiles: users read own row
drop policy if exists "Staff read own profile" on public.staff_profiles;
create policy "Staff read own profile"
  on public.staff_profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

-- No insert/update/delete on staff_invites for anon/authenticated via PostgREST
-- (manage invites with service role or SQL editor until admin Edge Function exists)

-- ---------------------------------------------------------------------------
-- Optional: allow anonymous INSERT for quote_requests (direct-from-browser).
-- REMOVE this policy if ONLY Edge Functions (service role) insert quotes.
-- ---------------------------------------------------------------------------
drop policy if exists "Anon insert quote_requests" on public.quote_requests;
create policy "Anon insert quote_requests"
  on public.quote_requests
  for insert
  to anon
  with check (true);

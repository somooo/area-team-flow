create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  subject text not null,
  body text not null,
  link text,
  event_type text not null,
  related_id uuid,
  status text not null default 'queued',
  attempts int not null default 0,
  last_error text,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_outbox_status_sched_idx on public.email_outbox (status, scheduled_for);
create index email_outbox_created_idx on public.email_outbox (created_at);

grant all on public.email_outbox to service_role;
alter table public.email_outbox enable row level security;

alter table public.staff add column if not exists email_notifications boolean not null default true;
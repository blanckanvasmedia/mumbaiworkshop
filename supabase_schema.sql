-- ==============================================================================
-- BK EDU by Minaaz — Mumbai Mega Workshop
-- Supabase Database Schema for Registration & Payment Tracking
-- ==============================================================================
-- Run this script in your Supabase SQL Editor (Dashboard -> SQL Editor -> New Query -> Run)

-- 1. Create registrations table
create table if not exists public.registrations (
    id uuid primary key default gen_random_uuid(),
    registration_id text unique not null,
    full_name text not null,
    email text not null,
    phone text not null,
    city text,
    amount integer not null default 1500,
    currency text not null default 'INR',
    payment_status text not null default 'Pending' 
        check (payment_status in ('Pending', 'Paid', 'Failed', 'Refunded')),
    razorpay_order_id text,
    razorpay_payment_id text,
    razorpay_signature text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_term text,
    utm_content text,
    referrer text,
    notes jsonb,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Create indexes for high performance search & filtering
create index if not exists idx_registrations_reg_id on public.registrations(registration_id);
create index if not exists idx_registrations_payment_status on public.registrations(payment_status);
create index if not exists idx_registrations_email on public.registrations(email);
create index if not exists idx_registrations_phone on public.registrations(phone);
create index if not exists idx_registrations_order_id on public.registrations(razorpay_order_id);
create index if not exists idx_registrations_payment_id on public.registrations(razorpay_payment_id);
create index if not exists idx_registrations_created_at on public.registrations(created_at desc);

-- 3. Row Level Security (RLS)
-- Enable RLS to prevent public/anonymous client-side scraping
alter table public.registrations enable row level security;

-- Only service role (serverless backend) has full access
-- Anonymous users cannot read or modify the data directly from client
drop policy if exists "Service role full access" on public.registrations;
create policy "Service role full access" 
on public.registrations 
for all 
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

-- 4. Automatically update updated_at timestamp on row change
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
    new.updated_at = timezone('utc'::text, now());
    return new;
end;
$$ language plpgsql;

drop trigger if exists set_registrations_updated_at on public.registrations;
create trigger set_registrations_updated_at
before update on public.registrations
for each row
execute function public.update_updated_at_column();

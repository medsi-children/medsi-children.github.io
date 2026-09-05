create table if not exists chat_profiles (
  phone10 text primary key,
  parent_name text not null default '',
  child_name text not null default '',
  active boolean not null default true,
  source text not null default 'appscript',
  last_verified_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists chat_sessions (
  token_hash text primary key,
  role text not null check (role in ('parent','educator')),
  phone10 text not null default '',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index if not exists chat_sessions_phone_idx on chat_sessions(phone10);
create index if not exists chat_sessions_expires_idx on chat_sessions(expires_at);

create table if not exists chat_messages (
  message_key text primary key,
  phone10 text not null,
  side text not null check (side in ('parent','educator')),
  type text not null default 'text',
  text text not null default '',
  file_id text not null default '',
  delete_after timestamptz,
  status text not null default 'active',
  read_by_parent boolean not null default false,
  read_by_educator boolean not null default false,
  reaction text not null default '',
  reply_to_key text not null default '',
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists chat_messages_phone_created_idx on chat_messages(phone10, created_at desc);
create index if not exists chat_messages_status_idx on chat_messages(status);

create table if not exists chat_pins (
  phone10 text primary key,
  bucket text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists chat_media (
  file_id text primary key,
  storage_key text not null unique,
  content_type text not null default 'application/octet-stream',
  original_name text not null default '',
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

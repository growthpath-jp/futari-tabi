-- ============================================================
-- ふたりの旅：データベース設計（Supabase の SQL Editor に貼って実行）
-- 将来のプラン共有サービスにそのまま広げられるよう、
-- 「グループ（夫婦）」単位でデータを持つ形にしています。
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 種類 ----------
do $$ begin
  create type public.place_status as enum ('want', 'visited', 'missed', 'detour');
exception when duplicate_object then null; end $$;
-- want=行きたい / visited=予定通り行った / missed=行けなかった / detour=寄り道

-- ---------- テーブル ----------
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'ふたりの旅',
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id     uuid not null references public.groups(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text,
  joined_at    timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.trips (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  title      text not null,
  start_date date,
  end_date   date,
  closed     boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.places (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips(id) on delete cascade,
  group_id      uuid not null references public.groups(id) on delete cascade,
  name          text,
  address       text,
  lat           double precision not null check (lat between -90 and 90),
  lng           double precision not null check (lng between -180 and 180),
  status        public.place_status not null default 'want',
  source        text not null default 'manual' check (source in ('address', 'name', 'manual', 'photo')),
  note          text,
  adjusted      boolean not null default false,
  registered_at timestamptz not null default now(),
  visited_at    timestamptz,
  created_by    uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.photos (
  id           uuid primary key default gen_random_uuid(),
  place_id     uuid references public.places(id) on delete cascade,
  trip_id      uuid not null references public.trips(id) on delete cascade,
  group_id     uuid not null references public.groups(id) on delete cascade,
  storage_path text not null unique,
  taken_at     timestamptz,
  lat          double precision,
  lng          double precision,
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

-- 引き出し（表示条件を名前を付けて保存したもの）
-- filter の形：{"trips":"all" または [旅id...], "from":"2026-01-01", "to":"2026-12-31",
--              "statuses":["want","visited","missed","detour"], "colorDetour":true, "connect":true}
create table if not exists public.drawers (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  name       text not null,
  filter     jsonb not null default '{"trips":"all","statuses":["want","visited","missed","detour"],"colorDetour":true,"connect":true}',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 引き出しの共有（共有コードを相手がアプリで入力すると、その人に紐づく）
create table if not exists public.drawer_shares (
  id          uuid primary key default gen_random_uuid(),
  drawer_id   uuid not null references public.drawers(id) on delete cascade,
  group_id    uuid not null references public.groups(id) on delete cascade,
  code        text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10)),
  shared_with uuid references auth.users(id) on delete cascade,
  show_photos boolean not null default false,
  show_notes  boolean not null default false,
  created_at  timestamptz not null default now(),
  redeemed_at timestamptz
);

-- ショートカット用の記録キー（1人1つ）
create table if not exists public.ingest_keys (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  group_id   uuid not null references public.groups(id) on delete cascade,
  key        text not null unique default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now()
);

-- 予定（計画）のための項目。旅：始まり・終わり・宿・移動手段・並び順／場所：何日目・時刻・滞在・優先度・休み
-- 形は js/plan.js の normalizePlan / placePlan を参照。共有（引き出し）には出さない
alter table public.trips  add column if not exists plan jsonb not null default '{}'::jsonb;
alter table public.places add column if not exists plan jsonb not null default '{}'::jsonb;

create index if not exists places_trip_idx on public.places(trip_id);
create index if not exists places_group_idx on public.places(group_id);
create index if not exists photos_place_idx on public.photos(place_id);
create index if not exists trips_group_idx on public.trips(group_id);
create index if not exists shares_with_idx on public.drawer_shares(shared_with);

-- ---------- 補助の関数 ----------
create or replace function public.is_member(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members m where m.group_id = gid and m.user_id = auth.uid());
$$;

-- 旅のグループを場所・写真に自動で書き込む（別グループへの紛れ込みを防ぐ）
create or replace function public.set_group_from_trip()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select t.group_id into new.group_id from public.trips t where t.id = new.trip_id;
  if new.group_id is null then raise exception 'trip not found'; end if;
  return new;
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function public.set_share_group()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select d.group_id into new.group_id from public.drawers d where d.id = new.drawer_id;
  if new.group_id is null then raise exception 'drawer not found'; end if;
  return new;
end $$;

drop trigger if exists places_group on public.places;
create trigger places_group before insert or update of trip_id on public.places
  for each row execute function public.set_group_from_trip();
drop trigger if exists photos_group on public.photos;
create trigger photos_group before insert or update of trip_id on public.photos
  for each row execute function public.set_group_from_trip();
drop trigger if exists shares_group on public.drawer_shares;
create trigger shares_group before insert or update of drawer_id on public.drawer_shares
  for each row execute function public.set_share_group();
drop trigger if exists trips_touch on public.trips;
create trigger trips_touch before update on public.trips for each row execute function public.touch_updated_at();
drop trigger if exists places_touch on public.places;
create trigger places_touch before update on public.places for each row execute function public.touch_updated_at();
drop trigger if exists drawers_touch on public.drawers;
create trigger drawers_touch before update on public.drawers for each row execute function public.touch_updated_at();

-- 引き出しの条件に、その旅が入るか
create or replace function public.drawer_includes_trip(f jsonb, t public.trips)
returns boolean language sql stable as $$
  select
    (coalesce(f->'trips', '"all"'::jsonb) = '"all"'::jsonb
      or (jsonb_typeof(f->'trips') = 'array' and (f->'trips') ? t.id::text))
    and (f->>'from' is null or f->>'from' = '' or coalesce(t.end_date, t.start_date) >= (f->>'from')::date)
    and (f->>'to'   is null or f->>'to'   = '' or coalesce(t.start_date, t.end_date) <= (f->>'to')::date);
$$;

-- ---------- 権限ルール（RLS） ----------
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.trips         enable row level security;
alter table public.places        enable row level security;
alter table public.photos        enable row level security;
alter table public.drawers       enable row level security;
alter table public.drawer_shares enable row level security;
alter table public.ingest_keys   enable row level security;

drop policy if exists groups_rw on public.groups;
create policy groups_rw on public.groups for select using (public.is_member(id));
drop policy if exists groups_upd on public.groups;
create policy groups_upd on public.groups for update using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists members_read on public.group_members;
create policy members_read on public.group_members for select using (public.is_member(group_id));
drop policy if exists members_self_upd on public.group_members;
create policy members_self_upd on public.group_members for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists trips_rw on public.trips;
create policy trips_rw on public.trips for all using (public.is_member(group_id)) with check (public.is_member(group_id));
drop policy if exists places_rw on public.places;
create policy places_rw on public.places for all using (public.is_member(group_id)) with check (public.is_member(group_id));
drop policy if exists photos_rw on public.photos;
create policy photos_rw on public.photos for all using (public.is_member(group_id)) with check (public.is_member(group_id));
drop policy if exists drawers_rw on public.drawers;
create policy drawers_rw on public.drawers for all using (public.is_member(group_id)) with check (public.is_member(group_id));
drop policy if exists shares_rw on public.drawer_shares;
create policy shares_rw on public.drawer_shares for all using (public.is_member(group_id)) with check (public.is_member(group_id));
drop policy if exists shares_mine on public.drawer_shares;
create policy shares_mine on public.drawer_shares for select using (shared_with = auth.uid());
drop policy if exists keys_own on public.ingest_keys;
create policy keys_own on public.ingest_keys for select using (user_id = auth.uid());

-- ---------- アプリから呼ぶ関数 ----------

-- 自分のグループ（なければ作る）
create or replace function public.ensure_my_group(p_display_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select m.group_id into gid from public.group_members m
    where m.user_id = auth.uid() order by m.joined_at desc limit 1;
  if gid is null then
    insert into public.groups (created_by) values (auth.uid()) returning id into gid;
    insert into public.group_members (group_id, user_id, display_name) values (gid, auth.uid(), p_display_name);
  end if;
  return gid;
end $$;

-- 招待コードで相手のグループに入る（自分しかいない空のグループは片付ける）
create or replace function public.join_group(p_code text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select g.id into gid from public.groups g where g.invite_code = upper(trim(p_code));
  if gid is null then raise exception 'invite code not found'; end if;
  insert into public.group_members (group_id, user_id, display_name)
    values (gid, auth.uid(), p_display_name)
    on conflict (group_id, user_id) do update set joined_at = now();
  delete from public.groups g
   where g.id <> gid
     and exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = auth.uid())
     and (select count(*) from public.group_members m where m.group_id = g.id) = 1
     and not exists (select 1 from public.trips t where t.group_id = g.id)
     and not exists (select 1 from public.drawers d where d.group_id = g.id);
  update public.ingest_keys set group_id = gid where user_id = auth.uid();
  return gid;
end $$;

-- 記録キー（ショートカット用）を取得。なければ作る。renew=true で作り直し
create or replace function public.my_ingest_key(p_renew boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare k text; gid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  gid := public.ensure_my_group();
  if p_renew then delete from public.ingest_keys where user_id = auth.uid(); end if;
  insert into public.ingest_keys (user_id, group_id) values (auth.uid(), gid)
    on conflict (user_id) do update set group_id = excluded.group_id
    returning key into k;
  return k;
end $$;

-- 共有コードを受け取る（アプリを入れている相手が入力）
create or replace function public.redeem_share(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.drawer_shares s
     set shared_with = auth.uid(), redeemed_at = now()
   where s.code = upper(trim(p_code)) and (s.shared_with is null or s.shared_with = auth.uid())
   returning s.id into sid;
  if sid is null then raise exception 'share code not found or already used'; end if;
  return sid;
end $$;

-- 自分に共有された引き出しの一覧
create or replace function public.shared_with_me()
returns table (share_id uuid, drawer_id uuid, name text, filter jsonb, from_group text,
               show_photos boolean, show_notes boolean, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, d.id, d.name, d.filter, g.name, s.show_photos, s.show_notes, d.updated_at
    from public.drawer_shares s
    join public.drawers d on d.id = s.drawer_id
    join public.groups g on g.id = d.group_id
   where s.shared_with = auth.uid()
   order by s.redeemed_at desc;
$$;

-- 共有された引き出しの中身（条件に入る旅の場所だけ。メモは許可された時だけ）
create or replace function public.shared_drawer_places(p_share_id uuid)
returns table (id uuid, trip_id uuid, trip_title text, trip_start date, name text, address text,
               lat double precision, lng double precision, status public.place_status,
               note text, registered_at timestamptz, visited_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.trip_id, t.title, t.start_date, p.name, p.address, p.lat, p.lng, p.status,
         case when s.show_notes then p.note else null end,
         p.registered_at, p.visited_at
    from public.drawer_shares s
    join public.drawers d on d.id = s.drawer_id
    join public.trips t on t.group_id = d.group_id and public.drawer_includes_trip(d.filter, t)
    join public.places p on p.trip_id = t.id
   where s.id = p_share_id and s.shared_with = auth.uid()
     and (coalesce(jsonb_typeof(d.filter->'statuses'), '') <> 'array' or (d.filter->'statuses') ? p.status::text);
$$;

-- 共有された引き出しの写真（写真の共有が許可された時だけ）
create or replace function public.shared_drawer_photos(p_share_id uuid)
returns table (id uuid, place_id uuid, storage_path text, taken_at timestamptz)
language sql stable security definer set search_path = public as $$
  select ph.id, ph.place_id, ph.storage_path, ph.taken_at
    from public.drawer_shares s
    join public.drawers d on d.id = s.drawer_id
    join public.trips t on t.group_id = d.group_id and public.drawer_includes_trip(d.filter, t)
    join public.photos ph on ph.trip_id = t.id
    join public.places p on p.id = ph.place_id
   where s.id = p_share_id and s.shared_with = auth.uid() and s.show_photos
     and (coalesce(jsonb_typeof(d.filter->'statuses'), '') <> 'array' or (d.filter->'statuses') ? p.status::text);
$$;

-- 写真ファイルを見てよいか（ストレージの権限で使う）
create or replace function public.can_view_photo(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.photos ph
     where ph.storage_path = p_path
       and (public.is_member(ph.group_id)
            or exists (
              select 1 from public.drawer_shares s
                join public.drawers d on d.id = s.drawer_id
                join public.trips t on t.id = ph.trip_id
               where s.group_id = ph.group_id and s.shared_with = auth.uid() and s.show_photos
                 and public.drawer_includes_trip(d.filter, t))));
$$;

revoke all on function public.ensure_my_group(text), public.join_group(text, text), public.my_ingest_key(boolean),
  public.redeem_share(text), public.shared_with_me(), public.shared_drawer_places(uuid),
  public.shared_drawer_photos(uuid), public.can_view_photo(text) from public, anon;
grant execute on function public.ensure_my_group(text), public.join_group(text, text), public.my_ingest_key(boolean),
  public.redeem_share(text), public.shared_with_me(), public.shared_drawer_places(uuid),
  public.shared_drawer_photos(uuid), public.can_view_photo(text), public.is_member(uuid) to authenticated;

-- ---------- 写真の保存場所（ストレージ） ----------
-- ファイルの置き方：{グループid}/{旅id}/{ファイル名}.jpg
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
  on conflict (id) do nothing;

drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (public.is_member(((storage.foldername(name))[1])::uuid) or public.can_view_photo(name)));
drop policy if exists photos_write on storage.objects;
create policy photos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));

-- ---------- 夫婦の画面にすぐ反映する（リアルタイム） ----------
do $$ begin
  alter publication supabase_realtime add table public.trips, public.places, public.photos, public.drawers;
exception when duplicate_object then null; when undefined_object then null; end $$;

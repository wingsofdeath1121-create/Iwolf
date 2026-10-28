-- Iwolf multiplayer foundation for Supabase
-- Run once in the Supabase SQL Editor. The game uses email sign-in; anonymous sign-ins stay disabled.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.iwolf_rooms (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null references auth.users(id) on delete cascade,
  player_limit int not null check (player_limit between 6 and 12),
  minimum_speaking_score numeric(2,1) not null default 5.0 check (minimum_speaking_score between 3.0 and 8.0),
  test_mode boolean not null default false,
  status text not null default 'waiting' check (status in ('waiting','playing','finished')),
  public_state jsonb not null default '{"phase":"lobby","day":1}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.iwolf_rooms add column if not exists minimum_speaking_score numeric(2,1) not null default 5.0 check (minimum_speaking_score between 3.0 and 8.0);
alter table public.iwolf_rooms add column if not exists test_mode boolean not null default false;

create table if not exists public.iwolf_room_players (
  room_id uuid not null references public.iwolf_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  player_name text not null check (char_length(player_name) between 1 and 20),
  joined_at timestamptz not null default now(),
  primary key(room_id,user_id)
);
create table if not exists public.iwolf_private_roles (
  room_id uuid not null,
  user_id uuid not null,
  role text not null,
  primary key(room_id,user_id),
  foreign key(room_id,user_id) references public.iwolf_room_players(room_id,user_id) on delete cascade,
  check(role in ('wolf','alpha','white','seer','witch','angel','hunter','elder','hybrid','villager'))
);
create table if not exists public.iwolf_actions (
  room_id uuid not null,
  user_id uuid not null,
  round_no int not null,
  action_kind text not null check(action_kind in ('speak_done','night_target','day_vote','chat')),
  target_user_id uuid,
  body text,
  created_at timestamptz not null default now(),
  primary key(room_id,user_id,round_no,action_kind),
  foreign key(room_id,user_id) references public.iwolf_room_players(room_id,user_id) on delete cascade
);

alter table public.iwolf_rooms enable row level security;
alter table public.iwolf_room_players enable row level security;
alter table public.iwolf_private_roles enable row level security;
alter table public.iwolf_actions enable row level security;
revoke all on public.iwolf_rooms,public.iwolf_room_players,public.iwolf_private_roles,public.iwolf_actions from anon,authenticated;
grant select on public.iwolf_rooms,public.iwolf_room_players to authenticated;

create or replace function public.iwolf_is_member(rid uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.iwolf_room_players p where p.room_id=rid and p.user_id=auth.uid());
$$;
revoke all on function public.iwolf_is_member(uuid) from public;
grant execute on function public.iwolf_is_member(uuid) to authenticated;

do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='iwolf_rooms' and policyname='iwolf_members_read_room') then
    execute 'create policy iwolf_members_read_room on public.iwolf_rooms for select to authenticated using(public.iwolf_is_member(id))';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='iwolf_room_players' and policyname='iwolf_members_read_players') then
    execute 'create policy iwolf_members_read_players on public.iwolf_room_players for select to authenticated using(public.iwolf_is_member(room_id))';
  end if;
end $$;

create or replace function public.iwolf_create_room(p_name text,p_limit int,p_minimum_score numeric,p_test_mode boolean,p_test_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions,auth,pg_temp as $$
declare c text; rid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if p_limit not between 6 and 12 or char_length(trim(p_name)) not between 1 and 20 then raise exception 'Invalid player name or room size'; end if;
  if p_minimum_score not between 3.0 and 8.0 then raise exception 'Speaking score must be between 3.0 and 8.0'; end if;
  if p_test_mode and encode(extensions.digest(coalesce(p_test_password,''),'sha256'),'hex')<>'b9756f6c250b180623b2043f6c4506ab231ce601011fb0fe686b0c1a68de9898' then raise exception 'Invalid Test Game Function password'; end if;
  loop
    c:=upper(substr(encode(extensions.gen_random_bytes(5),'hex'),1,6));
    exit when not exists(select 1 from public.iwolf_rooms where code=c);
  end loop;
  insert into public.iwolf_rooms(code,host_id,player_limit,minimum_speaking_score,test_mode) values(c,auth.uid(),p_limit,p_minimum_score,p_test_mode) returning id into rid;
  insert into public.iwolf_room_players(room_id,user_id,player_name) values(rid,auth.uid(),trim(p_name));
  return jsonb_build_object('code',c,'room_id',rid,'host',true);
end $$;

create or replace function public.iwolf_join_room(p_code text,p_name text)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare r public.iwolf_rooms%rowtype; n int;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if char_length(trim(p_name)) not between 1 and 20 then raise exception 'Enter a player name'; end if;
  select * into r from public.iwolf_rooms where code=upper(trim(p_code)) for update;
  if not found or r.status<>'waiting' then raise exception 'Room not found or no longer accepting players'; end if;
  select count(*) into n from public.iwolf_room_players where room_id=r.id;
  if n>=r.player_limit then raise exception 'Room is full'; end if;
  insert into public.iwolf_room_players(room_id,user_id,player_name) values(r.id,auth.uid(),trim(p_name)) on conflict(room_id,user_id) do update set player_name=excluded.player_name;
  return jsonb_build_object('code',r.code,'room_id',r.id,'host',r.host_id=auth.uid());
end $$;

create or replace function public.iwolf_room_snapshot(p_code text)
returns jsonb language plpgsql stable security definer set search_path=public,auth,pg_temp as $$
declare r public.iwolf_rooms%rowtype; mine text;
begin
  select * into r from public.iwolf_rooms where code=upper(trim(p_code));
  if not found or not public.iwolf_is_member(r.id) then raise exception 'Room not found'; end if;
  select role into mine from public.iwolf_private_roles where room_id=r.id and user_id=auth.uid();
  return jsonb_build_object(
    'code',r.code,'status',r.status,'player_limit',r.player_limit,'minimum_speaking_score',r.minimum_speaking_score,'test_mode',r.test_mode,'is_host',r.host_id=auth.uid(),
    'public_state',r.public_state,'my_role',mine,
    'players',(select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'name',p.player_name,'is_host',p.user_id=r.host_id) order by p.joined_at,p.user_id),'[]'::jsonb) from public.iwolf_room_players p where p.room_id=r.id),
    'actions',(select coalesce(jsonb_agg(jsonb_build_object('user_id',a.user_id,'name',p.player_name,'kind',a.action_kind,'target_user_id',a.target_user_id,'body',a.body) order by a.created_at),'[]'::jsonb) from public.iwolf_actions a join public.iwolf_room_players p using(room_id,user_id) where a.room_id=r.id and a.round_no=coalesce((r.public_state->>'day')::int,1) and r.host_id=auth.uid())
  );
end $$;

create or replace function public.iwolf_start_room(p_code text,p_assignments jsonb)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare r public.iwolf_rooms%rowtype; actual text[]; expected text[]; n int;
begin
  select * into r from public.iwolf_rooms where code=upper(trim(p_code)) for update;
  if not found or r.host_id<>auth.uid() then raise exception 'Only the host can start this room'; end if;
  select count(*) into n from public.iwolf_room_players where room_id=r.id;
  if n<>r.player_limit or jsonb_typeof(p_assignments)<>'array' or jsonb_array_length(p_assignments)<>n then raise exception 'The room needs exactly % players',r.player_limit; end if;
  select array_agg(x.role order by x.role) into actual from jsonb_to_recordset(p_assignments) as x(user_id uuid,role text);
  expected:=case r.player_limit
    when 6 then array['angel','seer','villager','villager','witch','wolf']
    when 7 then array['alpha','hunter','seer','villager','villager','witch','wolf']
    when 8 then array['alpha','angel','seer','villager','villager','villager','white','witch']
    when 9 then array['alpha','hunter','seer','villager','villager','villager','white','witch','wolf']
    when 10 then array['alpha','elder','hunter','seer','villager','villager','villager','white','witch','wolf']
    when 11 then array['alpha','elder','hybrid','hunter','seer','villager','villager','villager','white','witch','wolf']
    when 12 then array['alpha','angel','elder','hybrid','hunter','seer','villager','villager','villager','white','witch','wolf']
  end;
  if actual is distinct from expected then raise exception 'Role list does not match the room size'; end if;
  if exists(select 1 from jsonb_to_recordset(p_assignments) as x(user_id uuid,role text) left join public.iwolf_room_players p on p.room_id=r.id and p.user_id=x.user_id where p.user_id is null) then raise exception 'Role list contains a player outside this room'; end if;
  delete from public.iwolf_private_roles where room_id=r.id;
  insert into public.iwolf_private_roles(room_id,user_id,role) select r.id,x.user_id,x.role from jsonb_to_recordset(p_assignments) as x(user_id uuid,role text);
  update public.iwolf_rooms set status='playing',public_state=jsonb_build_object('phase','reveal','day',1,'updated_at',now()),updated_at=now() where id=r.id;
  return public.iwolf_room_snapshot(r.code);
end $$;

create or replace function public.iwolf_set_public_state(p_code text,p_state jsonb)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare r public.iwolf_rooms%rowtype;
begin
  select * into r from public.iwolf_rooms where code=upper(trim(p_code)) for update;
  if not found or r.host_id<>auth.uid() then raise exception 'Only the host can change game phase'; end if;
  if r.status<>'playing' or jsonb_typeof(p_state)<>'object' then raise exception 'Game is not active'; end if;
  update public.iwolf_rooms set public_state=p_state||jsonb_build_object('updated_at',now()),updated_at=now() where id=r.id;
  return public.iwolf_room_snapshot(r.code);
end $$;

create or replace function public.iwolf_submit_action(p_code text,p_kind text,p_target uuid default null,p_body text default null)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare r public.iwolf_rooms%rowtype; d int;
begin
  select * into r from public.iwolf_rooms where code=upper(trim(p_code));
  if not found or not public.iwolf_is_member(r.id) or r.status<>'playing' then raise exception 'You are not in an active room'; end if;
  if p_kind not in ('speak_done','night_target','day_vote','chat') then raise exception 'Invalid action'; end if;
  if p_kind='chat' and (p_body is null or char_length(p_body)>500) then raise exception 'Invalid chat message'; end if;
  if p_target is not null and not exists(select 1 from public.iwolf_room_players where room_id=r.id and user_id=p_target) then raise exception 'Target is not in this room'; end if;
  d:=coalesce((r.public_state->>'day')::int,1);
  insert into public.iwolf_actions(room_id,user_id,round_no,action_kind,target_user_id,body) values(r.id,auth.uid(),d,p_kind,p_target,p_body)
  on conflict(room_id,user_id,round_no,action_kind) do update set target_user_id=excluded.target_user_id,body=excluded.body,created_at=now();
  return public.iwolf_room_snapshot(r.code);
end $$;

revoke all on function public.iwolf_create_room(text,int,numeric,boolean,text),public.iwolf_join_room(text,text),public.iwolf_room_snapshot(text),public.iwolf_start_room(text,jsonb),public.iwolf_set_public_state(text,jsonb),public.iwolf_submit_action(text,text,uuid,text) from public,anon;
grant execute on function public.iwolf_create_room(text,int,numeric,boolean,text),public.iwolf_join_room(text,text),public.iwolf_room_snapshot(text),public.iwolf_start_room(text,jsonb),public.iwolf_set_public_state(text,jsonb),public.iwolf_submit_action(text,text,uuid,text) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='iwolf_rooms') then alter publication supabase_realtime add table public.iwolf_rooms; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='iwolf_room_players') then alter publication supabase_realtime add table public.iwolf_room_players; end if;
end $$;

-- IELTS Speaking answers are private; the shared report exposes only status,
-- word count, and a score when a trusted evaluator has written one.
create table if not exists public.iwolf_speaking_answers (
  room_id uuid not null,
  user_id uuid not null,
  round_no int not null check(round_no > 0),
  answer_text text not null default '',
  word_count int not null default 0 check(word_count >= 0),
  score numeric(2,1) check(score is null or score between 0 and 9),
  scoring_status text not null default 'pending' check(scoring_status in ('pending','scored','test_auto')),
  submitted_at timestamptz not null default now(),
  primary key(room_id,user_id,round_no),
  foreign key(room_id,user_id) references public.iwolf_room_players(room_id,user_id) on delete cascade,
  check(char_length(answer_text) <= 4000)
);
alter table public.iwolf_speaking_answers enable row level security;
revoke all on public.iwolf_speaking_answers from public,anon,authenticated;

create or replace function public.iwolf_speaking_report(p_room_id uuid,p_round_no int)
returns jsonb language sql stable security definer set search_path=public,auth,pg_temp as $$
  with room as (
    select r.id,r.code,r.test_mode
    from public.iwolf_rooms r
    where r.id=p_room_id and public.iwolf_is_member(r.id)
  ), seats as (
    select p.user_id,p.player_name,p.joined_at,
      ((row_number() over(order by p.joined_at,p.user_id)-1)/3+1)::int as api_group
    from public.iwolf_room_players p where p.room_id=p_room_id
  ), progress as (
    select g.api_group,count(s.user_id)::int as player_count,
      count(s.user_id) filter(where rm.test_mode or a.user_id is not null)::int as completed_count
    from generate_series(1,4) as g(api_group)
    cross join room rm
    left join seats s on s.api_group=g.api_group
    left join public.iwolf_speaking_answers a on a.room_id=p_room_id and a.user_id=s.user_id and a.round_no=p_round_no
    group by g.api_group
  ), player_rows as (
    select jsonb_agg(jsonb_build_object(
      'user_id',s.user_id,
      'name',s.player_name,
      'api_group',s.api_group,
      'status',case when rm.test_mode then 'auto_passed' when a.user_id is null then 'pending' else 'submitted' end,
      'score',case when rm.test_mode then 7.0 else a.score end,
      'scoring_status',case when rm.test_mode then 'test_auto' when a.user_id is null then 'not_submitted' else a.scoring_status end,
      'word_count',case when rm.test_mode then 0 else coalesce(a.word_count,0) end,
      'submitted_at',a.submitted_at
    ) order by s.joined_at,s.user_id) as data
    from seats s cross join room rm
    left join public.iwolf_speaking_answers a on a.room_id=p_room_id and a.user_id=s.user_id and a.round_no=p_round_no
  )
  select jsonb_build_object(
    'room_code',rm.code,
    'round_no',p_round_no,
    'test_mode',rm.test_mode,
    'player_count',(select count(*)::int from seats),
    'completed_count',case when rm.test_mode then (select count(*)::int from seats) else coalesce((select sum(completed_count)::int from progress),0) end,
    'pending_count',case when rm.test_mode then 0 else coalesce((select sum(player_count-completed_count)::int from progress),0) end,
    'groups',coalesce((select jsonb_agg(jsonb_build_object('api',api_group,'player_count',player_count,'completed_count',completed_count) order by api_group) from progress),'[]'::jsonb),
    'players',coalesce((select data from player_rows),'[]'::jsonb)
  )
  from room rm;
$$;
revoke all on function public.iwolf_speaking_report(uuid,int) from public,anon,authenticated;

create or replace function public.iwolf_room_snapshot(p_code text)
returns jsonb language plpgsql stable security definer set search_path=public,auth,pg_temp as $$
declare r public.iwolf_rooms%rowtype; mine text; d int;
begin
  select * into r from public.iwolf_rooms where code=upper(trim(p_code));
  if not found or not public.iwolf_is_member(r.id) then raise exception 'Room not found'; end if;
  select role into mine from public.iwolf_private_roles where room_id=r.id and user_id=auth.uid();
  d:=coalesce((r.public_state->>'day')::int,1);
  return jsonb_build_object(
    'code',r.code,'status',r.status,'player_limit',r.player_limit,'minimum_speaking_score',r.minimum_speaking_score,'test_mode',r.test_mode,'is_host',r.host_id=auth.uid(),
    'public_state',r.public_state,'my_role',mine,
    'my_answer_batch',(select ((row_number() over(order by p.joined_at,p.user_id)-1)/3+1)::int from public.iwolf_room_players p where p.room_id=r.id and p.user_id=auth.uid()),
    'my_answer_status',case when r.test_mode then jsonb_build_object('status','auto_passed','score',7.0) else coalesce((select jsonb_build_object('status','submitted','word_count',a.word_count,'score',a.score,'scoring_status',a.scoring_status) from public.iwolf_speaking_answers a where a.room_id=r.id and a.user_id=auth.uid() and a.round_no=d),jsonb_build_object('status','pending')) end,
    'speaking_report',public.iwolf_speaking_report(r.id,d),
    'players',(select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'name',p.player_name,'is_host',p.user_id=r.host_id) order by p.joined_at,p.user_id),'[]'::jsonb) from public.iwolf_room_players p where p.room_id=r.id),
    'actions',(select coalesce(jsonb_agg(jsonb_build_object('user_id',a.user_id,'name',p.player_name,'kind',a.action_kind,'target_user_id',a.target_user_id,'body',a.body) order by a.created_at),'[]'::jsonb) from public.iwolf_actions a join public.iwolf_room_players p using(room_id,user_id) where a.room_id=r.id and a.round_no=d and r.host_id=auth.uid())
  );
end $$;

create or replace function public.iwolf_submit_speaking_answer_internal(p_code text,p_api_group int,p_answer text)
returns jsonb language plpgsql security definer set search_path=public,auth,pg_temp as $$
declare r public.iwolf_rooms%rowtype; d int; actual_group int; clean_answer text; words int;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if p_api_group not between 1 and 4 then raise exception 'Invalid answer API group'; end if;
  select * into r from public.iwolf_rooms where code=upper(trim(p_code)) for update;
  if not found or not public.iwolf_is_member(r.id) or r.status<>'playing' then raise exception 'You are not in an active room'; end if;
  if coalesce(r.public_state->>'phase','')<>'night' then raise exception 'Speaking answers can only be submitted during the night phase'; end if;
  d:=coalesce((r.public_state->>'day')::int,1);
  select ((row_number() over(order by p.joined_at,p.user_id)-1)/3+1)::int into actual_group
  from public.iwolf_room_players p where p.room_id=r.id and p.user_id=auth.uid();
  if actual_group is distinct from p_api_group then raise exception 'This account belongs to answer API group %',actual_group; end if;
  clean_answer:=trim(coalesce(p_answer,''));
  if not r.test_mode and (char_length(clean_answer)=0 or char_length(clean_answer)>4000) then raise exception 'Answer must contain 1 to 4000 characters'; end if;
  words:=case when char_length(clean_answer)=0 then 0 else cardinality(regexp_split_to_array(clean_answer,'[[:space:]]+')) end;
  insert into public.iwolf_speaking_answers(room_id,user_id,round_no,answer_text,word_count,score,scoring_status,submitted_at)
  values(r.id,auth.uid(),d,clean_answer,words,case when r.test_mode then 7.0 else null end,case when r.test_mode then 'test_auto' else 'pending' end,now())
  on conflict(room_id,user_id,round_no) do update set answer_text=excluded.answer_text,word_count=excluded.word_count,score=excluded.score,scoring_status=excluded.scoring_status,submitted_at=excluded.submitted_at;
  insert into public.iwolf_actions(room_id,user_id,round_no,action_kind,target_user_id,body)
  values(r.id,auth.uid(),d,'speak_done',null,null)
  on conflict(room_id,user_id,round_no,action_kind) do update set created_at=now();
  return public.iwolf_room_snapshot(r.code);
end $$;

create or replace function public.iwolf_submit_answer_group_1(p_code text,p_answer text)
returns jsonb language sql security definer set search_path=public,auth,pg_temp as $$ select public.iwolf_submit_speaking_answer_internal(p_code,1,p_answer); $$;
create or replace function public.iwolf_submit_answer_group_2(p_code text,p_answer text)
returns jsonb language sql security definer set search_path=public,auth,pg_temp as $$ select public.iwolf_submit_speaking_answer_internal(p_code,2,p_answer); $$;
create or replace function public.iwolf_submit_answer_group_3(p_code text,p_answer text)
returns jsonb language sql security definer set search_path=public,auth,pg_temp as $$ select public.iwolf_submit_speaking_answer_internal(p_code,3,p_answer); $$;
create or replace function public.iwolf_submit_answer_group_4(p_code text,p_answer text)
returns jsonb language sql security definer set search_path=public,auth,pg_temp as $$ select public.iwolf_submit_speaking_answer_internal(p_code,4,p_answer); $$;

revoke all on function public.iwolf_submit_speaking_answer_internal(text,int,text),public.iwolf_submit_answer_group_1(text,text),public.iwolf_submit_answer_group_2(text,text),public.iwolf_submit_answer_group_3(text,text),public.iwolf_submit_answer_group_4(text,text) from public,anon;
grant execute on function public.iwolf_submit_answer_group_1(text,text),public.iwolf_submit_answer_group_2(text,text),public.iwolf_submit_answer_group_3(text,text),public.iwolf_submit_answer_group_4(text,text) to authenticated;


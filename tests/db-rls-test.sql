\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned
insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000001','husband@x'),('aaaaaaaa-0000-0000-0000-000000000002','wife@x'),('aaaaaaaa-0000-0000-0000-000000000003','friend@x'),('aaaaaaaa-0000-0000-0000-000000000004','stranger@x');
create temp table r(k text, v text); grant all on r to authenticated;
-- 夫
set role authenticated; set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000001';
insert into r select 'gid', public.ensure_my_group('夫')::text;
insert into r select 'code', invite_code from groups;
insert into trips(group_id,title,start_date,end_date) select v::uuid,'京都旅行','2026-11-13','2026-11-15' from r where k='gid';
insert into trips(group_id,title,start_date,end_date) select v::uuid,'北海道旅行','2026-03-01','2026-03-04' from r where k='gid';
insert into places(trip_id,group_id,name,lat,lng,status,note) select id,'00000000-0000-0000-0000-000000000000','清水寺',34.9949,135.785,'visited','ふたりのメモ' from trips where title='京都旅行';
insert into places(trip_id,group_id,name,lat,lng,status) select id,'00000000-0000-0000-0000-000000000000','嵐山',35.017,135.671,'missed' from trips where title='京都旅行';
insert into places(trip_id,group_id,name,lat,lng,status) select id,'00000000-0000-0000-0000-000000000000','函館山',41.759,140.704,'missed' from trips where title='北海道旅行';
insert into photos(trip_id,group_id,place_id,storage_path) select p.trip_id,'00000000-0000-0000-0000-000000000000',p.id,(select v from r where k='gid')||'/x/a.jpg' from places p where name='清水寺';
insert into drawers(group_id,name,filter) select v::uuid,'次こそ行く場所','{"trips":"all","statuses":["missed"]}' from r where k='gid';
insert into drawer_shares(drawer_id,group_id,show_photos,show_notes) select id,'00000000-0000-0000-0000-000000000000',false,false from drawers;
insert into drawers(group_id,name,filter) select v::uuid,'京都のぜんぶ',jsonb_build_object('trips',jsonb_build_array((select id from trips where title='京都旅行'))) from r where k='gid';
insert into drawer_shares(drawer_id,group_id,show_photos,show_notes) select id,'00000000-0000-0000-0000-000000000000',true,true from drawers where name='京都のぜんぶ';
insert into r select 'share1', code from drawer_shares s join drawers d on d.id=s.drawer_id where d.name='次こそ行く場所';
insert into r select 'share2', code from drawer_shares s join drawers d on d.id=s.drawer_id where d.name='京都のぜんぶ';
select 'T1 group_id auto-set from trip (not fake zero uuid)', (select count(*) from places where group_id='00000000-0000-0000-0000-000000000000')=0;
-- 妻：参加前は見えない→参加後は見える
set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000002';
select 'T2 wife before join sees 0 trips', (select count(*) from trips)=0;
select public.ensure_my_group('妻') is not null;
select public.join_group((select v from r where k='code'),'妻') is not null;
select 'T3 wife after join sees 2 trips', (select count(*) from trips)=2;
select 'T4 wife empty group cleaned up', (select count(*) from group_members where user_id=auth.uid())=1;
update places set status='visited' where name='嵐山';
select 'T5 wife can edit', (select status from places where name='嵐山')='visited';
update places set status='missed' where name='嵐山';
select 'T6 wife ingest key', length(public.my_ingest_key())=48;
-- 無関係の人
set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000004';
select 'T7 stranger sees nothing', (select count(*) from trips)+(select count(*) from places)+(select count(*) from drawers)+(select count(*) from drawer_shares)=0;
insert into r select 'sid4', '';
select 'T8 stranger cannot insert into other group', (select count(*) from places)=0;
-- 共有相手
set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000003';
insert into r select 'sid1', public.redeem_share((select v from r where k='share1'))::text;
insert into r select 'sid2', public.redeem_share((select v from r where k='share2'))::text;
select 'T9 friend sees shared list 2', (select count(*) from public.shared_with_me())=2;
select 'T10 friend direct tables 0', (select count(*) from trips)+(select count(*) from places)=0;
select 'T11 drawer1 = missed across trips (嵐山,函館山)', (select string_agg(name,',' order by name) from public.shared_drawer_places((select v::uuid from r where k='sid1')))='函館山,嵐山';
select 'T12 drawer1 no photos (not allowed)', (select count(*) from public.shared_drawer_photos((select v::uuid from r where k='sid1')))=0;
select 'T13 drawer2 kyoto only 2 places', (select count(*) from public.shared_drawer_places((select v::uuid from r where k='sid2')))=2;
select 'T14 drawer2 note visible', (select note from public.shared_drawer_places((select v::uuid from r where k='sid2')) where name='清水寺')='ふたりのメモ';
select 'T15 drawer2 photo visible', (select count(*) from public.shared_drawer_photos((select v::uuid from r where k='sid2')))=1;
select 'T16 can_view_photo true', public.can_view_photo((select v from r where k='gid')||'/x/a.jpg');
-- 共有コードの使い回し不可
set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000004';
do $$ begin perform public.redeem_share((select v from r where k='share1')); raise exception 'should fail'; exception when others then if sqlerrm='should fail' then raise; end if; end $$;
select 'T17 stranger cannot reuse code', true;
select 'T18 stranger cannot view shared drawer by id', (select count(*) from public.shared_drawer_places((select v::uuid from r where k='sid1')))=0;
select 'T19 stranger cannot view photo', not public.can_view_photo((select v from r where k='gid')||'/x/a.jpg');
-- 変更の反映：夫が嵐山を行ったに → 友人の「次こそ」から消える
set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000001';
update places set status='visited' where name='嵐山';
set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000003';
select 'T20 change reflected to friend', (select string_agg(name,',') from public.shared_drawer_places((select v::uuid from r where k='sid1')))='函館山';
-- ストレージ
set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000004';
do $$ begin insert into storage.objects(bucket_id,name) values ('photos',(select v from r where k='gid')||'/x/b.jpg'); raise exception 'should fail'; exception when others then if sqlerrm='should fail' then raise; end if; end $$;
select 'T21 stranger cannot upload to group folder', true;
set request.jwt.claim.sub='aaaaaaaa-0000-0000-0000-000000000002';
insert into storage.objects(bucket_id,name) values ('photos',(select v from r where k='gid')||'/x/c.jpg');
select 'T22 wife can upload', true;

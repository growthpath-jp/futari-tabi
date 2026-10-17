\set ON_ERROR_STOP 1
-- 使い方：db-stub.sql → schema.sql → db-rls-test.sql のあとに流す
-- 予定（plan）も夫婦だけ：夫が書いた宿を妻は読める、他人は読めない、共有された引き出しには出ない
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
update public.trips set plan = '{"nights":[{"status":"booked","hotel":{"name":"秘密の宿","lat":34.7,"lng":135.2}}]}' where id = (select id from public.trips limit 1);
update public.places set plan = '{"day":1,"at":"18:30"}' where id = (select id from public.places limit 1);
select 'P1 husband wrote plan|' || (count(*) = 1)::text from public.trips where plan->'nights'->0->'hotel'->>'name' = '秘密の宿';
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000002',false);
select 'P2 wife reads hotel|' || (count(*) = 1)::text from public.trips where plan::text like '%秘密の宿%';
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000004',false);
select 'P3 stranger reads nothing|' || (count(*) = 0)::text from public.trips where plan::text like '%秘密の宿%';
with u as (update public.trips set plan = '{}' returning 1) select 'P4 stranger cannot write plan|' || (count(*) = 0)::text from u;

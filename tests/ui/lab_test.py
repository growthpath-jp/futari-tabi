import json, sys, threading, http.server, functools, os
from playwright.sync_api import sync_playwright
APP=sys.argv[1]; STUB=open(os.path.join(os.path.dirname(__file__),'leaflet-stub.js'),encoding='utf8').read()
http.server.SimpleHTTPRequestHandler.log_message=lambda *a,**k: None
srv=http.server.ThreadingHTTPServer(('127.0.0.1',8769),functools.partial(http.server.SimpleHTTPRequestHandler,directory=APP))
threading.Thread(target=srv.serve_forever,daemon=True).start()
R=[]; errors=[]
def check(n,c,i=''): R.append(c); print(('OK  ' if c else 'NG  ')+n+('' if c else f'  ({i})'))
def route(r):
    u=r.request.url
    if u.startswith('http://127.0.0.1'): return r.continue_()
    if 'leaflet' in u and u.endswith('.js'): return r.fulfill(status=200,content_type='application/javascript',body=STUB)
    if 'leaflet' in u or 'fonts.g' in u: return r.fulfill(status=200,content_type='text/css',body='')
    if 'nominatim' in u:
        if 'oriental' in u.lower() or '%E3%82%AA%E3%83%AA%E3%82%A8%E3%83%B3%E3%82%BF%E3%83%AB' in u: return r.fulfill(status=200,content_type='application/json',body=json.dumps([{"name":"神戸メリケンパークオリエンタルホテル","display_name":"神戸メリケンパークオリエンタルホテル, 中央区","lat":"34.6810","lon":"135.1905"}]))
        return r.fulfill(status=200,content_type='application/json',body=json.dumps([{"name":"神戸ポートタワー","display_name":"神戸ポートタワー, 中央区, 神戸市","lat":"34.6826","lon":"135.1867"}]))
    if 'overpass' in u: return r.fulfill(status=200,content_type='application/json',body=json.dumps({"elements":[{"lat":34.6946,"lon":135.1955,"tags":{"name":"三ノ宮"}}]}))
    return r.abort()
rows=lambda pg,d: pg.locator(f'.day-list[data-d="{d}"] .prow').evaluate_all('e=>e.map(x=>x.querySelector("b").textContent)')
allrows=lambda pg: [x for d in range(4) for x in rows(pg,d)]
dayIdx=lambda pg,name: [i for i in range(4) if any(name in x for x in rows(pg,i))]
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844},locale='ja-JP',timezone_id='Asia/Tokyo'); ctx.route('**/*',route)
    pg=ctx.new_page(); pg.on('pageerror',lambda e: errors.append(str(e))); pg.on('console',lambda m: m.type=='error' and errors.append(m.text))
    pg.goto('http://127.0.0.1:8769/lab/'); pg.wait_for_selector('.day')
    check('1 ステップ表示：やること・確かめたいこと・答えボタン', 'ステップ 1 / 3' in pg.locator('#task').inner_text() and '確かめたいこと' in pg.locator('#task').inner_text() and pg.locator('[data-answer]').count()==3)
    sec0=pg.locator('section.day').first
    check('1 1日目の始まりが目立つ行で「出発 新神戸駅 12:15」', '出発' in sec0.locator('.terminal').first.inner_text() and '新神戸駅' in sec0.locator('.terminal').first.inner_text() and '12:15' in sec0.locator('.terminal').first.inner_text())
    check('1 1日目の終わりが「宿（未定）」の行', '宿' in sec0.locator('.terminal').last.inner_text() and '未定' in sec0.locator('.terminal').last.inner_text())
    check('1 宿を選ぶボタンが各泊にある（3つ）', pg.locator('[data-hotel-open]').count()==3)
    check('1 最終日の終わりは「帰り 新神戸駅」', '帰り' in pg.locator('section.day').last.locator('.terminal').last.inner_text())
    pg.click('[data-cand="arima"]'); pg.select_option('#f-day','1'); pg.click('#form button[type=submit]'); pg.wait_for_timeout(150)
    pg.locator('[data-answer="はい"]').click(); pg.wait_for_timeout(100)
    check('2 答えると次のステップへ', 'ステップ 2 / 3' in pg.locator('#task').inner_text())
    pg.click('[data-cand="tottei"]'); pg.click('#form button[type=submit]'); pg.wait_for_timeout(100)
    pg.click('[data-cand="sumaura"]'); pg.click('#form button[type=submit]'); pg.wait_for_timeout(100)
    check('2 3か所登録', len(allrows(pg))==3)
    pg.locator('[data-answer="どちらとも"]').click(); pg.locator('[data-answer="はい"]').click(); pg.wait_for_timeout(100)
    check('2 最後まで答えると「次のシナリオへ」', pg.locator('[data-next-sc]').count()==1)
    # シナリオ② 宿
    pg.locator('[data-next-sc]').click(); pg.wait_for_timeout(200)
    check('3 ②宿を決める：3か所が入った状態', len(allrows(pg))==3 and '宿を決める' in pg.locator('#sc option:checked').inner_text())
    pg.locator('[data-hotel-open="1"]').click(); pg.wait_for_selector('[data-hotel-day="1"]')
    pg.locator('[data-hotel-day="1"] [data-hotel="1"]').click(); pg.wait_for_timeout(200)
    check('3 11/1の宿を有馬温泉の旅館に', '有馬温泉の旅館' in pg.locator('section.day').nth(1).locator('.terminal').last.inner_text())
    check('3 11/2の出発も有馬温泉の旅館になる', '有馬温泉の旅館' in pg.locator('section.day').nth(2).locator('.terminal').first.inner_text())
    d=dayIdx(pg,'有馬温泉（金の湯）')
    check('3 有馬温泉は11/1か11/2に入る', d and d[0] in (1,2), d)
    pg.locator('[data-hotel-open="0"]').click(); pg.fill('#hq-0','オリエンタル'); pg.locator('[data-hotel-search="0"]').click(); pg.wait_for_selector('[data-hotel-hit]')
    pg.locator('[data-hotel-hit]').first.click(); pg.wait_for_timeout(200)
    check('3 宿を検索して選べる', 'オリエンタルホテル' in pg.locator('section.day').first.locator('.terminal').last.inner_text())
    # シナリオ③ 時間
    pg.select_option('#sc','k3'); pg.wait_for_timeout(200)
    pg.select_option('#ts-1','10:30'); pg.select_option('#te-1','18:00'); pg.wait_for_timeout(200)
    sec1=pg.locator('section.day').nth(1)
    check('4 11/1の出発が10:30に', '10:30' in sec1.locator('.terminal').first.inner_text())
    over=sec1.locator('.day-warn').count()
    fin=sec1.locator('.terminal').last.inner_text()
    check('4 宿は「18:00着予定」と出る', '18:00着予定' in fin, fin)
    check('4 遅れる時だけ警告、間に合えば見込み時刻', (over==1 and '遅れます' in fin) or ('見込み' in fin and over==0) or ('まだありません' in fin and over==0), fin)
    # シナリオ④ 予約と行けたら
    pg.select_option('#sc','k4'); pg.wait_for_timeout(200)
    pg.click('[data-cand="dinner"]'); pg.select_option('#f-day','1'); pg.click('#form button[type=submit]'); pg.wait_for_timeout(150)
    t=pg.locator('.prow', has_text='神戸牛').locator('.pmeta').first.inner_text()
    empty=[i for i in range(4) if len(rows(pg,i))==0 and i<3]
    if empty:
        tt=pg.locator('section.day').nth(empty[0]).locator('.terminal').last.inner_text()
        check('5 場所がない日でも宿は設定した時刻で「着予定」', '21:00着予定' in tt, tt)
    check('5 夕食予約11/1 18:30', '18:30着' in t and 1 in dayIdx(pg,'神戸牛'), t)
    for c in ['kitano','nankinmachi','meriken','harborland','nunobiki','rokko']:
        pg.click(f'[data-cand="{c}"]'); pg.click('#form button[type=submit]'); pg.wait_for_timeout(80)
    check('5 行けたら6か所を登録できる', len(allrows(pg)) + pg.locator('[data-act=force]').count() == 10, (len(allrows(pg)), pg.locator('[data-act=force]').count()))
    # ⑤
    pg.select_option('#sc','k5'); pg.wait_for_timeout(200)
    pg.evaluate('window.__tapMap(34.6946,135.1955)'); pg.wait_for_timeout(200)
    nx=pg.locator('#next').inner_text()
    check('6 旅行中：次の目的地', '次は' in nx and 'Googleマップで道案内' in nx, nx)
    name=pg.locator('#next b').inner_text().split('「')[1].split('」')[0]
    pg.locator('.prow', has_text=name).locator('[data-act=cancel]').click(); pg.click('#replan'); pg.wait_for_timeout(200)
    check('6 並べ直し後、中止した場所は次に来ない', name not in pg.locator('#next b').inner_text())
    # 感想
    pg.fill('#fb-memo','宿は先に決めたい'); pg.click('#fb-copy'); pg.wait_for_timeout(150)
    out=pg.locator('#fb-out').inner_text()
    check('7 答えと感想がまとまる', '登録の画面は分かりやすかった？ → はい' in out and '宿は先に決めたい' in out, out[:300])
    pg.reload(); pg.wait_for_selector('.day')
    check('8 再読み込み後も残る', pg.locator('#sc').input_value()=='k5')
    check('9 横にはみ出さない', not pg.evaluate('document.documentElement.scrollWidth>innerWidth+1'))
    check('10 エラーなし', not errors, errors)
    pg.select_option('#sc','k2'); pg.wait_for_timeout(200)
    pg.screenshot(path='/tmp/claude-0/-home-claude/a34660fc-d072-5f77-a394-f08f1d9e5aad/scratchpad/kobe2.png', full_page=True)
    b.close()
srv.shutdown(); print(f"\n{sum(R)} OK / {len(R)-sum(R)} NG")

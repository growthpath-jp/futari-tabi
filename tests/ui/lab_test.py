import json, sys, threading, http.server, functools, os
from playwright.sync_api import sync_playwright
APP=sys.argv[1]; STUB=open(os.path.join(os.path.dirname(__file__),'leaflet-stub.js'),encoding='utf8').read()
http.server.SimpleHTTPRequestHandler.log_message=lambda *a,**k: None
srv=http.server.ThreadingHTTPServer(('127.0.0.1',8768),functools.partial(http.server.SimpleHTTPRequestHandler,directory=APP))
threading.Thread(target=srv.serve_forever,daemon=True).start()
R=[]; errors=[]
def check(n,c,i=''): R.append(c); print(('OK  ' if c else 'NG  ')+n+('' if c else f'  ({i})'))
def route(r):
    u=r.request.url
    if u.startswith('http://127.0.0.1'): return r.continue_()
    if 'leaflet' in u and u.endswith('.js'): return r.fulfill(status=200,content_type='application/javascript',body=STUB)
    if 'leaflet' in u or 'fonts.g' in u: return r.fulfill(status=200,content_type='text/css',body='')
    if 'nominatim' in u: return r.fulfill(status=200,content_type='application/json',body=json.dumps([{"name":"神戸ポートタワー","display_name":"神戸ポートタワー, 中央区, 神戸市","lat":"34.6826","lon":"135.1867"}]))
    if 'overpass' in u: return r.fulfill(status=200,content_type='application/json',body=json.dumps({"elements":[{"lat":34.6946,"lon":135.1955,"tags":{"name":"三ノ宮"}}]}))
    return r.abort()
rows=lambda pg,d: pg.locator(f'.day-list[data-d="{d}"] .prow').evaluate_all('e=>e.map(x=>x.querySelector("b").textContent)')
allrows=lambda pg: [x for d in range(4) for x in rows(pg,d)]
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844},locale='ja-JP',timezone_id='Asia/Tokyo'); ctx.route('**/*',route)
    pg=ctx.new_page(); pg.on('pageerror',lambda e: errors.append(str(e))); pg.on('console',lambda m: m.type=='error' and errors.append(m.text))
    pg.goto('http://127.0.0.1:8768/lab/'); pg.wait_for_selector('.day')
    check('1 4日間（10/31〜11/3）が出る', pg.locator('section.day').count()==4)
    check('1 10/31は新神戸 12:15出発', '新神戸駅' in pg.locator('section.day').first.locator('.endpoint').first.inner_text() and '12:15' in pg.locator('section.day').first.locator('.endpoint').first.inner_text())
    check('1 シナリオ①は空の状態から', len(allrows(pg))==0)
    # 候補から登録（日を決める）
    pg.click('[data-cand="arima"]'); pg.wait_for_selector('#f-day')
    check('2 登録フォームに営業時間のメモが出る', '金の湯' in pg.locator('#form').inner_text())
    pg.select_option('#f-day','1'); pg.click('#form button[type=submit]'); pg.wait_for_timeout(200)
    check('2 有馬温泉を11/1に決めて登録', any('有馬温泉' in x for x in rows(pg,1)))
    check('2 「日を決めた」の印', '日を決めた' in pg.locator('.prow', has_text='有馬温泉').inner_text())
    pg.click('[data-cand="tottei"]'); pg.click('#form button[type=submit]'); pg.wait_for_timeout(150)
    pg.click('[data-cand="sumaura"]'); pg.click('#form button[type=submit]'); pg.wait_for_timeout(150)
    check('3 3か所が登録され、どこかの日に入る', len(allrows(pg))==3, allrows(pg))
    check('3 未定の場所は「日はおまかせ」', '日はおまかせ' in pg.locator('.prow', has_text='須磨浦').inner_text())
    # 検索から登録
    pg.fill('#q','ポートタワー'); pg.click('#search'); pg.wait_for_selector('.results .item')
    pg.locator('.results .item').first.click(); pg.wait_for_selector('#f-name')
    check('4 検索から登録フォームが開く', pg.locator('#f-name').input_value()=='神戸ポートタワー')
    pg.locator('label.seg', has_text='行けたら').click(); pg.click('#form button[type=submit]'); pg.wait_for_timeout(150)
    check('4 検索した場所も登録できる', any('ポートタワー' in x for x in allrows(pg)) or pg.locator('text=見送り候補').count()>0)
    # 変更：時刻を入れる
    pg.locator('.prow', has_text='TOTTEI').locator('[data-act=edit]').click(); pg.wait_for_selector('#f-at')
    pg.select_option('#f-day','2'); pg.select_option('#f-at','15:00'); pg.click('#form button[type=submit]'); pg.wait_for_timeout(150)
    t=pg.locator('.prow', has_text='TOTTEI').locator('.pmeta').first.inner_text()
    check('5 あとから「11/2の15:00」に変えると反映', any('TOTTEI' in x for x in rows(pg,2)) and '15:00着' in t, t)
    # 何日目のセレクトでおまかせに戻す
    pg.locator('.prow', has_text='有馬温泉').locator('select').select_option(''); pg.wait_for_timeout(150)
    check('6 一覧から「おまかせ」に戻せる', '日はおまかせ' in pg.locator('.prow', has_text='有馬温泉').inner_text())
    # シナリオ②へ
    pg.select_option('#sc','k2'); pg.wait_for_timeout(200)
    check('7 シナリオ②を選ぶと3か所が入った状態になる', len(allrows(pg))==3, allrows(pg))
    pg.click('[data-cand="dinner"]'); pg.select_option('#f-day','1'); pg.click('#form button[type=submit]'); pg.wait_for_timeout(150)
    t=pg.locator('.prow', has_text='神戸牛').locator('.pmeta').first.inner_text()
    check('7 夕食予約が11/1の18:30着', '18:30着' in t and any('神戸牛' in x for x in rows(pg,1)), t)
    # ④ 宿を変える
    pg.select_option('#sc','k4'); pg.wait_for_timeout(150)
    pg.click('#trip-set summary'); pg.select_option('#t-n1','arima'); pg.wait_for_timeout(200)
    d=[i for i in range(4) if any('有馬温泉' in x for x in rows(pg,i))]
    check('8 2泊目を有馬にすると有馬温泉は11/1か11/2', d and d[0] in (1,2), d)
    check('8 11/1の到着が宿（有馬温泉）', '宿（有馬温泉）' in pg.locator('section.day').nth(1).inner_text())
    # ⑤ 旅行中
    pg.select_option('#sc','k5'); pg.wait_for_timeout(200)
    check('9 ⑤：旅行中モードで今日=11/1', pg.locator('#trip-toggle').get_attribute('aria-pressed')=='true' and pg.locator('#today').input_value()=='1')
    pg.evaluate('window.__tapMap(34.6946,135.1955)'); pg.wait_for_timeout(200)
    nx=pg.locator('#next').inner_text()
    check('9 ⑤：次の目的地・方角・道案内', '次は' in nx and 'へ' in nx and 'Googleマップで道案内' in nx, nx)
    first=pg.locator('#next b').inner_text()
    name=first.split('「')[1].split('」')[0]
    pg.locator('.prow', has_text=name).locator('[data-act=cancel]').click(); pg.wait_for_timeout(100)
    pg.click('#replan'); pg.wait_for_timeout(200)
    check('9 ⑤：中止した場所は次に来ない', name not in pg.locator('#next b').inner_text(), pg.locator('#next b').inner_text())
    check('9 ⑤：夕食予約に遅れない', not pg.locator('.prow', has_text='神戸牛').locator('.pwarn').count())
    # ↑とドラッグ
    pg.locator('#trip-toggle').click(); pg.wait_for_timeout(100)
    d0=[i for i in range(4) if len(rows(pg,i))>=2][0]; ids=rows(pg,d0)
    pg.locator(f'.day-list[data-d="{d0}"] .prow').nth(1).locator('[data-act=up]').click(); pg.wait_for_timeout(100)
    check('10 ↑で入れ替え', rows(pg,d0)[0]==ids[1])
    last=rows(pg,d0)[-1]; h=pg.locator(f'.day-list[data-d="{d0}"] .prow').last.locator('.handle').bounding_box(); top=pg.locator(f'.day-list[data-d="{d0}"] .prow').first.bounding_box()
    pg.mouse.move(h['x']+10,h['y']+10); pg.mouse.down()
    for k in range(1,21): pg.mouse.move(h['x']+10, h['y']+10-(h['y']-top['y']+20)*k/20)
    pg.mouse.up(); pg.wait_for_timeout(150)
    check('10 ドラッグで一番上へ', rows(pg,d0)[0]==last, rows(pg,d0))
    # 感想
    pg.locator('input[name=fb-fit][value="◎ しっくり"]').check(); pg.locator('input[name=fb-want][value="何日目"]').check(); pg.fill('#fb-memo','テスト'); pg.click('#fb-copy'); pg.wait_for_timeout(150)
    out=pg.locator('#fb-out').inner_text()
    check('11 感想をまとめて出せる', '◎ しっくり' in out and '何日目' in out and 'テスト' in out, out)
    pg.reload(); pg.wait_for_selector('.day')
    check('12 再読み込み後も残る', pg.locator('#sc').input_value()=='k5' and pg.locator('#fb-memo').input_value()=='テスト')
    check('13 横にはみ出さない', not pg.evaluate('document.documentElement.scrollWidth>innerWidth+1'))
    check('14 エラーなし', not errors, errors)
    pg.screenshot(path='/tmp/claude-0/-home-claude/a34660fc-d072-5f77-a394-f08f1d9e5aad/scratchpad/kobe.png', full_page=True)
    b.close()
srv.shutdown(); print(f"\n{sum(R)} OK / {len(R)-sum(R)} NG")

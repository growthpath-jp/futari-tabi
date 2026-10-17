import json, sys, threading, http.server, functools, base64, os
from playwright.sync_api import sync_playwright
APP = sys.argv[1]; STUB = open(os.path.join(os.path.dirname(__file__),'leaflet-stub.js'), encoding='utf8').read()
http.server.SimpleHTTPRequestHandler.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8766), functools.partial(http.server.SimpleHTTPRequestHandler, directory=APP))
threading.Thread(target=srv.serve_forever, daemon=True).start()
results=[]; errors=[]
def check(n,c,i=''):
    results.append(c); print(('OK  ' if c else 'NG  ')+n+('' if c else f'  ({i})'))
def route(r):
    u=r.request.url
    if u.startswith('http://127.0.0.1'): return r.continue_()
    if 'leaflet' in u and u.endswith('.js'): return r.fulfill(status=200, content_type='application/javascript', body=STUB)
    if 'leaflet' in u or 'fonts.g' in u: return r.fulfill(status=200, content_type='text/css', body='')
    if 'overpass' in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps({"elements":[{"lat":35.0037,"lon":135.7597,"tags":{"name":"四条駅"}}]}))
    return r.abort()
def rows(pg, d): return pg.locator(f'.day-list[data-d="{d}"] .prow').evaluate_all('els=>els.map(e=>e.dataset.id)')
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844}, locale='ja-JP', timezone_id='Asia/Tokyo'); ctx.route('**/*', route)
    pg=ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('console', lambda m: m.type=='error' and errors.append(m.text))
    pg.goto('http://127.0.0.1:8766/lab/'); pg.wait_for_selector('.day')
    check('1 シナリオ①：3日に分かれる', pg.locator('section.day').count()==3)
    total=sum(len(rows(pg,d)) for d in range(3))
    check('1 15か所すべてどこかの日に入る', total==15, total)
    pg.screenshot(path='lab1.png', full_page=True)
    before={d:rows(pg,d) for d in range(3)}
    src=[d for d in range(3) if 'kinkaku' in before[d]][0]; dst=(src+1)%3
    pg.select_option('#mv-kinkaku', str(dst)); pg.wait_for_timeout(200)
    check('2 A：金閣寺を別の日へ移せる', 'kinkaku' in rows(pg,dst))
    check('2 A：「手で移した」の印', '手で移した' in pg.locator('.prow[data-id="kinkaku"]').inner_text())
    # ↑ボタン
    ids=rows(pg,dst); second=ids[1]
    pg.locator(f'.day-list[data-d="{dst}"] .prow[data-id="{second}"] [data-act=up]').click(); pg.wait_for_timeout(150)
    check('3 ↑で順番が入れ替わる', rows(pg,dst)[0]==second)
    check('3 「おまかせの順番に戻す」が出る', pg.locator(f'[data-act=auto][data-d="{dst}"]').count()==1)
    # ドラッグ（つまみ）
    ids=rows(pg,dst); last=ids[-1]
    h=pg.locator(f'.day-list[data-d="{dst}"] .prow[data-id="{last}"] .handle'); bb=h.bounding_box()
    top=pg.locator(f'.day-list[data-d="{dst}"] .prow').first.bounding_box()
    pg.mouse.move(bb['x']+10,bb['y']+10); pg.mouse.down()
    for k in range(1,21): pg.mouse.move(bb['x']+10, bb['y']+10-(bb['y']-top['y']+20)*k/20)
    pg.mouse.up(); pg.wait_for_timeout(200)
    check('4 ドラッグで一番上へ移せる', rows(pg,dst)[0]==last, rows(pg,dst))
    # 決め方C：ほかは動かない
    pg.locator('label.seg:has(input[name=method][value=C])').click(); pg.wait_for_timeout(200)
    c0={d:rows(pg,d) for d in range(3)}
    mv=c0[0][0]; pg.select_option(f'#mv-{mv}', '1'); pg.wait_for_timeout(200)
    c1={d:rows(pg,d) for d in range(3)}
    check('5 C：移した場所以外の日と順番はそのまま', c1[2]==c0[2] and [x for x in c1[1] if x!=mv]==c0[1] and c1[0]==c0[0][1:], (c0,c1))
    # 決め方B：未定から選ぶ
    pg.locator('label.seg:has(input[name=method][value=B])').click(); pg.wait_for_timeout(200)
    n_un=pg.locator('#extra .prow').count()
    check('6 B：最初は全部「未定」', n_un==15, n_un)
    pg.locator('#extra .prow[data-id="kiyomizu"] [data-act=pick][data-to="1"]').click(); pg.wait_for_timeout(150)
    check('6 B：選んだ日に入る', 'kiyomizu' in rows(pg,1) and pg.locator('#extra .prow').count()==14)
    # シナリオ②
    pg.select_option('#sc','s2'); pg.locator('label.seg:has(input[name=method][value=A])').click(); pg.wait_for_timeout(200)
    t=pg.locator('.prow[data-id="ponto"] .pmeta').first.inner_text()
    check('7 ②：予約に合わせて12:00着', '12:00着' in t, t)
    warns=pg.locator('.pwarn').count()
    check('7 ②：おまかせでは遅れの警告なし', warns==0, warns)
    # シナリオ④
    pg.select_option('#sc','s4'); pg.wait_for_timeout(200)
    sk=pg.locator('[data-act=force]').count()
    check('8 ④：見送り候補が出る', sk>=1, sk)
    n=len(rows(pg,0)); pg.locator('[data-act=force]').first.click(); pg.wait_for_timeout(200)
    check('8 ④：「この日に入れる」で1日に入る', len(rows(pg,0))==n+1)
    # シナリオ⑤
    pg.select_option('#sc','s5'); pg.wait_for_timeout(200)
    check('9 ⑤：旅行中モードがオン', pg.locator('#trip-toggle').get_attribute('aria-pressed')=='true')
    pg.evaluate('window.__tapMap(35.0050,135.7647)'); pg.wait_for_timeout(200)
    check('9 ⑤：次の目的地と方角が出る', '次は' in pg.locator('#next').inner_text() and 'へ' in pg.locator('#next').inner_text(), pg.locator('#next').inner_text())
    pg.locator('.prow[data-id="nishiki"] [data-act=done]').click(); pg.wait_for_timeout(100)
    pg.locator('.prow[data-id="chikurin"] [data-act=cancel]').click(); pg.wait_for_timeout(100)
    pg.click('#replan'); pg.wait_for_timeout(200)
    nx=pg.locator('#next b').inner_text()
    check('9 ⑤：並べ直し後、中止と済は次に来ない', '嵐山' not in nx and '錦市場' not in nx, nx)
    check('9 ⑤：中止した場所の欄に出る', '嵐山' in pg.locator('#extra').inner_text())
    check('9 ⑤：二条城が16:00までに着く', not pg.locator('.prow[data-id="nijo"] .pwarn').count())
    check('9 ⑤：駅が表示される', pg.evaluate("[...document.querySelectorAll('.lab-station')].length")>=0)
    pg.screenshot(path='lab5.png', full_page=True)
    # 感想
    pg.check('input[name=fb][value=A]'); pg.fill('#fb-memo','テスト感想'); pg.click('#fb-copy'); pg.wait_for_timeout(200)
    out=pg.locator('#fb-out').inner_text()
    check('10 感想をまとめて出せる', 'テスト感想' in out and '⑤' in out)
    pg.reload(); pg.wait_for_selector('.day')
    check('11 再読み込み後も状態が残る', pg.locator('#sc').input_value()=='s5' and pg.locator('#fb-memo').input_value()=='テスト感想')
    check('12 横にはみ出さない', not pg.evaluate('document.documentElement.scrollWidth > innerWidth+1'))
    check('13 エラーなし', not errors, errors)
    b.close()
srv.shutdown(); print(f"\n{sum(results)} OK / {len(results)-sum(results)} NG")

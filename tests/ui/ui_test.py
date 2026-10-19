import json, sys, threading, http.server, functools, base64
from playwright.sync_api import sync_playwright
APP = sys.argv[1]; STUB = open('leaflet-stub.js', encoding='utf8').read()
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=')
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8765), functools.partial(http.server.SimpleHTTPRequestHandler, directory=APP))
http.server.SimpleHTTPRequestHandler.log_message = lambda *a, **k: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
results = []; errors = []
K = {'行きたい': 'want', '予定通り': 'visited', '行けなかった': 'missed', '寄り道': 'detour', '線で結ぶ': 'connect', '寄り道を色分け': 'colorDetour'}
def check(name, cond, info=''):
    results.append((name, bool(cond))); print(('OK  ' if cond else 'NG  ') + name + ('' if cond else f'  ({info})'))
def route(r):
    u = r.request.url
    if u.startswith('http://127.0.0.1'): return r.continue_()
    if 'leaflet' in u and u.endswith('.js'): return r.fulfill(status=200, content_type='application/javascript', body=STUB)
    if 'leaflet' in u and u.endswith('.css'): return r.fulfill(status=200, content_type='text/css', body='')
    if 'fonts.g' in u: return r.fulfill(status=200, content_type='text/css', body='')
    if 'msearch.gsi.go.jp' in u:
        return r.fulfill(status=200, content_type='application/json', body=json.dumps([{"geometry":{"coordinates":[135.7850,34.9949],"type":"Point"},"type":"Feature","properties":{"title":"京都府京都市東山区清水一丁目294"}}]))
    if 'nominatim' in u:
        if '%E5%B5%90%E5%B1%B1' in u or '嵐山' in u:
            body=[{"name":"嵐山公園","display_name":"嵐山公園, 右京区, 京都市, 京都府, 日本","lat":"35.0146","lon":"135.6728"},{"name":"渡月橋","display_name":"渡月橋, 右京区, 京都市","lat":"35.0129","lon":"135.6778"}]
        else: body=[]
        return r.fulfill(status=200, content_type='application/json', body=json.dumps(body))
    if u.endswith('.png'): return r.fulfill(status=200, content_type='image/png', body=PNG)
    return r.abort()
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, locale='ja-JP', timezone_id='Asia/Tokyo')
    ctx.route('**/*', route)
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto('http://127.0.0.1:8765/'); pg.wait_for_selector('.bar h1')
    check('1 ホーム：お試しモードの表示', pg.locator('.demo-badge').is_visible())
    check('1 ホーム：見本の旅が3つ（神戸・京都・北海道）', pg.locator('.list .item').count() == 3, pg.locator('.list .item').count())
    pg.screenshot(path='s1-home.png')
    pg.get_by_text('京都旅行（例）').click(); pg.wait_for_selector('#chips .chip')
    m = pg.evaluate('window.__map')
    check('2 旅の地図：ピン7つ', len(m['markers']) == 7, len(m['markers']))
    vis = [l for l in m['lines'] if 'route-visit' in l['cls']]; mis = [l for l in m['lines'] if 'route-missed' in l['cls']]
    check('2 線：行った場所5か所を訪問順で1本', len(vis) == 1 and len(vis[0]['points']) == 5, vis)
    check('2 線：行けなかった2か所を点線で1本', len(mis) == 1 and len(mis[0]['points']) == 2, mis)
    check('2 隠すべき欄が出ていない', not pg.locator('#trip-form').is_visible() and not pg.locator('#sheet').is_visible() and not pg.locator('#trip-menu').is_visible())
    first = pg.locator('#place-list .item').first.inner_text()
    check('2 一覧：1番は清水寺', '清水寺' in first, first)
    pg.screenshot(path='s2-trip.png', full_page=True)
    for lbl in ['行きたい', '予定通り', '行けなかった']: pg.locator(f'#chips .chip[data-k="{K[lbl]}"]').click()
    m = pg.evaluate('window.__map')
    check('3 寄り道だけ：ピン2つ・線1本', len(m['markers']) == 2 and len(m['lines']) == 1, (len(m['markers']), len(m['lines'])))
    pg.locator('#chips .chip[data-k="connect"]').click()
    check('3 線で結ぶをオフ：線0本', len(pg.evaluate('window.__map')['lines']) == 0)
    pg.locator('#chips .chip[data-k="colorDetour"]').click()
    check('3 色分けオフ：寄り道が予定通りの色', 'pin-visited' in pg.evaluate('window.__map').get('markers')[0]['o']['icon']['html'])
    for lbl in ['行きたい', '予定通り', '行けなかった', '線で結ぶ', '寄り道を色分け']: pg.locator(f'#chips .chip[data-k="{K[lbl]}"]').click()
    # 住所の貼り付け登録
    pg.fill('#add-text', '日本、〒605-0862 京都府京都市東山区清水１丁目２９４'); pg.click('#add-go')
    pg.wait_for_selector('#cf-ok')
    check('4 住所：漢数字の結果でも「仮置き」にならない', '仮置き' not in pg.locator('#add-result').inner_text())
    pg.fill('#cf-name', '清水寺（2回目）'); pg.click('#cf-ok'); pg.wait_for_selector('#sheet h2')
    check('4 住所：登録してピン8つ', len(pg.evaluate('window.__map')['markers']) == 8)
    href = pg.locator('#sheet a', has_text='Googleマップ').get_attribute('href')
    check('4 名前あり→Googleで施設を開くリンク', '%E6%B8%85%E6%B0%B4%E5%AF%BA' in href and '施設' in pg.locator('#sheet a', has_text='Googleマップ').inner_text(), href)
    # 名前検索
    pg.fill('#add-text', '嵐山'); pg.click('#add-go'); pg.wait_for_selector('.cands .item')
    check('5 名前検索：候補2つ', pg.locator('.cands .item').count() == 2)
    pg.locator('.cands .item', has_text='嵐山公園').click(); pg.click('#cf-ok'); pg.wait_for_selector('#sheet h2:has-text("嵐山公園")')
    check('5 名前検索：選んで登録', len(pg.evaluate('window.__map')['markers']) == 9)
    # 見つからない → 地図をタップ → 指で調整
    pg.fill('#add-text', '町家カフェ ことり'); pg.click('#add-go'); pg.wait_for_selector('#nf-tap')
    pg.click('#nf-tap'); pg.evaluate('window.__tapMap(35.0, 135.76)'); pg.wait_for_selector('#cf-ok')
    pg.click('#cf-ok'); pg.wait_for_selector('#sheet .notice')
    check('6 見つからない→地図に置くと調整モード', '指で動かして' in pg.locator('#sheet').inner_text())
    moved = pg.evaluate('window.__dragMarker("町家カフェ ことり", 35.0011, 135.7612)')
    pg.wait_for_timeout(300)
    check('6 ピンを指で動かして保存', moved and '指で調整済み' in pg.locator('#sheet').inner_text())
    pg.fill('#sh-name', ''); pg.locator('#sh-name').dispatch_event('change'); pg.wait_for_timeout(300)
    lnk = pg.locator('#sheet a', has_text='Googleマップ')
    check('7 名前なし→Googleで位置だけを開く', '位置' in lnk.inner_text() and '35.001100%2C135.761200' in lnk.get_attribute('href'), lnk.get_attribute('href'))
    pg.locator('#sheet label.radio', has_text='寄り道').click(); pg.wait_for_timeout(300)
    check('8 状態を寄り道に変えると番号が付く', pg.locator('#place-list .item', has_text='名前なしの場所').locator('.badge').inner_text().strip() != '')
    pg.screenshot(path='s3-sheet.png', full_page=True)
    # 旅を終える
    pg.click('#trip-menu-btn'); pg.click('#trip-close'); pg.wait_for_timeout(300)
    # 引き出しにしまう（行けなかっただけ）
    for lbl in ['行きたい', '予定通り', '寄り道']: pg.locator(f'#chips .chip[data-k="{K[lbl]}"]').click()
    pg.click('#to-drawer'); pg.wait_for_selector('#d-name')
    check('9 引き出し：今の表示が引き継がれる', pg.locator('input[name="d-st"][value="missed"]').is_checked() and not pg.locator('input[name="d-st"][value="visited"]').is_checked())
    pg.fill('#d-name', '京都の心残り'); pg.click('#dform button[type=submit]'); pg.wait_for_selector('#place-list')
    cnt = pg.locator('#place-list li').count()
    check('9 引き出しを開くと行けなかった場所が並ぶ（見本2＋旅を終えて変わった2）', cnt == 4, cnt)
    pg.click('a:has-text("この引き出しを共有")'); pg.check('#s-photos'); pg.click('#s-create'); pg.wait_for_selector('#s-new .code')
    check('10 共有コードができる', len(pg.locator('#s-new .code').inner_text().strip()) >= 8)
    pg.goto('http://127.0.0.1:8765/#/?tab=drawers'); pg.wait_for_selector('.list .item')
    check('11 引き出し一覧に3つ（見本2＋新規1）', pg.locator('.list .item').count() == 3)
    # 旅をまたぐ見本の引き出し
    pg.get_by_text('次こそ行く場所').click(); pg.wait_for_selector('#place-list li')
    check('11 旅をまたいだ引き出し：京都と北海道の行けなかった場所', pg.locator('#place-list li').count() == 5, pg.locator('#place-list li').count())
    pg.goto('http://127.0.0.1:8765/#/settings'); pg.wait_for_selector('#key-show')
    pg.click('#key-show'); pg.wait_for_selector('.toast-error')
    check('12 お試しモードでは記録キーは使えないと伝える', 'お試しモード' in pg.locator('.toast-error').inner_text())
    # 新しい旅
    pg.goto('http://127.0.0.1:8765/#/'); pg.click('#new-trip-open'); pg.fill('#trip-title', '2027年 沖縄'); pg.fill('#trip-start', '2027-05-01'); pg.fill('#trip-end', '2027-05-03'); pg.click('#new-trip button[type=submit]')
    pg.wait_for_selector('.bar h1:has-text("2027年 沖縄")')
    check('13 新しい旅を作る', '2027年5月1日〜3日' in pg.locator('.bar .sub').inner_text(), pg.locator('.bar .sub').inner_text())
    over = pg.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')
    check('14 スマホ幅で横にはみ出さない', not over)
    pg.reload(); pg.wait_for_selector('.bar h1')
    check('15 再読み込みしても記録が残る', '2027年 沖縄' in pg.locator('.bar h1').inner_text())
    errors=[e for e in errors if 'お試しモードでは使えません' not in e]
    check('16 想定外のエラーなし', not errors, errors)
    b.close()
srv.shutdown()
print(f"\n{sum(ok for _, ok in results)} OK / {sum(not ok for _, ok in results)} NG")

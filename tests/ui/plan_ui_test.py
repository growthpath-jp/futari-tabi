# 画面テスト：本番アプリ（お試しモード）で、試し方ガイドの全シナリオを実際に操作する
# 使い方：python3 tests/ui/plan_ui_test.py <アプリのフォルダ>
import json, sys, re, threading, http.server, functools, os, urllib.parse
from playwright.sync_api import sync_playwright
APP = sys.argv[1]; STUB = open(os.path.join(os.path.dirname(__file__), 'leaflet-stub.js'), encoding='utf8').read()
SHOT = sys.argv[2] if len(sys.argv) > 2 else None
http.server.SimpleHTTPRequestHandler.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8772), functools.partial(http.server.SimpleHTTPRequestHandler, directory=APP))
threading.Thread(target=srv.serve_forever, daemon=True).start()
R = []; errors = []
def check(n, c, i=''): R.append(bool(c)); print(('OK  ' if c else 'NG  ') + n + ('' if c else f'  ({i})'))
# 名前検索（OpenStreetMap）の代わり
NAMES = {
    '有馬温泉': ('有馬温泉 金の湯', 34.7973, 135.2478), 'TOTTEI': ('TOTTEI KOBE', 34.6860, 135.1985),
    '須磨浦': ('須磨浦山上遊園', 34.6405, 135.1005), 'コンフォート': ('コンフォートホテルERA神戸三宮', 34.6951, 135.1986),
    '向陽閣': ('兵衛向陽閣', 34.7978, 135.2468), 'GLION': ('GLION ARENA KOBE', 34.6858, 135.1992),
    '北野': ('北野異人館街', 34.7010, 135.1905), '南京町': ('南京町', 34.6880, 135.1878), 'メリケン': ('メリケンパーク', 34.6823, 135.1888),
    'ハーバー': ('umie', 34.6793, 135.1832), '布引': ('布引ハーブ園', 34.7083, 135.1924), '三ノ宮': ('三ノ宮駅', 34.6946, 135.1955),
}
def route(r):
    u = r.request.url
    if u.startswith('http://127.0.0.1'): return r.continue_()
    if 'leaflet' in u and u.endswith('.js'): return r.fulfill(status=200, content_type='application/javascript', body=STUB)
    if 'leaflet' in u or 'fonts.g' in u: return r.fulfill(status=200, content_type='text/css', body='')
    if 'nominatim' in u:
        q = urllib.parse.parse_qs(urllib.parse.urlparse(u).query)['q'][0]
        hit = [v for k, v in NAMES.items() if k in q]
        return r.fulfill(status=200, content_type='application/json', body=json.dumps([{'name': n, 'display_name': f'{n}, 中央区, 神戸市', 'lat': str(a), 'lon': str(b)} for n, a, b in hit]))
    if 'msearch.gsi.go.jp' in u:
        return r.fulfill(status=200, content_type='application/json', body=json.dumps([{'geometry': {'coordinates': [135.1986, 34.6951]}, 'properties': {'title': '兵庫県神戸市中央区雲井通四丁目2-10'}}]))
    if 'overpass' in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps({'elements': []}))
    return r.abort()

day = lambda pg, d: pg.locator(f'section.day[data-day="{d}"]')
rows = lambda pg, d: day(pg, d).locator('.day-list .prow b').all_inner_texts()
dayOf = lambda pg, name: next((d for d in range(4) if any(name in x for x in rows(pg, d))), -1)
first_term = lambda pg, d: day(pg, d).locator('.terminal').first.inner_text()
last_term = lambda pg, d: day(pg, d).locator('.terminal').last.inner_text()
def wait(pg, ms=250): pg.wait_for_timeout(ms)
def register(pg, q, day_idx=None, at=None, stay=None, maybe=False):
    pg.fill('#add-text', q); pg.click('#add-go'); pg.wait_for_selector('.cands [data-i]'); pg.locator('.cands [data-i]').first.click()
    pg.wait_for_selector('#cf-ok')
    if day_idx is not None: pg.select_option('#cp-day', str(day_idx))
    if at: pg.select_option('#cp-at', at)
    if stay: pg.select_option('#cp-stay', str(stay))
    if maybe: pg.locator('label.seg:has(input[name="cp-prio"][value="maybe"])').click()
    pg.click('#cf-ok'); wait(pg, 300)
def answer(pg, a='迷わずできた'): pg.locator(f'[data-gd-answer="{a}"]').click(); wait(pg, 100)
def scenario(pg, sid): pg.select_option('#gd-sc', sid); wait(pg, 600)
def mins(text):
    m = re.search(r'(\d+):(\d\d)ごろ', text); return int(m.group(1)) * 60 + int(m.group(2)) if m else None

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='ja-JP', timezone_id='Asia/Tokyo'); ctx.route('**/*', route)
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.goto('http://127.0.0.1:8772/'); pg.wait_for_selector('.bar h1')
    check('0 ホームに神戸旅行がある', pg.locator('.list .item', has_text='神戸旅行').count() == 1)
    pg.locator('.list .item', has_text='神戸旅行').click(); pg.wait_for_selector('#guide .gd-steps'); wait(pg, 500)

    # ① 行きたい場所を登録
    check('1 予定タブが開き、試し方ガイドが出る', pg.locator('.trip-tabs .seg.on').inner_text() == '予定' and 'やりたいこと' in pg.locator('#guide').inner_text())
    check('1 ガイドは「やりたいこと・こう操作する・こうなる」の3つ', pg.locator('#guide dt').all_inner_texts() == ['やりたいこと', 'こう操作する', 'こうなる'])
    t0 = first_term(pg, 0)
    check('1 1日目は「到着 新神戸駅 12:29着」から', '到着' in t0 and '新神戸駅' in t0 and '12:29着' in t0, t0)
    check('1 最終日は「帰り 新神戸駅 17:00発」', '17:00発' in last_term(pg, 3), last_term(pg, 3))
    check('1 宿は3泊それぞれ「予約済み/まだ/当日探す」', pg.locator('input[name^="pv-ns-"]').count() == 9)
    register(pg, '有馬温泉')
    check('1 有馬温泉を日を決めずに登録 → どこかの日に入る', dayOf(pg, '有馬温泉') >= 0)
    check('1 時刻が入る（◯:◯◯着）', '着' in pg.locator('.prow', has_text='有馬温泉').locator('.pmeta').inner_text())
    answer(pg)
    register(pg, 'TOTTEI'); register(pg, '須磨浦')
    check('1 3か所とも予定に入る', all(dayOf(pg, n) >= 0 for n in ['有馬温泉', 'TOTTEI', '須磨浦']))
    answer(pg)
    pid = pg.locator('.prow', has_text='TOTTEI').get_attribute('data-id')
    pg.select_option(f'#mv-{pid}', '2'); wait(pg, 300)
    check('1 何日目を11/2に変える → 11/2に移り「日を決めた」', dayOf(pg, 'TOTTEI') == 2 and '日を決めた' in pg.locator('.prow', has_text='TOTTEI').inner_text())
    answer(pg)
    check('1 最後まで答えると「次のシナリオへ」', pg.locator('[data-gd-next]').count() == 1)
    pg.locator('[data-gd-step="2"]').click(); wait(pg, 100)
    pg.locator('[data-gd-answer="少し迷った"]').click(); wait(pg, 100)
    check('1 「少し迷った」→「どこで迷った？」を書ける', pg.locator('#gd-note').count() == 1)
    pg.fill('#gd-note', '何日目の場所が分かりにくい'); pg.click('#gd-note-next'); wait(pg, 100)

    # ② 宿
    pg.locator('[data-gd-next]').click(); wait(pg, 600)
    check('2 シナリオ②の状態（3か所・宿はまだ）', len(rows(pg, 0) + rows(pg, 1) + rows(pg, 2) + rows(pg, 3)) == 3 and pg.locator('input[name="pv-ns-0"][value="tbd"]').is_checked())
    pg.locator('label.seg:has(input[name="pv-ns-0"][value="booked"])').click(); wait(pg)
    check('2 「予約済み」を押すと宿を探す欄が開く', pg.locator('[data-pick-for="0"]').count() == 1)
    pg.fill('#pv-pq', 'コンフォートホテル'); pg.click('[data-pick-search]'); pg.wait_for_selector('[data-pick-hit]'); pg.locator('[data-pick-hit]').first.click(); wait(pg, 300)
    e0 = last_term(pg, 0); s1 = first_term(pg, 1)
    check('2 10/31の宿がERAになり、チェックイン15:00〜', 'コンフォートホテルERA神戸三宮' in e0 and pg.locator('#pv-ci-0').input_value() == '15:00', e0)
    check('2 11/1の出発に「チェックアウト 11:00まで」', 'ERA' in s1 and 'チェックアウト 11:00まで' in s1, s1)
    answer(pg)
    arima_day0 = dayOf(pg, '有馬温泉')
    pg.locator('label.seg:has(input[name="pv-ns-1"][value="booked"])').click(); wait(pg)
    pg.fill('#pv-pq', '向陽閣'); pg.click('[data-pick-search]'); pg.wait_for_selector('[data-pick-hit]'); pg.locator('[data-pick-hit]').first.click(); wait(pg, 300)
    d_before = dayOf(pg, '有馬温泉')
    check('2 宿を変えただけでは、日は動かない', d_before == arima_day0, (arima_day0, d_before))
    pg.click('#pv-reassign'); wait(pg, 500)
    check('2 「おまかせの日を組み直す」→ 有馬温泉は11/1か11/2', dayOf(pg, '有馬温泉') in (1, 2), dayOf(pg, '有馬温泉'))
    answer(pg)
    pg.locator('label.seg:has(input[name="pv-ns-2"][value="free"])').click(); wait(pg, 300)
    e2 = last_term(pg, 2); s3 = first_term(pg, 3); r2 = rows(pg, 2)
    check('2 当日探す：11/2の宿は「当日探す（素泊まり）」', '当日探す（素泊まり）' in e2, e2)
    check('2 当日探す：11/3は11/2の最後の場所の近くから', (r2 and f'{r2[-1]}の近く' in s3) or (not r2 and '近く' in s3), (r2, s3))
    answer(pg)

    # ③ 始まり・宿の時間
    scenario(pg, 'g3')
    pg.fill('#pv-arr-time', '13:05'); wait(pg, 300)
    check('3 到着の時刻を13:05に → 「13:05着」', '13:05着' in first_term(pg, 0), first_term(pg, 0))
    answer(pg)
    pg.select_option('#pv-li-1', '18:00'); wait(pg, 300)
    e1 = last_term(pg, 1); f = mins(e1)
    check('3 チェックイン〜18:00 → 18:00までに着く／無理なら赤字', (f is not None and f <= 18 * 60) or '遅れます' in e1 or 'まだありません' in e1, e1)
    answer(pg)
    pg.select_option('#pv-ts-2', '12:00'); wait(pg, 300)
    check('3 出発をチェックアウトより遅く → 注意が出る', 'チェックアウトの11:00を過ぎています' in first_term(pg, 2), first_term(pg, 2))
    answer(pg)

    # ④ 時間の決まった予定・行けたら
    scenario(pg, 'g4')
    register(pg, 'GLION', day_idx=0, at='18:00', stay=180)
    f = mins(last_term(pg, 0))
    check('4 ライブ10/31 18:00 → 宿に着くのは21時以降', f is not None and f >= 21 * 60, last_term(pg, 0))
    check('4 ライブは18:00着', '18:00着' in pg.locator('.prow', has_text='GLION').locator('.pmeta').inner_text())
    answer(pg)
    for q in ['北野', '南京町', 'メリケン', 'ハーバー', '布引']: register(pg, q, maybe=True)
    inplan = sum(len(rows(pg, d)) for d in range(4)); skipped = pg.locator('[data-act="force"]').count()
    check('4 行けたら5か所 → 予定か見送り候補のどちらかに全部ある', inplan + skipped == 9, (inplan, skipped))
    answer(pg)

    # ⑤ 旅行当日
    scenario(pg, 'g5')
    pg.click('#pv-tm'); wait(pg)
    pg.select_option('#pv-today', '1'); wait(pg, 150); pg.select_option('#pv-now', '14:00'); wait(pg, 150)
    gaps = pg.locator('section.day[data-day="1"] .gap')
    check('5 自動では埋めず、11/1に「空き時間」と「空き時間を埋める」ボタンが出る', gaps.count() == 1 and '空き時間を埋める' in gaps.inner_text(), pg.locator('section.day[data-day="1"]').inner_text()[:300])
    before = rows(pg, 1)
    gaps.locator('[data-act="fill"]').click(); wait(pg, 400)
    after = rows(pg, 1)
    check('5 押すと、11/1にもとの場所はそのまま、場所が増える', len(after) > len(before) and all(x in after for x in before), (before, after))
    check('5 旅行中モード：地図をタップするよう案内', '地図をタップして' in pg.locator('.tm-box').inner_text())
    pg.evaluate('window.__tapMap(34.6946,135.1955)'); wait(pg, 300)
    tb = pg.locator('.tm-box').inner_text()
    check('5 次の目的地・方角・距離・道案内', '次は' in tb and ('へ' in tb) and 'Googleマップで道案内' in tb, tb)
    check('5 今日の1日は「今いる場所」から', '今いる場所' in first_term(pg, 1))
    answer(pg)
    nxt = pg.locator('.pv-next').inner_text().split('「')[1].split('」')[0]
    pg.locator(f'section.day[data-day="1"] .prow', has_text=nxt).locator('[data-act="cancel"]').click(); wait(pg, 300)
    pg.click('#pv-replan'); wait(pg, 300)
    check('5 中止した場所は予定から消え、次の目的地が変わる', dayOf(pg, nxt) == -1 and nxt not in pg.locator('.pv-next').inner_text())
    answer(pg)
    done = pg.locator('.pv-next').inner_text().split('「')[1].split('」')[0]
    pg.locator(f'section.day[data-day="1"] .prow', has_text=done).locator('[data-act="done"]').click(); wait(pg, 300)
    pg.click('.trip-tabs a:has-text("記録")'); pg.wait_for_selector('#place-list'); wait(pg, 300)
    lst = pg.locator('#place-list').inner_text()
    check('5 記録タブで「予定通り」と「行けなかった」になっている', f'{done}\n予定通り' in lst and f'{nxt}\n行けなかった' in lst, lst[:300])
    pg.click('.trip-tabs a:has-text("予定")'); pg.wait_for_selector('#guide .gd-steps, #guide [data-gd-next], #gd-copy'); wait(pg, 300)
    answer(pg)

    # 感想
    pg.fill('#gd-memo', '宿は先に決めたい'); pg.click('#gd-copy'); wait(pg, 150)
    out = pg.locator('#gd-out').inner_text()
    check('6 答えと感想をまとめてコピーできる', '行きたい場所を、日を決めずに登録したい → 迷わずできた' in out and '宿は先に決めたい' in out, out[:200])
    check('6 迷った場所のひとことも入る', '日を自分で決めたい → 少し迷った（何日目の場所が分かりにくい）' in out, out[:400])
    pg.reload(); pg.wait_for_selector('#guide'); wait(pg, 400)
    check('6 再読み込みしても続きから', pg.locator('#gd-sc').input_value() == 'g5')
    check('7 横にはみ出さない', not pg.evaluate('document.documentElement.scrollWidth > innerWidth + 1'))
    # 予定の条件を場所の画面から変える
    pid = pg.locator('section.day .prow').first.get_attribute('data-id')
    pg.locator(f'.prow[data-id="{pid}"] [data-act="edit"]').click(); pg.wait_for_selector('#sh-plan')
    pg.select_option('#sp-day', '3'); pg.click('#sh-plan button[type=submit]'); wait(pg, 300)
    check('8 場所の画面で「予定の条件」を変えられる（11/3へ）', pg.locator(f'section.day[data-day="3"] .prow[data-id="{pid}"]').count() == 1)
    check('9 エラーなし', not errors, errors)
    if SHOT: pg.screenshot(path=SHOT, full_page=True)
    b.close()
srv.shutdown(); print(f"\n{sum(R)} OK / {len(R) - sum(R)} NG")

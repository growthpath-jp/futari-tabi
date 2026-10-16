# ふたりの旅 v1 セットアップ手順

ふたりの旅の軌跡を地図にしまっておくアプリ（Webアプリ / PWA）です。
Supabase をつなぐ前でも「お試しモード」で動きます（記録はそのスマホの中だけ）。

全体の流れ：**① アプリを公開 → ② Supabase を準備 → ③ アプリとつなぐ → ④ 夫婦でつながる → ⑤ ショートカット**

---

## ① アプリを公開する（GitHub Pages・無料）　目安10分

1. GitHub で新しいリポジトリ `futari-tabi` を作る（Public）
2. 「Add file → Upload files」で、このフォルダの中身をすべてドラッグして「Commit」
3. Settings → Pages → Source を「Deploy from a branch」、Branch を `main` / `/(root)` にして Save
4. 1〜2分後、`https://（ユーザー名）.github.io/futari-tabi/` を開く → お試しモードで動けばOK
5. iPhone の Safari で開き、共有 →「ホーム画面に追加」

## ② Supabase を準備する（新しいアカウント）　目安15分

1. 新しいアカウントで「New project」。Region は **Tokyo (ap-northeast-1)**
2. 左メニュー **SQL Editor** → `supabase/schema.sql` の中身を全部貼り付けて **Run**
   （2回流しても壊れない作りです）
3. **Authentication → Sign In / Providers → Email**：オンのまま。
   夫婦だけで使うなら「Confirm email」をオフにすると登録がすぐ終わります
4. **Authentication → URL Configuration**：Site URL に①のアプリのURLを入れる
5. **Edge Functions → Deploy a new function → Via Editor**
   - 名前：`ingest-photo`
   - 中身：`supabase/functions/ingest-photo/index.ts` を全部貼り付けて Deploy
   - できた関数の設定で **「Verify JWT（JWTの検証）」をオフ**（ショートカットはログインしないため。代わりに記録キーで本人確認します）

## ③ アプリと Supabase をつなぐ　目安5分

1. Supabase の **Project Settings → API**（または上部の「Connect」）で次の2つをコピー
   - Project URL
   - anon / publishable key（公開して大丈夫な鍵）
2. GitHub で `js/config.js` を開いて鉛筆マーク → 2つを貼って Commit
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';
   ```
   ※ **service_role / secret key は絶対に入れない**
3. アプリを開き直すとログイン画面になります →「はじめて使う（登録）」

## ④ 夫婦でつながる

1. A.H.さん：設定 →「招待コード」をコピーして奥さまに送る
2. 奥さま：アプリで登録 → 設定 →「相手の招待コードを入れる」→ 参加
3. これで旅・場所・写真・引き出しが共有され、片方の変更がすぐもう片方に反映されます

## ⑤ 写真で自動記録（ショートカット）

アプリの 設定 →「ショートカットの作り方を見る」（`docs/shortcut.html`）の手順で作ります。

---

## 中身の一覧

| 場所 | 役割 |
|---|---|
| `index.html` `css/` `js/` | アプリ本体 |
| `js/config.js` | Supabase の接続先（③で入れる） |
| `js/logic.js` | 表示の振り分け・線の順番・写真の照合などの判断 |
| `supabase/schema.sql` | データベースと権限ルール |
| `supabase/functions/ingest-photo/index.ts` | 写真の受け口（ショートカットの送り先） |
| `docs/shortcut.html` | ショートカットの作り方 |
| `tests/` | 自動テスト |

## 使っている外部サービス（すべて無料枠）

- 地図：国土地理院 淡色地図（日本）・OpenStreetMap（海外）→ 色をアプリ用に染めて表示
- 住所 → 位置：国土地理院 住所検索
- 名前 → 候補：OpenStreetMap Nominatim（1秒1回まで。たくさん連続で検索しない）
- Googleマップ：ピンから「Googleマップで見る」で開くだけ（Googleのデータは取り込まない）

## 知っておくこと

- iPhoneでは、アプリに戻った時にコピーした住所を自動で読み取ることがOSの仕組みでできません。「貼り付けて探す」を押すと、iPhoneの「ペースト」確認が出て1タップで読み込めます
- ショートカットから開く地図は、ホーム画面のアプリではなく Safari で開きます。Safari でも1回ログインしておいてください
- 写真は Supabase のストレージ（無料枠1GB）に保存されます。1枚あたり約0.3〜0.5MB（幅1600pxに縮小）

## テストの実行（開発用）

```
node --test tests/logic.test.mjs
node --experimental-strip-types --test tests/ingest.test.mjs
```
`js/logic.js` の判断ロジックを変えたら `node tools/sync-shared.mjs` で写真の受け口にも反映してください。

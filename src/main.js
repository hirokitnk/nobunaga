// エントリーポイント
import { App } from './ui/app.js';
import { deserialize } from './engine/save.js';
import { clearKamonCache } from './ui/kamon.js';

function boot(data) {
  const root = document.getElementById('app');
  const app = new App(root);
  window.__app = app;
  let restored = false;
  if (data && data.save) {
    try {
      app.start(deserialize(data.save));
      restored = true;
    } catch {
      /* 復元できなければタイトルへ */
    }
  }
  if (!restored) app.title();
  // Web フォント読み込み後に家紋（文字入り）を描き直す
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      clearKamonCache();
      if (app.s) app.refresh();
    });
  }
}

const hot = window.claude?.hot;
if (hot?.ready) hot.ready(boot);
else boot(hot?.data ?? {});

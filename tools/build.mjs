// 依存なしの簡易バンドラ。ES モジュールを1つの HTML にまとめる。
//   dist/tenshouki.html  … そのままブラウザで開ける単一ファイル版
//   dist/artifact.html   … <html>/<head>/<body> を含まない埋め込み用
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'src/main.js');

const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g;
const EXPORT_DECL_RE = /^export\s+(?:async\s+)?(function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

const modules = new Map(); // path -> { id, code, deps, exports }
const order = [];

function load(path, stack = []) {
  if (modules.has(path)) return;
  if (stack.includes(path)) throw new Error(`循環 import: ${[...stack, path].map((p) => relative(root, p)).join(' -> ')}`);
  const src = readFileSync(path, 'utf8');
  const deps = [];
  const imports = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const dep = resolve(dirname(path), m[2]);
    deps.push(dep);
    const names = m[1].split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
      const [a, b] = x.split(/\s+as\s+/);
      return b ? `${a}: ${b}` : a;
    });
    imports.push({ dep, names });
  }
  const exports = [...src.matchAll(EXPORT_DECL_RE)].map((m) => m[2]);
  modules.set(path, null);
  for (const d of deps) load(d, [...stack, path]);
  const id = '__m' + order.length;
  let code = src.replace(IMPORT_RE, '').replace(/^export\s+(?=(async\s+)?(function|const|let|class))/gm, '');
  if (/^\s*export\s/m.test(code)) throw new Error(`未対応の export 形式: ${relative(root, path)}`);
  modules.set(path, { id, code, imports, exports });
  order.push(path);
}

load(entry);

// import した名前がすべて export されているか確認（複数宣言子の export などの取りこぼし防止）
for (const p of order) {
  for (const im of modules.get(p).imports) {
    const ex = modules.get(im.dep).exports;
    for (const n of im.names) {
      const name = n.split(':')[0].trim();
      if (!ex.includes(name)) throw new Error(`${relative(root, p)} が import する ${name} は ${relative(root, im.dep)} から export されていません`);
    }
  }
}

let js = '';
for (const p of order) {
  const m = modules.get(p);
  const head = m.imports.map((im) => `const { ${im.names.join(', ')} } = ${modules.get(im.dep).id};`).join('\n');
  js += `// ── ${relative(root, p)} ──\nconst ${m.id} = (() => {\n${head}\n${m.code}\nreturn { ${m.exports.join(', ')} };\n})();\n`;
}
js = `(() => {\n'use strict';\n${js}})();\n`;

const css = readFileSync(resolve(root, 'css/style.css'), 'utf8');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DotGothic16&family=Yuji+Syuku&display=swap">';
const safeJs = js.replace(/<\/script/gi, '<\\/script');
const body = `<div id="app"></div>\n<script>\n${safeJs}</script>`;

mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/tenshouki.html'),
  `<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>天翔記</title>\n${fonts}\n<style>\n${css}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`);
writeFileSync(resolve(root, 'dist/artifact.html'), `<title>天翔記</title>\n${fonts}\n<style>\n${css}</style>\n${body}\n`);
console.log(`モジュール ${order.length} 個 / ${(js.length / 1024).toFixed(0)} KB を dist/ に書き出しました`);

// 페이지 조립: node build.js → dist/ (index.html + config.js, sw.js, manifest, 아이콘). GitHub Pages가 dist/를 그대로 배포
// 데이터는 넣지 않음: 앱이 시작할 때 Supabase에서 읽는다
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const css = read('images.css') + read('app.css');
const logic = read('logic.js'), remote = read('remote.js'), app = read('app.js');
for (const [n, s] of [['css', css], ['logic', logic], ['remote', remote], ['app', app]]) if (/<\/script|<\/style/i.test(s)) throw new Error(n + '에 닫는 태그 문자열이 있음');

const TITLE = '라켓뚱보단 다승왕전';
const THEME = '#20264F';
const FONT_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@500;700;900&display=swap">';
// supabase-js 버전 고정 + 무결성 해시 (버전을 바꾸면 integrity도 다시 계산)
const SUPABASE_JS = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/dist/umd/supabase.js" integrity="sha384-xPW3QHswsICVC2mW6BFNwMbhpLkbZ133fKOhxNx3QGGgAOJfL3O9t8r2aWn1aez6" crossorigin="anonymous"></script>';
const LOADING = '<main><div class="card empty"><div class="pig" aria-hidden="true"></div><b>불러오는 중…</b></div></main>';

const html = '<!doctype html>\n<html lang="ko"><head>' +
  '<meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<title>' + TITLE + '</title>' +
  '<meta name="theme-color" content="' + THEME + '">' +
  '<link rel="manifest" href="manifest.webmanifest">' +
  '<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">' +
  '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">' +
  '<meta name="mobile-web-app-capable" content="yes">' +
  '<meta name="apple-mobile-web-app-capable" content="yes">' +
  '<meta name="apple-mobile-web-app-title" content="다승왕">' +
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">' +
  FONT_LINK +
  '<style>body{margin:0}</style>' +
  '<style id="app-css">' + css + '</style>' +
  '</head><body>' +
  '<div id="app">' + LOADING + '</div>' +
  SUPABASE_JS +
  '<script src="config.js"></script>' +
  '<script id="app-logic">' + logic + '</script>' +
  '<script id="app-remote">' + remote + '</script>' +
  '<script id="app-js">' + app + '</script>' +
  "<script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { });</script>" +
  '</body></html>\n';

const dist = path.join(__dirname, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'icons'), { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), html);
for (const f of ['config.js', 'sw.js', 'manifest.webmanifest']) fs.copyFileSync(path.join(__dirname, f), path.join(dist, f));
for (const f of fs.readdirSync(path.join(__dirname, 'icons'))) fs.copyFileSync(path.join(__dirname, 'icons', f), path.join(dist, 'icons', f));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log('built dist/index.html', (html.length / 1024).toFixed(1) + 'KB');

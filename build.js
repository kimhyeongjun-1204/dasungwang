// 페이지 조립: node build.js → dist/dasungwang.html
const fs = require('fs');
const state = fs.existsSync(__dirname + '/live_state.json') ? JSON.parse(fs.readFileSync(__dirname + '/live_state.json', 'utf8')) : require('./seed.js');
const css = fs.readFileSync(__dirname + '/images.css', 'utf8') + fs.readFileSync(__dirname + '/app.css', 'utf8');
const logic = fs.readFileSync(__dirname + '/logic.js', 'utf8');
const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
for (const [n, s] of [['css', css], ['logic', logic], ['app', app]]) if (/<\/script|<\/style/i.test(s)) throw new Error(n + '에 닫는 태그 문자열이 있음');
const json = JSON.stringify(state).replace(/</g, '\\u003c');
const FONT_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@500;700;900&display=swap">';
const html = '<title>라켓뚱보단 다승왕전</title>' + FONT_LINK +
  '<style id="app-css">' + css + '</style>' +
  '<div id="app"></div>' +
  '<script id="state" type="application/json">' + json + '</script>' +
  '<script id="app-logic">' + logic + '</script>' +
  '<script id="app-js">' + app + '</script>';
fs.mkdirSync(__dirname + '/dist', { recursive: true });
fs.writeFileSync(__dirname + '/dist/dasungwang.html', html);
console.log('built', (html.length / 1024).toFixed(1) + 'KB');

// Supabase 저장소: 읽기는 app_state SELECT, 쓰기·관리자 인증은 RPC(SECURITY DEFINER)만
var Remote = (function () {
  'use strict';
  var TOKEN_KEY = 'ddw-admin-token', TOKEN_DAYS = 30;
  var CODES = ['unauthorized', 'stale_rev', 'no_pin', 'bad_pin', 'bad_new_pin', 'too_large', 'bad_state'];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // 서버로 보내는 state: PIN 해시와 서버가 관리하는 rev/savedAt은 뺀다
  function publicState(state) {
    var s = clone(state);
    delete s.rev; delete s.savedAt;
    if (s.settings) delete s.settings.pin;
    return s;
  }
  function fromRow(row) {
    var s = publicState(row.state);
    s.rev = row.rev; s.savedAt = row.saved_at;
    return s;
  }
  function errorCode(err) {
    var msg = String(err && err.message || '');
    if (CODES.indexOf(msg) >= 0) return { code: msg };
    if (/fetch|network|load failed/i.test(msg)) return { code: 'network' };
    return { code: 'error', message: msg };
  }

  // 관리자 토큰: 이 기기 localStorage에 30일 (store는 get/set/del, 각 호출 예외는 여기서 막음)
  function saveToken(ls, token, now) {
    try { ls.set(TOKEN_KEY, JSON.stringify({ token: token, until: now + TOKEN_DAYS * 864e5 })); } catch (e) { }
  }
  function loadToken(ls, now) {
    try {
      var r = JSON.parse(ls.get(TOKEN_KEY) || 'null');
      return r && r.token && r.until > now ? r.token : null;
    } catch (e) { return null; }
  }
  function clearToken(ls) { try { ls.del(TOKEN_KEY); } catch (e) { } }

  // client: supabase-js 클라이언트 (테스트에서는 흉내 객체)
  function api(client) {
    function call(p) {
      return Promise.resolve(p).then(function (r) {
        if (r.error) { var e = errorCode(r.error); throw e; }
        return r.data;
      }, function (err) { throw errorCode(err); });
    }
    function rpc(name, args) { return call(client.rpc(name, args)); }
    return {
      load: function () { return call(client.from('app_state').select('state,rev,saved_at').eq('id', 1).single()).then(fromRow); },
      login: function (pin) { return rpc('admin_login', { pin: pin }).then(function (t) { return t || null; }); },
      check: function (token) { return rpc('admin_check', { token: token }).then(function (ok) { return ok === true; }); },
      logout: function (token) { return rpc('admin_logout', { token: token }); },
      save: function (token, state, expectedRev) { return rpc('save_state', { token: token, new_state: publicState(state), expected_rev: expectedRev }); },
      changePin: function (token, oldPin, newPin) { return rpc('change_pin', { token: token, old_pin: oldPin, new_pin: newPin }); },
    };
  }
  function connect(cfg, lib) {
    if (!cfg || !cfg.url || /YOUR-/.test(cfg.url + cfg.anonKey)) throw { code: 'config' };
    if (!lib || !lib.createClient) throw { code: 'network' };
    return api(lib.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }));
  }

  return {
    TOKEN_KEY: TOKEN_KEY, publicState: publicState, fromRow: fromRow, errorCode: errorCode,
    saveToken: saveToken, loadToken: loadToken, clearToken: clearToken, api: api, connect: connect,
  };
})();
if (typeof module !== 'undefined') module.exports = Remote;

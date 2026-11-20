// Supabase 저장소: 읽기는 app_state SELECT, 쓰기·관리자 인증은 RPC(SECURITY DEFINER)만
var Remote = (function () {
  'use strict';
  var TOKEN_KEY = 'ddw-admin-token', TOKEN_DAYS = 30;
  var CODES = ['unauthorized', 'stale_rev', 'no_pin', 'bad_pin', 'bad_new_pin', 'too_large', 'bad_state', 'ai_limit', 'ai_failed', 'ai_refused', 'bad_request',
    // 돼블스플랜 제출 검사 (schema.sql pred_check / submit_prediction)
    'closed', 'bad_mode', 'bad_player', 'no_week', 'bad_count', 'bad_side', 'dup_match', 'bad_match', 'bad_quota',
    // 경기 진행 자리 비움 (schema.sql set_availability)
    'not_today', 'not_attending', 'admin_locked', 'bad_status', 'bad_minutes',
    // 진행 PIN·코트 동작 (schema.sql operator_login / set_operator_pin / change_pin / live_action)
    'no_op_pin', 'same_as_admin', 'same_as_operator', 'no_week', 'no_match', 'bad_court', 'court_busy', 'player_busy', 'already_done', 'not_on_court', 'bad_action'];

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
    if (/fetch|network|load failed|send a request/i.test(msg)) return { code: 'network' };
    return { code: 'error', message: msg };
  }

  // 관리 토큰: 이 기기 localStorage에. 돼장(admin)은 30일, 진행 도우미(operator)는 until(다음 새벽 4시)까지
  // (store는 get/set/del, 각 호출 예외는 여기서 막음)
  function saveToken(ls, token, now, role, until) {
    try { ls.set(TOKEN_KEY, JSON.stringify({ token: token, until: until || now + TOKEN_DAYS * 864e5, role: role || 'admin' })); } catch (e) { }
  }
  function loadSession(ls, now) {
    try {
      var r = JSON.parse(ls.get(TOKEN_KEY) || 'null');
      return r && r.token && r.until > now ? { token: r.token, role: r.role === 'operator' ? 'operator' : 'admin' } : null;
    } catch (e) { return null; }
  }
  // 진행 도우미 로그인 만료(schema.sql operator_login과 같게): KST 기준 다음 새벽 4시 (지금이 4시 전이면 그날 4시)
  function nextFourAm(now) {
    var k = new Date(now + 9 * 3600e3), day = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
    var four = day + 4 * 3600e3 - 9 * 3600e3;
    return now < four ? four : four + 864e5;
  }
  function loadToken(ls, now) {
    try {
      var r = JSON.parse(ls.get(TOKEN_KEY) || 'null');
      return r && r.token && r.until > now ? r.token : null;
    } catch (e) { return null; }
  }
  function clearToken(ls) { try { ls.del(TOKEN_KEY); } catch (e) { } }

  // client: supabase-js 클라이언트 (테스트에서는 흉내 객체)
  // opts.realtime === false: Realtime 구독 안 함 (로컬 가짜 서버)
  function api(client, opts) {
    opts = opts || {};
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
      operatorLogin: function (pin) { return rpc('operator_login', { pin: pin }).then(function (t) { return t || null; }); },
      liveCheck: function (token) { return rpc('live_check', { token: token }).then(function (r) { return r === 'admin' || r === 'operator' ? r : null; }); },
      setOperatorPin: function (token, pin) { return rpc('set_operator_pin', { token: token, new_pin: pin }); },
      // 경기 진행: start(court) / finish(side) / cancel — 서버가 그 경기 하나만 바꾸고 새 rev
      liveAction: function (token, d, matchId, action, court, side) { return rpc('live_action', { token: token, p_week: d, p_match: matchId, p_action: action, p_court: court, p_side: side }); },
      check: function (token) { return rpc('admin_check', { token: token }).then(function (ok) { return ok === true; }); },
      logout: function (token) { return rpc('admin_logout', { token: token }); },
      save: function (token, state, expectedRev) { return rpc('save_state', { token: token, new_state: publicState(state), expected_rev: expectedRev }); },
      changePin: function (token, oldPin, newPin) { return rpc('change_pin', { token: token, old_pin: oldPin, new_pin: newPin }); },
      // 돼장 요청을 Edge Function 'rematch'(Claude)로 보내 편성 수정 계획을 받음. 함수는 항상 {ok, code|plan, explanation}
      rematch: function (token, payload) {
        var body = Object.assign({}, payload, { token: token });
        return call(client.functions.invoke('rematch', { body: body })).then(function (d) {
          if (!d || !d.ok) throw { code: (d && d.code) || 'ai_failed' };
          return { plan: d.plan || {}, explanation: d.explanation || '', usage: d.usage || null };
        });
      },

      // ---- 돼블스플랜 ----
      // 이름 없는 집계·피드·마감 비율은 누구나, 누가 골랐는지(predictions)는 DB가 마감된 주만 돌려줌
      predCounts: function (d) { return call(client.from('prediction_counts').select('match_id,side,mode,n').eq('week_date', d)); },
      predEvents: function (d) { return call(client.from('prediction_events').select('id,match_id,side,mode,delta,at').eq('week_date', d).order('id', { ascending: false }).limit(300)); },
      predClose: function (d) { return call(client.from('prediction_close').select('match_id,side,n,total').eq('week_date', d)); },
      predictions: function () { return call(client.from('predictions').select('week_date,player_id,mode,picks,updated_at')); },
      submitPrediction: function (d, pid, mode, picks) { return rpc('submit_prediction', { week_date: d, player_id: pid, mode: mode, picks: picks }); },
      closeSnapshot: function (d) { return rpc('close_snapshot', { week_date: d }); },
      adminListPredictions: function (token, d) { return rpc('admin_list_predictions', { token: token, week_date: d }); },
      adminUpsertPrediction: function (token, d, pid, mode, picks) { return rpc('admin_upsert_prediction', { token: token, week_date: d, player_id: pid, mode: mode, picks: picks }); },
      adminDeletePrediction: function (token, d, pid) { return rpc('admin_delete_prediction', { token: token, week_date: d, player_id: pid }); },
      // ---- 경기 진행 ----
      availability: function (d) { return call(client.from('availability').select('player_id,status,until,by_admin,updated_at').eq('week_date', d)); },
      setAvailability: function (d, pid, status, minutes) { return rpc('set_availability', { p_week: d, p_player: pid, p_status: status, p_minutes: minutes }); },
      adminSetAvailability: function (token, d, pid, status, minutes) { return rpc('admin_set_availability', { token: token, p_week: d, p_player: pid, p_status: status, p_minutes: minutes }); },
      // 돼장 저장(app_state)과 그 주 자리 비움이 바뀌면 onChange(table). live(): 구독 중인지(아니면 앱이 주기적으로 다시 읽음)
      watchLive: function (d, onChange) {
        var live = false, ch = null;
        if (opts.realtime !== false && client.channel) {
          ch = client.channel('live-' + d)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, function () { onChange('app_state'); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'availability', filter: 'week_date=eq.' + d }, function () { onChange('availability'); });
          ch.subscribe(function (status) { live = status === 'SUBSCRIBED'; });
        }
        return {
          live: function () { return live; },
          stop: function () { live = false; if (ch && client.removeChannel) { try { client.removeChannel(ch); } catch (e) { } } ch = null; },
        };
      },
      // counts·events가 바뀌면 onChange(). live(): 구독 중인지(아니면 앱이 주기적으로 다시 읽음)
      watchPredictions: function (d, onChange) {
        var live = false, ch = null;
        if (opts.realtime !== false && client.channel) {
          ch = client.channel('daebles-' + d);
          ['prediction_counts', 'prediction_events'].forEach(function (t) {
            ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: 'week_date=eq.' + d }, function () { onChange(); });
          });
          ch.subscribe(function (status) { live = status === 'SUBSCRIBED'; });
        }
        return {
          live: function () { return live; },
          stop: function () { live = false; if (ch && client.removeChannel) { try { client.removeChannel(ch); } catch (e) { } } ch = null; },
        };
      },
    };
  }
  function connect(cfg, lib) {
    if (!cfg || !cfg.url || /YOUR-/.test(cfg.url + cfg.anonKey)) throw { code: 'config' };
    if (!lib || !lib.createClient) throw { code: 'network' };
    return api(lib.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }), { realtime: cfg.realtime });
  }

  return {
    TOKEN_KEY: TOKEN_KEY, publicState: publicState, fromRow: fromRow, errorCode: errorCode,
    saveToken: saveToken, loadToken: loadToken, loadSession: loadSession, nextFourAm: nextFourAm, clearToken: clearToken, api: api, connect: connect,
  };
})();
if (typeof module !== 'undefined') module.exports = Remote;

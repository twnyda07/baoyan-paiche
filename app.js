/* 寶嚴排車座位系統 — 前台
 *
 * 資料一律以後端為準：每次寫入成功後重新載入整份，而不是在本機自己猜結果。
 * 現場會有好幾個人同時在排，本機猜的那一份很快就跟別人的不一樣。
 */
(function () {
  'use strict';

  var LS_BACKEND = 'paiche.backend';
  var 類別序 = ['比丘', '比丘尼', '沙彌', '沙彌尼', '其他'];
  var 放置選項 = ['行李廂', '隨身', '後座'];

  var S = {
    pw: '', by: '', role: '',
    people: [], trips: [], vehicles: [], seats: [],
    tripId: '', today: '',
    busy: false, modalOpen: false,
  };

  /* ===================== 小工具 ===================== */

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function backend() {
    return localStorage.getItem(LS_BACKEND) || (window.CONFIG && window.CONFIG.backend) || '';
  }

  var toastTimer = null;
  function toast(msg, kind) {
    var host = $('toastHost');
    host.innerHTML = '';
    var t = el('div', 'toast' + (kind ? ' ' + kind : ''), msg);
    host.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { host.innerHTML = ''; }, kind === 'bad' ? 5200 : 2600);
  }

  /**
   * 呼叫後端。
   * content-type 用 text/plain：換成 application/json 會觸發 CORS 預檢，
   * 而 Apps Script 的 /exec 不回應 OPTIONS，整個系統會變成「怎麼按都沒反應」。
   */
  function api(action, payload) {
    var url = backend();
    if (!url) return Promise.reject(new Error('還沒設定後端網址'));
    var body = Object.assign({ action: action, pw: S.pw, by: S.by }, payload || {});
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
    }).then(function (r) {
      if (!r.ok) throw new Error('伺服器回應 ' + r.status);
      return r.text();
    }).then(function (txt) {
      var data;
      try { data = JSON.parse(txt); }
      catch (e) { throw new Error('後端回了看不懂的內容，網址可能不是 /exec 結尾'); }
      return data;
    });
  }

  /** 寫入用：失敗時自己跳訊息，回傳 null；成功回 data。BUSY 自動重試一次。 */
  function write(action, payload, opts) {
    opts = opts || {};
    S.busy = true;
    return api(action, payload).then(function (d) {
      if (!d.ok && d.code === 'BUSY') {
        // 撞到別人正在存檔。等一下自己再送一次，不要叫人重按
        return new Promise(function (res) { setTimeout(res, 1500); })
          .then(function () { return api(action, payload); });
      }
      return d;
    }).then(function (d) {
      if (!d.ok) {
        if (!opts.quiet) toast(d.error || '存檔失敗', 'bad');
        return d;
      }
      return d;
    }).catch(function (e) {
      toast(String(e.message || e), 'bad');
      return null;
    }).finally(function () { S.busy = false; });
  }

  function 今天() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function 星期(ymd) {
    var p = String(ymd).split('-');
    if (p.length !== 3) return '';
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return '週' + '日一二三四五六'[d.getDay()];
  }
  function 還有幾天(ymd) {
    var t = S.today || 今天();
    if (ymd === t) return '就是今天';
    var a = new Date(t + 'T00:00:00'), b = new Date(ymd + 'T00:00:00');
    var n = Math.round((b - a) / 86400000);
    if (n === 1) return '明天';
    if (n > 1) return n + ' 天後';
    return '';
  }

  function isAdmin() { return S.role === 'admin'; }

  /* ===================== 登入 ===================== */

  function initGate() {
    var f = $('gateForm');
    $('pw').addEventListener('input', function () {
      // 公開密碼不用填登記人，欄位就不要擺在那裡擋路
      var guestish = $('pw').value.trim().toLowerCase() === 'guest';
      $('byField').hidden = guestish;
    });
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var pw = $('pw').value.trim();
      var by = $('by').value.trim();
      if (!pw) return;
      if (!backend()) {
        $('gateMsg').textContent = '這個網頁還沒接上後端，請聯絡建置的人。';
        return;
      }
      $('gateBtn').disabled = true;
      $('gateMsg').textContent = '連線中…';
      S.pw = pw; S.by = by;
      api('load', {}).then(function (d) {
        $('gateBtn').disabled = false;
        if (!d.ok) {
          $('gateMsg').textContent = d.error || '進不來';
          S.pw = '';
          return;
        }
        // 工作人員一定要有登記人：每一筆異動都要知道是誰做的
        if (d.role === 'admin' && !by) {
          $('gateMsg').textContent = '請填寫登記人';
          $('byField').hidden = false;
          $('by').focus();
          S.pw = '';
          return;
        }
        $('gateMsg').textContent = '';
        $('pw').value = ''; $('by').value = '';   // 共用裝置，不把姓名留在畫面上
        apply(d);
        enterApp();
      }).catch(function (e) {
        $('gateBtn').disabled = false;
        $('gateMsg').textContent = String(e.message || e);
      });
    });
  }

  function enterApp() {
    $('gate').hidden = true;
    $('topbar').hidden = false;
    $('main').hidden = false;
    document.querySelectorAll('[data-admin]').forEach(function (b) { b.hidden = !isAdmin(); });
    $('hdWho').hidden = !isAdmin();
    $('hdWho').textContent = '登記人 ' + S.by;
    $('hdGuest').hidden = isAdmin();
    $('btnAddVeh').hidden = !isAdmin();
    startPolling();
    renderAll();
  }

  function logout() {
    stopPolling();
    S.pw = ''; S.by = ''; S.role = '';
    S.people = []; S.trips = []; S.vehicles = []; S.seats = [];
    $('gate').hidden = false;
    $('topbar').hidden = true;
    $('main').hidden = true;
    $('pw').value = ''; $('by').value = '';
    $('gateMsg').textContent = '';
    $('byField').hidden = false;
  }

  /* ===================== 載入與輪詢 ===================== */

  function apply(d) {
    S.role = d.role;
    S.people = d.people || [];
    S.trips = d.trips || [];
    S.vehicles = d.vehicles || [];
    S.seats = d.seats || [];
    S.today = d.today || 今天();
    // 原本選的那一場被別人刪掉（或過期消失）就退回第一場，不要停在一張空白頁
    if (!S.trips.some(function (t) { return t.id === S.tripId; })) {
      S.tripId = (S.trips[0] && S.trips[0].id) || '';
    }
  }

  function reload(silent) {
    return api('load', {}).then(function (d) {
      if (!d.ok) { if (!silent) toast(d.error || '載入失敗', 'bad'); return false; }
      apply(d);
      renderAll();
      $('staleHint').hidden = true;
      return true;
    }).catch(function (e) {
      if (!silent) toast(String(e.message || e), 'bad');
      else {
        $('staleHint').hidden = false;
        $('staleHint').textContent = '※ 剛剛沒連上後端，畫面上是上一次的資料。';
      }
      return false;
    });
  }

  /* 別人改了要看得到：每 25 秒自己回去拿一次。
     正在填彈出視窗或正在存檔時不拿——否則會把人正在填的東西重畫掉。 */
  var pollTimer = null;
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      if (S.modalOpen || S.busy || document.hidden) return;
      reload(true);
    }, 25000);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  /* ===================== 取資料 ===================== */

  function curTrip() {
    for (var i = 0; i < S.trips.length; i++) if (S.trips[i].id === S.tripId) return S.trips[i];
    return null;
  }
  function tripVehicles(tripId) {
    return S.vehicles.filter(function (v) { return v['行程id'] === tripId; })
      .sort(function (a, b) { return (Number(a['排序']) || 0) - (Number(b['排序']) || 0); });
  }
  function seatOf(vehicleId, no) {
    for (var i = 0; i < S.seats.length; i++) {
      if (S.seats[i]['車輛id'] === vehicleId && Number(S.seats[i]['座位號']) === no) return S.seats[i];
    }
    return null;
  }
  /** 這一場裡，某人坐在哪 → {車號, 座位號} 或 null */
  function 坐在哪(name, tripId) {
    var vids = {};
    tripVehicles(tripId).forEach(function (v) { vids[v.id] = v; });
    for (var i = 0; i < S.seats.length; i++) {
      var s = S.seats[i];
      if (vids[s['車輛id']] && s['姓名'] === name) {
        return { 車號: vids[s['車輛id']]['車號'], 座位號: Number(s['座位號']), vehicleId: s['車輛id'] };
      }
    }
    return null;
  }
  function 分組人員() {
    var g = {};
    類別序.forEach(function (c) { g[c] = []; });
    S.people.forEach(function (p) {
      if (String(p['停用']).trim()) return;
      var c = 類別序.indexOf(p['類別']) >= 0 ? p['類別'] : '其他';
      g[c].push(p);
    });
    類別序.forEach(function (c) {
      g[c].sort(function (a, b) { return (Number(a['排序']) || 0) - (Number(b['排序']) || 0); });
    });
    return g;
  }

  /* ===================== 畫面 ===================== */

  function renderAll() {
    renderTripBar();
    renderVehicles();
    renderDash();
    renderTripList();
    renderPeople();
  }

  function renderTripBar() {
    var bar = $('tripBar');
    bar.innerHTML = '';
    if (!S.trips.length) {
      bar.appendChild(el('p', 'hint', isAdmin()
        ? '還沒有任何行程。到上面的「行程」分頁新增一場。'
        : '目前沒有排定的行程。'));
      $('tripInfo').hidden = true;
      return;
    }
    S.trips.forEach(function (t) {
      var b = el('button', 'tripb' + (t.id === S.tripId ? ' on' : '') + (t['日期'] === S.today ? ' soon' : ''));
      b.type = 'button';
      b.appendChild(el('b', null, t['名稱']));
      var 近 = 還有幾天(t['日期']);
      b.appendChild(el('span', null, t['日期'] + '（' + 星期(t['日期']) + '）' + (近 ? ' · ' + 近 : '')));
      b.addEventListener('click', function () { S.tripId = t.id; renderAll(); });
      bar.appendChild(b);
    });

    var t = curTrip();
    var info = $('tripInfo');
    if (!t) { info.hidden = true; return; }
    var bits = [];
    if (t['集合時間']) bits.push('集合時間 ' + t['集合時間']);
    if (t['集合地點']) bits.push('集合地點 ' + t['集合地點']);
    if (t['備註']) bits.push(t['備註']);
    info.hidden = !bits.length;
    info.textContent = bits.join('　·　');
  }

  function renderVehicles() {
    var host = $('vehList');
    host.innerHTML = '';
    var t = curTrip();
    $('seatTop').hidden = !t;
    if (!t) return;

    var vs = tripVehicles(t.id);
    if (!vs.length) {
      host.appendChild(el('p', 'empty', isAdmin()
        ? '這一場還沒有車。按上面「＋ 新增車輛」開始排。'
        : '這一場還沒有安排車輛。'));
      return;
    }
    vs.forEach(function (v) { host.appendChild(vehCard(v)); });
  }

  function vehCard(v) {
    var 座位數 = Number(v['座位數']) || 0;
    var card = el('div', 'veh');

    var hd = el('div', 'veh-hd');
    var h = el('h3');
    h.appendChild(document.createTextNode(v['車號']));
    if (v['車牌號碼']) {
      var pl = el('span', 'plate', v['車牌號碼']);
      h.appendChild(pl);
    }
    hd.appendChild(h);

    var 已坐 = 0, 行李 = 0;
    for (var i = 1; i <= 座位數; i++) {
      var s = seatOf(v.id, i);
      if (s && s['姓名']) { 已坐++; 行李 += Number(s['行李件數']) || 0; }
    }
    var meta = el('div', 'veh-meta');
    meta.appendChild(mi('司機', v['司機'] || '尚未指定'));
    if (v['司機電話']) meta.appendChild(mi('電話', v['司機電話']));
    meta.appendChild(mi('已排', 已坐 + ' / ' + 座位數 + ' 位'));
    meta.appendChild(mi('行李', 行李 + ' 件'));
    if (v['備註']) meta.appendChild(mi('備註', v['備註']));
    hd.appendChild(meta);

    var 上限 = Number(v['行李上限']) || 0;
    if (上限 && 行李 > 上限) {
      var w = el('div', 'note warn', '行李 ' + 行李 + ' 件，超過這台車登記的上限 ' + 上限 + ' 件。');
      w.style.marginTop = '8px';
      hd.appendChild(w);
    }
    card.appendChild(hd);

    if (isAdmin()) {
      var bar = el('div', 'veh-bar noprint');
      var b1 = el('button', 'btn sm', '改車輛資料');
      b1.addEventListener('click', function () { vehicleModal(v); });
      var b2 = el('button', 'btn sm danger', '刪除這台車');
      b2.addEventListener('click', function () {
        if (!confirm('確定刪除「' + v['車號'] + '」？車上已排的 ' + 已坐 + ' 人會一起清掉。')) return;
        write('deleteVehicle', { id: v.id }).then(function (d) { if (d && d.ok) { toast('已刪除', 'good'); reload(); } });
      });
      bar.appendChild(b1); bar.appendChild(b2);
      card.appendChild(bar);
    }

    var seats = el('div', 'seats');
    for (var n = 1; n <= 座位數; n++) seats.appendChild(seatRow(v, n));
    card.appendChild(seats);
    return card;
  }

  function mi(k, val) {
    var w = el('span');
    w.appendChild(el('i', null, k + ' '));
    w.appendChild(document.createTextNode(val));
    return w;
  }

  function seatRow(v, n) {
    var s = seatOf(v.id, n);
    var 有人 = !!(s && s['姓名']);
    var row = el('div', 'seat ' + (有人 ? 'filled' : 'empty'));
    row.appendChild(el('span', 'no', String(n)));

    var nm = el('span', 'nm');
    nm.appendChild(document.createTextNode(有人 ? s['姓名'] : '（空位）'));
    var sub = [];
    if (有人 && s['類別']) sub.push(s['類別']);
    if (s && s['備註']) sub.push(s['備註']);
    if (sub.length) nm.appendChild(el('small', null, sub.join('　·　')));
    row.appendChild(nm);

    if (有人) {
      var 件 = Number(s['行李件數']) || 0;
      var bg = el('span', 'bags');
      if (件) {
        bg.appendChild(document.createTextNode('行李 '));
        bg.appendChild(el('b', null, String(件)));
        bg.appendChild(document.createTextNode(' 件' + (s['行李放置'] ? '·' + s['行李放置'] : '')));
      } else {
        bg.textContent = '無行李';
        bg.style.color = 'var(--ink-3)';
      }
      row.appendChild(bg);
    }

    if (isAdmin()) {
      var go = el('button', 'btn sm go noprint', 有人 ? '改' : '排');
      go.addEventListener('click', function () { seatModal(v, n); });
      row.appendChild(go);
    }
    return row;
  }

  /* ===================== 彈出視窗 ===================== */

  function modal(title, sub, build) {
    S.modalOpen = true;
    var host = $('modalHost');
    host.innerHTML = '';
    var wrap = el('div', 'modal');
    var inner = el('div', 'modal-in');
    inner.appendChild(el('h2', null, title));
    if (sub) inner.appendChild(el('p', 'sub', sub));
    var close = function () { host.innerHTML = ''; S.modalOpen = false; };
    build(inner, close);
    wrap.appendChild(inner);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    host.appendChild(wrap);
    return close;
  }

  function field(parent, label, node) {
    var l = el('label', 'field');
    l.appendChild(el('span', null, label));
    l.appendChild(node);
    parent.appendChild(l);
    return node;
  }
  function input(value, type, placeholder) {
    var i = document.createElement('input');
    i.type = type || 'text';
    i.value = value == null ? '' : value;
    i.autocomplete = 'off';
    if (placeholder) i.placeholder = placeholder;
    return i;
  }

  /* ---------- 排座位 ---------- */

  function seatModal(v, n) {
    var s = seatOf(v.id, n) || null;
    var base = s ? s['更新時間'] : '';
    var sel = { name: (s && s['姓名']) || '', bags: s ? (Number(s['行李件數']) || 0) : 0, place: (s && s['行李放置']) || '行李廂' };

    modal(v['車號'] + ' · 第 ' + n + ' 位',
      (v['車牌號碼'] ? v['車牌號碼'] + '　' : '') + '司機 ' + (v['司機'] || '尚未指定'),
      function (box, close) {
        /* 人員下拉：依比丘、比丘尼、沙彌、沙彌尼的順序分群，
           已經排在這一場別台車的人，名字後面直接標出來在哪 —— 不標的話很容易重複排 */
        var g = 分組人員();
        var sl = document.createElement('select');
        var o0 = document.createElement('option');
        o0.value = ''; o0.textContent = '（空位 — 不排人）';
        sl.appendChild(o0);
        類別序.forEach(function (c) {
          if (!g[c].length) return;
          var grp = document.createElement('optgroup');
          grp.label = c + '（' + g[c].length + '）';
          g[c].forEach(function (p) {
            var o = document.createElement('option');
            o.value = p['姓名'];
            var at = 坐在哪(p['姓名'], v['行程id']);
            var 在這格 = at && at.vehicleId === v.id && at.座位號 === n;
            o.textContent = p['姓名'] + (at && !在這格 ? '　← 已在 ' + at.車號 + ' 第 ' + at.座位號 + ' 位' : '');
            grp.appendChild(o);
          });
          sl.appendChild(grp);
        });
        sl.value = sel.name;
        field(box, '這個位子坐誰', sl);

        var bagWrap = el('div');
        var bagLbl = el('span');
        bagLbl.style.cssText = 'display:block;font-size:.85rem;color:var(--ink-2);margin-bottom:5px';
        bagLbl.textContent = '行李件數';
        bagWrap.appendChild(bagLbl);
        var steps = el('div', 'steps');
        for (var i = 0; i <= 5; i++) {
          (function (k) {
            var b = el('button', 'step' + (sel.bags === k ? ' on' : ''), k === 0 ? '無' : String(k));
            b.type = 'button';
            b.addEventListener('click', function () {
              sel.bags = k;
              steps.querySelectorAll('.step').forEach(function (x) { x.classList.remove('on'); });
              b.classList.add('on');
              placeRow.hidden = k === 0;
            });
            steps.appendChild(b);
          })(i);
        }
        bagWrap.appendChild(steps);
        bagWrap.style.marginBottom = '12px';
        box.appendChild(bagWrap);

        var placeSel = document.createElement('select');
        放置選項.forEach(function (p) {
          var o = document.createElement('option');
          o.value = p; o.textContent = p;
          placeSel.appendChild(o);
        });
        placeSel.value = 放置選項.indexOf(sel.place) >= 0 ? sel.place : '行李廂';
        var placeRow = el('label', 'field');
        placeRow.appendChild(el('span', null, '行李放哪'));
        placeRow.appendChild(placeSel);
        placeRow.hidden = sel.bags === 0;
        box.appendChild(placeRow);

        var note = field(box, '備註（選填）', input((s && s['備註']) || '', 'text', '例：需要靠走道、暈車'));

        if (s && s['登記人']) {
          box.appendChild(el('p', 'hint', '這一格上次是「' + s['登記人'] + '」在 ' + s['更新時間'] + ' 排的。'));
        }

        var act = el('div', 'actions');
        act.style.marginTop = '12px';
        var save = el('button', 'btn primary', '儲存');
        save.style.flex = '1 1 auto';
        var cancel = el('button', 'btn ghost', '取消');
        act.appendChild(save); act.appendChild(cancel);
        box.appendChild(act);
        cancel.addEventListener('click', close);

        save.addEventListener('click', function () {
          save.disabled = true;
          var payload = {
            vehicleId: v.id, seatNo: n, base: base,
            name: sl.value, bags: sel.bags, bagPlace: sel.bags ? placeSel.value : '',
            note: note.value.trim(),
          };
          submitSeat(payload, close, function () { save.disabled = false; });
        });
      });
  }

  function submitSeat(payload, close, unlock) {
    write('setSeat', payload, { quiet: true }).then(function (d) {
      if (!d) { unlock(); return; }
      if (d.ok) { close(); toast('已存檔', 'good'); reload(); return; }

      if (d.code === 'DUP') {
        // 同一個人不能坐兩個位子。要搬就讓後端在同一把鎖裡搬，不要前台拆成兩次
        if (confirm(d.error + '\n\n要把他改排到這裡嗎？（原來的位子會空出來）')) {
          payload.move = true;
          submitSeat(payload, close, unlock);
        } else unlock();
        return;
      }
      if (d.code === 'CONFLICT') {
        // 別人比你早一步改了這一格。把現況講出來，讓人決定要不要蓋過去
        if (confirm(d.error + '\n\n要用你剛剛填的蓋過去嗎？')) {
          payload.force = true;
          payload.base = d.current ? d.current['更新時間'] : '';
          submitSeat(payload, close, unlock);
        } else { close(); reload(); }
        return;
      }
      toast(d.error || '存檔失敗', 'bad');
      unlock();
    });
  }

  /* ---------- 車輛 ---------- */

  function vehicleModal(v) {
    var t = curTrip();
    if (!t) return;
    var isNew = !v;
    var vs = tripVehicles(t.id);
    modal(isNew ? '新增車輛' : '修改「' + v['車號'] + '」', t['日期'] + '　' + t['名稱'], function (box, close) {
      var 車號 = field(box, '車號', input(isNew ? '第' + '一二三四五六七八九十'[Math.min(vs.length, 9)] + '車' : v['車號'], 'text', '例：第一車'));
      var 車牌 = field(box, '車牌號碼', input(isNew ? '' : v['車牌號碼'], 'text', '例：ABC-1234'));
      var 司機 = field(box, '指定司機', input(isNew ? '' : v['司機'], 'text', '司機姓名'));
      var 電話 = field(box, '司機電話（選填）', input(isNew ? '' : v['司機電話'], 'tel', '0912-345-678'));
      var 座位 = field(box, '座位數', input(isNew ? '8' : v['座位數'], 'number'));
      座位.min = '1'; 座位.max = '60';
      var 行李 = field(box, '行李上限件數（選填，超過會提醒）', input(isNew ? '' : v['行李上限'], 'number'));
      行李.min = '0';
      var 備註 = field(box, '備註（選填）', input(isNew ? '' : v['備註'], 'text', '例：九人座、可放輪椅'));

      if (!isNew) {
        box.appendChild(el('p', 'hint', '座位數改少的話，超出的那幾位會自動從車上退出，要重新排。'));
      }
      var act = el('div', 'actions');
      act.style.marginTop = '12px';
      var save = el('button', 'btn primary', '儲存');
      save.style.flex = '1 1 auto';
      var cancel = el('button', 'btn ghost', '取消');
      act.appendChild(save); act.appendChild(cancel);
      box.appendChild(act);
      cancel.addEventListener('click', close);

      save.addEventListener('click', function () {
        save.disabled = true;
        write('saveVehicle', {
          vehicle: {
            id: isNew ? '' : v.id, '行程id': t.id,
            '車號': 車號.value.trim(), '車牌號碼': 車牌.value.trim(),
            '司機': 司機.value.trim(), '司機電話': 電話.value.trim(),
            '座位數': 座位.value, '行李上限': 行李.value.trim(), '備註': 備註.value.trim(),
            '排序': isNew ? vs.length + 1 : v['排序'],
          },
        }).then(function (d) {
          save.disabled = false;
          if (!d || !d.ok) return;
          close();
          if (d.退出 && d.退出.length) toast('已存檔，' + d.退出.join('、') + ' 因座位變少退出，請重排', 'bad');
          else toast('已存檔', 'good');
          reload();
        });
      });
    });
  }

  /* ---------- 行程 ---------- */

  function renderTripList() {
    var host = $('tripList');
    if (!host) return;
    host.innerHTML = '';
    if (!S.trips.length) { host.appendChild(el('p', 'empty', '還沒有行程。')); return; }
    S.trips.forEach(function (t) {
      var c = el('div', 'card');
      var h = el('h3');
      h.style.cssText = 'margin:0 0 4px;font-size:1.05rem';
      h.textContent = t['名稱'];
      c.appendChild(h);
      var bits = [t['日期'] + '（' + 星期(t['日期']) + '）'];
      var 近 = 還有幾天(t['日期']);
      if (近) bits.push(近);
      if (t['集合時間']) bits.push('集合 ' + t['集合時間']);
      if (t['集合地點']) bits.push(t['集合地點']);
      c.appendChild(el('p', 'hint', bits.join('　·　')));
      if (t['備註']) c.appendChild(el('p', 'hint', t['備註']));
      var vs = tripVehicles(t.id);
      var 人 = S.seats.filter(function (s) {
        return vs.some(function (v) { return v.id === s['車輛id']; }) && s['姓名'];
      }).length;
      c.appendChild(el('p', 'hint', vs.length + ' 台車　·　已排 ' + 人 + ' 人'));
      c.appendChild(el('p', 'hint', '建立 ' + t['建立者'] + '　·　最後更新 ' + t['更新者'] + ' ' + t['更新時間']));

      var act = el('div', 'actions');
      var b0 = el('button', 'btn sm', '去排這一場');
      b0.addEventListener('click', function () { S.tripId = t.id; go('seat'); renderAll(); });
      var b1 = el('button', 'btn sm', '修改');
      b1.addEventListener('click', function () { tripModal(t); });
      var b2 = el('button', 'btn sm danger', '刪除');
      b2.addEventListener('click', function () {
        if (!confirm('確定刪除「' + t['名稱'] + '」？\n' + vs.length + ' 台車、已排的 ' + 人 + ' 人會一起刪掉，救不回來。')) return;
        write('deleteTrip', { id: t.id }).then(function (d) { if (d && d.ok) { toast('已刪除', 'good'); reload(); } });
      });
      act.appendChild(b0); act.appendChild(b1); act.appendChild(b2);
      c.appendChild(act);
      host.appendChild(c);
    });
  }

  function tripModal(t) {
    var isNew = !t;
    modal(isNew ? '新增行程' : '修改行程', null, function (box, close) {
      var 日期 = field(box, '日期', input(isNew ? '' : t['日期'], 'date'));
      日期.min = S.today || 今天();
      var 名稱 = field(box, '行程名稱', input(isNew ? '' : t['名稱'], 'text', '例：高雄圓道禪院法會'));
      var 時間 = field(box, '集合時間（選填）', input(isNew ? '' : t['集合時間'], 'time'));
      var 地點 = field(box, '集合地點（選填）', input(isNew ? '' : t['集合地點'], 'text', '例：寶嚴禪寺山門口'));
      var 備註 = field(box, '備註（選填）', input(isNew ? '' : t['備註'], 'text'));
      box.appendChild(el('p', 'hint', '日期過了，這一場連同車輛與座位會自動刪除，不保留。'));

      var act = el('div', 'actions');
      act.style.marginTop = '12px';
      var save = el('button', 'btn primary', '儲存');
      save.style.flex = '1 1 auto';
      var cancel = el('button', 'btn ghost', '取消');
      act.appendChild(save); act.appendChild(cancel);
      box.appendChild(act);
      cancel.addEventListener('click', close);
      save.addEventListener('click', function () {
        save.disabled = true;
        write('saveTrip', {
          trip: {
            id: isNew ? '' : t.id, '日期': 日期.value, '名稱': 名稱.value.trim(),
            '集合時間': 時間.value, '集合地點': 地點.value.trim(), '備註': 備註.value.trim(),
          },
        }).then(function (d) {
          save.disabled = false;
          if (!d || !d.ok) return;
          if (isNew && d.trip) S.tripId = d.trip.id;
          close(); toast('已存檔', 'good'); reload();
        });
      });
    });
  }

  /* ---------- 人員名單 ---------- */

  function renderPeople() {
    var host = $('peopleList');
    if (!host) return;
    var q = ($('qPeople').value || '').trim();
    host.innerHTML = '';
    var g = 分組人員();
    var 總 = 0;
    類別序.forEach(function (c) {
      var list = g[c].filter(function (p) { return !q || p['姓名'].indexOf(q) >= 0; });
      if (!list.length) return;
      總 += list.length;
      var card = el('div', 'card');
      var h = el('h3');
      h.style.cssText = 'margin:0 0 8px;font-size:1rem';
      h.textContent = c + '　' + g[c].length + ' 位';
      card.appendChild(h);
      list.forEach(function (p, i) {
        var row = el('div', 'seat');
        row.style.padding = '7px 0';
        row.appendChild(el('span', 'no', String(i + 1)));
        var nm = el('span', 'nm', p['姓名']);
        var at = 坐在哪(p['姓名'], S.tripId);
        if (at) nm.appendChild(el('small', null, '這一場在 ' + at.車號 + ' 第 ' + at.座位號 + ' 位'));
        row.appendChild(nm);
        if (isAdmin()) {
          var b1 = el('button', 'btn sm go', '改');
          b1.addEventListener('click', function () { personModal(p); });
          var b2 = el('button', 'btn sm go danger', '刪');
          b2.addEventListener('click', function () { delPerson(p); });
          row.appendChild(b1); row.appendChild(b2);
        }
        card.appendChild(row);
      });
      host.appendChild(card);
    });
    if (!總) host.appendChild(el('p', 'empty', q ? '找不到「' + q + '」。' : '名單是空的。'));
  }

  function personModal(p) {
    var isNew = !p;
    modal(isNew ? '新增人員' : '修改「' + p['姓名'] + '」', null, function (box, close) {
      var 姓名 = field(box, '姓名／法號', input(isNew ? '' : p['姓名'], 'text', '例：釋星源'));
      var sl = document.createElement('select');
      類別序.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c; o.textContent = c;
        sl.appendChild(o);
      });
      sl.value = isNew ? '其他' : (類別序.indexOf(p['類別']) >= 0 ? p['類別'] : '其他');
      field(box, '身分', sl);
      box.appendChild(el('p', 'hint', '臨時同行的居士、司機、義工選「其他」就好。'));

      var act = el('div', 'actions');
      act.style.marginTop = '12px';
      var save = el('button', 'btn primary', '儲存');
      save.style.flex = '1 1 auto';
      var cancel = el('button', 'btn ghost', '取消');
      act.appendChild(save); act.appendChild(cancel);
      box.appendChild(act);
      cancel.addEventListener('click', close);
      save.addEventListener('click', function () {
        save.disabled = true;
        write('savePerson', {
          person: { id: isNew ? '' : p.id, '姓名': 姓名.value.trim(), '類別': sl.value, '排序': isNew ? '' : p['排序'] },
        }).then(function (d) {
          save.disabled = false;
          if (!d || !d.ok) return;
          close(); toast('已存檔', 'good'); reload();
        });
      });
    });
  }

  function delPerson(p) {
    if (!confirm('確定把「' + p['姓名'] + '」從名單刪掉？')) return;
    write('deletePerson', { id: p.id }, { quiet: true }).then(function (d) {
      if (!d) return;
      if (d.ok) { toast('已刪除', 'good'); reload(); return; }
      if (d.code === 'IN_USE') {
        if (confirm(d.error + '\n\n要連那些位子一起清掉嗎？')) {
          write('deletePerson', { id: p.id, force: true }).then(function (r) {
            if (r && r.ok) { toast('已刪除', 'good'); reload(); }
          });
        }
        return;
      }
      toast(d.error || '刪不掉', 'bad');
    });
  }

  /* ---------- 總覽 ---------- */

  function renderDash() {
    var t = curTrip();
    $('dashTtl').textContent = t ? t['日期'] + '　' + t['名稱'] : '這一場的統計';
    var stats = $('dashStats'), bags = $('dashBags'), left = $('dashLeft'), all = $('dashAll');
    stats.innerHTML = ''; bags.innerHTML = ''; left.innerHTML = ''; all.innerHTML = '';
    if (!t) { stats.appendChild(el('p', 'empty', '還沒有選行程。')); return; }

    var vs = tripVehicles(t.id);
    var vmap = {};
    vs.forEach(function (v) { vmap[v.id] = v; });
    var mine = S.seats.filter(function (s) { return vmap[s['車輛id']] && s['姓名']; });
    var 座位總數 = vs.reduce(function (a, v) { return a + (Number(v['座位數']) || 0); }, 0);
    var 行李總件 = mine.reduce(function (a, s) { return a + (Number(s['行李件數']) || 0); }, 0);
    var 在冊 = S.people.filter(function (p) { return !String(p['停用']).trim(); });

    [['車輛', vs.length + ' 台'], ['座位', 座位總數 + ' 位'], ['已排', mine.length + ' 人'],
     ['空位', (座位總數 - mine.length) + ' 位'], ['行李', 行李總件 + ' 件']].forEach(function (p) {
      var s = el('div', 'stat');
      s.appendChild(el('b', null, p[1]));
      s.appendChild(el('span', null, p[0]));
      stats.appendChild(s);
    });

    if (!vs.length) { bags.appendChild(el('p', 'empty', '這一場還沒有車。')); }
    vs.forEach(function (v) {
      var ss = mine.filter(function (s) { return s['車輛id'] === v.id; });
      var 件 = ss.reduce(function (a, s) { return a + (Number(s['行李件數']) || 0); }, 0);
      var by放置 = {};
      ss.forEach(function (s) {
        var k = s['行李放置'] || '未指定';
        if (!(Number(s['行李件數']) || 0)) return;
        by放置[k] = (by放置[k] || 0) + (Number(s['行李件數']) || 0);
      });
      var c = el('div', 'card');
      var h = el('h3');
      h.style.cssText = 'margin:0 0 4px;font-size:1rem';
      h.textContent = v['車號'] + (v['車牌號碼'] ? '　' + v['車牌號碼'] : '');
      c.appendChild(h);
      c.appendChild(el('p', 'hint', '司機 ' + (v['司機'] || '尚未指定') +
        '　·　' + ss.length + ' 人　·　行李 ' + 件 + ' 件' +
        (Object.keys(by放置).length ? '（' + Object.keys(by放置).map(function (k) { return k + ' ' + by放置[k]; }).join('、') + '）' : '')));
      var 上限 = Number(v['行李上限']) || 0;
      if (上限 && 件 > 上限) {
        var w = el('p', 'note warn', '超過登記的上限 ' + 上限 + ' 件，請改派或分車。');
        c.appendChild(w);
      }
      bags.appendChild(c);
    });

    var 已排名 = {};
    mine.forEach(function (s) { 已排名[s['姓名']] = 1; });
    var 漏 = 在冊.filter(function (p) { return !已排名[p['姓名']]; });
    if (!漏.length) {
      left.appendChild(el('p', 'note', '名單上的人都排到車了。'));
    } else {
      var c2 = el('div', 'card');
      c2.appendChild(el('p', 'hint', 漏.length + ' 位還沒排：'));
      var p2 = el('p');
      p2.style.margin = '0';
      p2.textContent = 漏.map(function (p) { return p['姓名']; }).join('、');
      c2.appendChild(p2);
      left.appendChild(c2);
    }

    var head = el('tr');
    ['車號', '座位', '姓名', '身分', '行李', '備註', '登記人'].forEach(function (h) {
      head.appendChild(el('th', null, h));
    });
    all.appendChild(head);
    if (!mine.length) {
      var tr0 = el('tr');
      var td0 = el('td', null, '這一場還沒有排任何人。');
      td0.colSpan = 7; td0.style.color = 'var(--ink-3)';
      tr0.appendChild(td0); all.appendChild(tr0);
      return;
    }
    mine.slice().sort(function (a, b) {
      var va = (Number(vmap[a['車輛id']]['排序']) || 0), vb = (Number(vmap[b['車輛id']]['排序']) || 0);
      return va - vb || Number(a['座位號']) - Number(b['座位號']);
    }).forEach(function (s) {
      var tr = el('tr');
      [vmap[s['車輛id']]['車號'], '第 ' + s['座位號'] + ' 位', s['姓名'], s['類別'],
       (Number(s['行李件數']) || 0) ? s['行李件數'] + ' 件' + (s['行李放置'] ? '·' + s['行李放置'] : '') : '—',
       s['備註'] || '', s['登記人'] || ''].forEach(function (v) {
        tr.appendChild(el('td', null, v));
      });
      all.appendChild(tr);
    });
  }

  /* ---------- 紀錄 ---------- */

  function loadLogs() {
    var tb = $('logTable');
    tb.innerHTML = '';
    var head = el('tr');
    ['時間', '動作', '行程', '車輛', '座位', '姓名', '內容', '登記人'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    tb.appendChild(head);
    api('loadLogs', {}).then(function (d) {
      if (!d.ok) { toast(d.error || '讀不到紀錄', 'bad'); return; }
      (d.logs || []).forEach(function (r) {
        var tr = el('tr');
        ['時間', '動作', '行程', '車輛', '座位', '姓名', '內容', '登記人'].forEach(function (k) {
          tr.appendChild(el('td', null, r[k] || ''));
        });
        tb.appendChild(tr);
      });
    }).catch(function (e) { toast(String(e.message || e), 'bad'); });
  }

  /* ===================== 分頁切換 ===================== */

  function go(page) {
    document.querySelectorAll('nav.tabs button').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.page === page ? 'true' : 'false');
    });
    document.querySelectorAll('.page').forEach(function (s) {
      s.classList.toggle('on', s.id === 'page-' + page);
    });
    window.scrollTo(0, 0);
    if (page === 'logs') loadLogs();
  }

  /* ===================== 綁定 ===================== */

  function init() {
    initGate();
    document.querySelectorAll('nav.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { go(b.dataset.page); });
    });
    $('btnReload').addEventListener('click', function () { reload().then(function (ok) { if (ok) toast('已更新', 'good'); }); });
    $('btnLogout').addEventListener('click', logout);
    $('btnAddVeh').addEventListener('click', function () { vehicleModal(null); });
    $('btnAddTrip').addEventListener('click', function () { tripModal(null); });
    $('btnAddPerson').addEventListener('click', function () { personModal(null); });
    $('btnPrint').addEventListener('click', function () { window.print(); });
    $('qPeople').addEventListener('input', renderPeople);

    $('backendUrl').value = backend();
    $('btnSaveBackend').addEventListener('click', function () {
      localStorage.setItem(LS_BACKEND, $('backendUrl').value.trim());
      toast('已儲存，重新整理後生效', 'good');
    });
    $('btnResetBackend').addEventListener('click', function () {
      localStorage.removeItem(LS_BACKEND);
      $('backendUrl').value = backend();
      toast('已改回預設', 'good');
    });
    $('btnSavePw').addEventListener('click', function () {
      var a = $('pwAdmin').value.trim(), g = $('pwGuest').value.trim();
      if (!a && !g) { toast('沒有要改的', 'bad'); return; }
      var chain = Promise.resolve(true);
      if (a) chain = chain.then(function (ok) { return ok ? write('changePassword', { which: 'admin', value: a }).then(function (d) { return !!(d && d.ok); }) : false; });
      if (g) chain = chain.then(function (ok) { return ok ? write('changePassword', { which: 'guest', value: g }).then(function (d) { return !!(d && d.ok); }) : false; });
      chain.then(function (ok) {
        if (!ok) return;
        toast('密碼已更換，請重新登入', 'good');
        $('pwAdmin').value = ''; $('pwGuest').value = '';
        setTimeout(logout, 1200);
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.modalOpen) { $('modalHost').innerHTML = ''; S.modalOpen = false; }
    });
    // 切回這個分頁時補抓一次：手機鎖屏期間輪詢是停的，回來看到的會是舊資料
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && S.pw && !S.modalOpen) reload(true);
    });

    if (!backend()) {
      $('gateDiag').textContent = '※ 這個網頁還沒填後端網址（config.js 的 backend）。';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

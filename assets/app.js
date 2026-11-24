/* SEM Scholars: cổng mentor (frontend tĩnh).
 * Gọi API Apps Script bằng POST JSON (Content-Type text/plain để không cần CORS preflight).
 * Mọi nội dung hiển thị đều đi qua textContent, không dùng innerHTML. */
(function () {
  'use strict';

  var API_URL = (window.SEM_CONFIG && window.SEM_CONFIG.API_URL) || '';
  var STORE_KEY = 'sem_session_v1';
  var TIMEOUT_MS = 30000;
  var STATUSES = ['Active', 'Bảo lưu', 'Hoàn thành', 'Hủy'];

  var state = {
    token: null,
    expiresAt: null,
    data: null,
    status: 'Active',
    pay: { unpaid: false, installment1: false },
    query: '',
    sort: 'newest',
    asMentor: '',
    linkToken: '',
    email: ''
  };

  var $ = function (id) { return document.getElementById(id); };
  var VIEWS = ['viewLogin', 'viewConfirm', 'viewApp', 'viewLoading', 'viewConfig'];

  function show(id) {
    VIEWS.forEach(function (v) { $(v).classList.toggle('hidden', v !== id); });
  }

  // ---------- Lưu phiên ----------
  function saveSession() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ token: state.token, expiresAt: state.expiresAt })); } catch (e) { /* bỏ qua */ }
  }
  function loadSession() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s && s.token && s.expiresAt && new Date(s.expiresAt).getTime() > Date.now()) return s;
    } catch (e) { /* bỏ qua */ }
    return null;
  }
  function clearSession() {
    state.token = null; state.expiresAt = null; state.data = null; state.asMentor = '';
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* bỏ qua */ }
  }

  // ---------- Gọi API ----------
  function api(action, payload) {
    var body = { action: action };
    Object.keys(payload || {}).forEach(function (k) { body[k] = payload[k]; });
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    return fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(body), // chuỗi nên trình duyệt tự đặt text/plain, không cần preflight
      redirect: 'follow',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      return res.json();
    }).then(function (json) {
      if (json && json.ok) return json.data;
      var err = (json && json.error) || { code: 'SERVER_ERROR', message: 'Có lỗi xảy ra, vui lòng thử lại.' };
      throw err;
    }, function () {
      if (timer) clearTimeout(timer);
      throw { code: 'NETWORK', message: 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.' };
    });
  }

  // ---------- Tiện ích giao diện ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 4000);
  }

  function safeUrl(u) {
    try {
      var url = new URL(String(u));
      return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : null;
    } catch (e) { return null; }
  }

  function linkOrText(raw, label) {
    var text = String(raw || '').trim();
    if (!text) return document.createTextNode('—');
    var href = safeUrl(text);
    if (!href) return document.createTextNode(text);
    var a = el('a', null, label);
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }

  function zaloNode(raw) {
    var text = String(raw || '').trim();
    if (!text) return document.createTextNode('—');
    var wrap = document.createElement('span');
    text.split(/\s*\/\s*/).forEach(function (part, i) {
      var digits = part.replace(/[^\d+]/g, '');
      if (i > 0) wrap.appendChild(document.createTextNode(' / '));
      if (/^\+?\d{9,13}$/.test(digits)) {
        var a = el('a', null, part.trim());
        a.href = 'https://zalo.me/' + digits.replace('+', '');
        a.target = '_blank'; a.rel = 'noopener noreferrer';
        wrap.appendChild(a);
      } else {
        wrap.appendChild(document.createTextNode(part));
      }
    });
    return wrap;
  }

  function emailNode(raw) {
    var text = String(raw || '').trim();
    if (!text) return document.createTextNode('—');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return document.createTextNode(text);
    var a = el('a', null, text);
    a.href = 'mailto:' + text;
    return a;
  }

  function field(dl, label, node, cls) {
    dl.appendChild(el('dt', null, label));
    var dd = el('dd', cls || null);
    dd.appendChild(node);
    dl.appendChild(dd);
  }

  // ---------- Đăng nhập ----------
  function showLogin(message) {
    clearSession();
    $('userbox').classList.add('hidden');
    $('emailForm').classList.remove('hidden');
    $('codeForm').classList.add('hidden');
    $('loginError').textContent = message || '';
    show('viewLogin');
  }

  function setBusy(btn, busy, textBusy, textIdle) {
    btn.disabled = busy;
    btn.textContent = busy ? textBusy : textIdle;
  }

  function onEmailSubmit(ev) {
    ev.preventDefault();
    state.email = $('email').value.trim();
    $('loginError').textContent = '';
    var btn = $('sendBtn');
    setBusy(btn, true, 'Đang gửi…', 'Gửi email đăng nhập');
    api('requestLogin', { email: state.email }).then(function (d) {
      setBusy(btn, false, '', 'Gửi email đăng nhập');
      $('emailForm').classList.add('hidden');
      $('codeForm').classList.remove('hidden');
      $('sentNotice').textContent = d.message + ' Bấm nút trong email, hoặc nhập mã 6 số dưới đây.';
      $('code').value = '';
      $('code').focus();
    }, function (err) {
      setBusy(btn, false, '', 'Gửi email đăng nhập');
      $('loginError').textContent = err.message;
    });
  }

  function gotSession(d) {
    state.token = d.token; state.expiresAt = d.expiresAt; state.asMentor = '';
    saveSession();
    loadMentees();
  }

  function onCodeSubmit(ev) {
    ev.preventDefault();
    $('loginError').textContent = '';
    var btn = $('verifyBtn');
    setBusy(btn, true, 'Đang kiểm tra…', 'Đăng nhập');
    api('verifyCode', { email: state.email, code: $('code').value.trim() }).then(function (d) {
      setBusy(btn, false, '', 'Đăng nhập');
      gotSession(d);
    }, function (err) {
      setBusy(btn, false, '', 'Đăng nhập');
      $('loginError').textContent = err.message;
    });
  }

  function onConfirm() {
    $('confirmError').textContent = '';
    var btn = $('confirmBtn');
    setBusy(btn, true, 'Đang đăng nhập…', 'Xác nhận đăng nhập');
    api('redeemLink', { linkToken: state.linkToken }).then(function (d) {
      setBusy(btn, false, '', 'Xác nhận đăng nhập');
      state.linkToken = '';
      gotSession(d);
    }, function (err) {
      setBusy(btn, false, '', 'Xác nhận đăng nhập');
      $('confirmError').textContent = err.message;
    });
  }

  function onLogout() {
    var t = state.token;
    if (t) api('logout', { token: t }).then(function () {}, function () {});
    showLogin('Bạn đã đăng xuất.');
  }

  // ---------- Dữ liệu ----------
  function loadMentees() {
    show('viewLoading');
    api('getMentees', { token: state.token, asMentor: state.asMentor }).then(function (d) {
      state.data = d;
      if (STATUSES.indexOf(state.status) < 0) state.status = 'Active';
      renderApp();
    }, function (err) {
      if (err.code === 'SESSION_EXPIRED') { showLogin('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.'); return; }
      if (state.data) { renderApp(); toast(err.message); return; }
      showLogin(err.message);
    });
  }

  function renderHeader(d) {
    $('userbox').classList.remove('hidden');
    $('who').textContent = d.me;
    $('roleBadge').textContent = d.role === 'admin' ? 'Admin' : 'Mentor';

    var bar = $('adminBar');
    var banner = $('banner');
    if (d.role === 'admin') {
      var sel = $('asSelect');
      sel.textContent = '';
      var o0 = el('option', null, 'Tất cả mentee (admin)'); o0.value = ''; sel.appendChild(o0);
      d.mentorList.forEach(function (n) { var o = el('option', null, 'Xem như mentor: ' + n); o.value = n; sel.appendChild(o); });
      sel.value = state.asMentor;
      bar.classList.remove('hidden');
      banner.classList.remove('hidden');
      banner.textContent = d.view.mode === 'impersonate'
        ? 'Đang xem đúng như mentor ' + d.view.mentorNames[0] + ' thấy (chỉ xem).'
        : 'Chế độ admin: xem toàn bộ mentee, có Code và tên mentor.';
    } else {
      bar.classList.add('hidden');
      banner.classList.add('hidden');
    }
  }

  function renderTabs(d) {
    var tabs = $('tabs');
    tabs.textContent = '';
    STATUSES.forEach(function (s) {
      var b = el('button', 'tab', s + ' (' + (d.counts[s] || 0) + ')');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', s === state.status ? 'true' : 'false');
      b.addEventListener('click', function () { state.status = s; renderApp(); });
      tabs.appendChild(b);
    });
  }

  function renderChips(d) {
    var box = $('payChips');
    box.textContent = '';
    if (state.status !== 'Active') { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    var ap = d.activePayment || { unpaid: 0, installment1: 0 };
    [['unpaid', 'Chưa thanh toán'], ['installment1', 'Đợt 1']].forEach(function (p) {
      var c = el('button', 'chip', p[1] + ' (' + (ap[p[0]] || 0) + ')');
      c.type = 'button';
      c.setAttribute('aria-pressed', state.pay[p[0]] ? 'true' : 'false');
      c.addEventListener('click', function () { state.pay[p[0]] = !state.pay[p[0]]; renderApp(); });
      box.appendChild(c);
    });
  }

  function visibleMentees() {
    var q = state.query.trim().toLowerCase();
    var anyPay = state.pay.unpaid || state.pay.installment1;
    return state.data.mentees.filter(function (m) {
      if (m.status !== state.status) return false;
      if (state.status === 'Active' && anyPay && !state.pay[m.paymentGroup]) return false;
      if (q && m.name.toLowerCase().indexOf(q) < 0 && String(m.email || '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(compareMentees);
  }

  // Mentee không có thời gian đăng ký được coi là đăng ký từ trước khi cập nhật DB (cũ nhất).
  var LEGACY_LABEL = 'Trước khi cập nhật DB';
  var dateFmt = null;
  function formatRegistered(iso) {
    if (!iso) return LEGACY_LABEL;
    var d = new Date(iso);
    if (isNaN(d.getTime())) return LEGACY_LABEL;
    try {
      if (!dateFmt) dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
      var p = {};
      dateFmt.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      return p.day + '/' + p.month + '/' + p.year + ' ' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute;
    } catch (e) { return iso.slice(0, 10); }
  }

  function compareMentees(a, b) {
    if (state.sort !== 'name') {
      var ra = a.registeredAt || '', rb = b.registeredAt || '';
      if (ra !== rb) {
        var cmp = ra < rb ? -1 : 1; // chuỗi ISO UTC so sánh được; chuỗi rỗng (cũ) nhỏ nhất
        return state.sort === 'newest' ? -cmp : cmp;
      }
    }
    return String(a.name).localeCompare(String(b.name), 'vi');
  }

  function payClass(group) {
    if (group === 'unpaid') return 'pay-unpaid';
    if (group === 'installment1') return 'pay-installment1';
    if (group === 'done') return 'pay-done';
    return '';
  }

  function renderCard(m, isAll) {
    var card = el('article', 'mentee');
    var h = el('h3', null, m.name);
    if (isAll) h.appendChild(el('span', 'pill', m.status));
    card.appendChild(h);
    var dl = document.createElement('dl');
    if (m.code !== undefined) {
      field(dl, 'Code', document.createTextNode(m.code || '—'));
      field(dl, 'Mentor', document.createTextNode(m.mentorText || '—'));
    }
    field(dl, 'Đăng ký', document.createTextNode(formatRegistered(m.registeredAt)));
    field(dl, 'Gói', document.createTextNode(m.plan || '—'));
    field(dl, 'Thanh toán cho mentor', document.createTextNode(m.payment || '—'), payClass(m.paymentGroup));
    if (m.status === 'Bảo lưu') field(dl, 'Bảo lưu đến', document.createTextNode(m.holdUntil || '—'));
    field(dl, 'Email', emailNode(m.email));
    field(dl, 'Zalo', zaloNode(m.zalo));
    field(dl, 'CV', linkOrText(m.cvUrl, 'Mở CV'));
    card.appendChild(dl);
    return card;
  }

  function renderList() {
    var list = $('list');
    list.textContent = '';
    var rows = visibleMentees();
    $('summary').textContent = rows.length + ' mentee';
    if (!rows.length) {
      list.appendChild(el('div', 'empty', 'Không có mentee nào phù hợp.'));
      return;
    }
    var isAll = state.data.view.mode === 'all';
    rows.forEach(function (m) { list.appendChild(renderCard(m, isAll)); });
  }

  function renderApp() {
    var d = state.data;
    renderHeader(d);
    renderTabs(d);
    renderChips(d);
    renderList();
    show('viewApp');
  }

  // ---------- Khởi động ----------
  function readLinkFromHash() {
    var m = /^#login=([a-f0-9]{64})$/.exec(location.hash || '');
    if (!m) return '';
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* bỏ qua */ }
    return m[1];
  }

  function init() {
    if (!API_URL) { show('viewConfig'); return; }

    $('emailForm').addEventListener('submit', onEmailSubmit);
    $('codeForm').addEventListener('submit', onCodeSubmit);
    $('backBtn').addEventListener('click', function () {
      $('codeForm').classList.add('hidden'); $('emailForm').classList.remove('hidden'); $('loginError').textContent = '';
    });
    $('confirmBtn').addEventListener('click', onConfirm);
    $('confirmCancel').addEventListener('click', function () { state.linkToken = ''; showLogin(''); });
    $('logoutBtn').addEventListener('click', onLogout);
    $('asSelect').addEventListener('change', function (ev) { state.asMentor = ev.target.value; loadMentees(); });
    $('sortSelect').addEventListener('change', function (ev) { state.sort = ev.target.value; if (state.data) renderList(); });
    $('search').addEventListener('input', function (ev) { state.query = ev.target.value; if (state.data) renderList(); });

    state.linkToken = readLinkFromHash();
    if (state.linkToken) { show('viewConfirm'); return; }

    var s = loadSession();
    if (s) { state.token = s.token; state.expiresAt = s.expiresAt; loadMentees(); return; }
    showLogin('');
  }

  init();
})();

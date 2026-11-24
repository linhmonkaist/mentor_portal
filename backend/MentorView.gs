/**
 * SEM Scholars: logic đăng nhập và dữ liệu cho cổng mentor (phần API nằm trong Api.gs).
 *
 * ĐĂNG NHẬP
 * - Nhập email (phải có trong tab "Team mentor status", hoặc nằm trong ADMIN_EMAILS ở tab Config).
 * - Nhận email có nút "Đăng nhập" (trỏ về FRONTEND_URL) và mã 6 số dự phòng.
 * - Thiết bị được nhớ 30 ngày. Menu "SEM Scholars > Đăng xuất mọi thiết bị" thu hồi tất cả phiên.
 *
 * MENTOR thấy: tên, email, gói, thanh toán cho mentor (cột Payment), link MXH, link CV, số Zalo
 *   của mentee mình phụ trách. KHÔNG thấy: Code, số tiền đã đóng, hình thức thanh toán của mentee.
 * ADMIN (email trong ADMIN_EMAILS): xem toàn bộ mentee (kèm Code và tên mentor), hoặc chọn một
 *   mentor để xem đúng như mentor đó thấy (chỉ xem).
 */

const MENTEE_VIEW_COLS = {
  social: 'Link MXH',   // cột O (setup() tự đặt tên nếu ô tiêu đề đang trống)
  cv: 'Link CV',        // cột R
  zalo: 'Zalo'          // tùy chọn: nếu không có cột này, tìm số Zalo trong ô "Link MXH"
};
const VIEW_BLANK_HEADER_DEFAULTS = [['O', 'Link MXH'], ['R', 'Link CV']];

const OTP_TTL_SEC = 600;
const SESSION_DAYS = 30;
const OTP_MAX_TRIES = 5;
const OTP_MAX_REQUESTS = 3;
const GLOBAL_MAIL_LIMIT = 40;      // tối đa số email đăng nhập gửi ra trong một giờ (toàn hệ thống)
const GLOBAL_MAIL_WINDOW_SEC = 3600;
// Cột Payment là thanh toán CHO MENTOR (không phải tiền của mentee). Trống = mentor chưa được thanh toán.
const NO_PAYMENT_LABEL = 'Chưa thanh toán';
const VIEW_STATUSES = ['Active', 'Bảo lưu', 'Hoàn thành', 'Hủy'];

// ------------------------------------------------------------
// Hàm thuần
// ------------------------------------------------------------

function letterToIndex_(letters) {
  let n = 0;
  String(letters).toUpperCase().split('').forEach(function (ch) { n = n * 26 + (ch.charCodeAt(0) - 64); });
  return n - 1;
}

function emailKey_(email) {
  return String(email === null || email === undefined ? '' : email).trim().toLowerCase();
}

function validEmailFormat_(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/** Lấy số điện thoại từ đoạn chữ có chứa "Zalo". Trả về các số, cách nhau " / ". */
function extractZalo_(text) {
  const s = String(text === null || text === undefined ? '' : text);
  if (!/zalo/i.test(s)) return '';
  const compact = s.replace(/[.\s]/g, '');
  const found = compact.match(/(?:\+84|84|0)\d{8,10}/g);
  return found ? found.join(' / ') : '';
}

/** Nhóm thanh toán cho mentor: unpaid (trống), installment1 (Đợt 1), done (Done/Thưởng), other. */
function paymentGroup_(payment) {
  const p = norm_(payment);
  if (!p) return 'unpaid';
  if (p === 'đợt 1') return 'installment1';
  if (p === 'done' || p === 'thưởng') return 'done';
  return 'other';
}

function parseEmailList_(v) {
  return String(v === null || v === undefined ? '' : v).split(/[,;\s]+/).map(emailKey_).filter(function (x) { return x; });
}

function isAdmin_(email) {
  return getConfig_().ADMIN_LIST.indexOf(emailKey_(email)) >= 0;
}

function listMentorNames_() {
  const data = readColumns_(mustSheet_(SHEET_MENTOR), [MENTOR_COLS.name, MENTOR_COLS.email]);
  const out = [];
  for (let i = 0; i < data.n; i++) {
    const nm = String(data.cols[MENTOR_COLS.name][i] || '').trim();
    if (nm) out.push(nm);
  }
  return out;
}

/** Tên mentor (trong tab mentor) ứng với một email. Có thể nhiều tên nếu email lặp. */
function mentorNamesByEmail_(email) {
  const key = emailKey_(email);
  if (!key) return [];
  const data = readColumns_(mustSheet_(SHEET_MENTOR), [MENTOR_COLS.name, MENTOR_COLS.email]);
  const out = [];
  for (let i = 0; i < data.n; i++) {
    const nm = String(data.cols[MENTOR_COLS.name][i] || '').trim();
    if (nm && emailKey_(data.cols[MENTOR_COLS.email][i]) === key) out.push(nm);
  }
  return out;
}

/** Đặt tiêu đề cho các cột đang trống tiêu đề (O, R) nếu chưa có cột nào mang tên đó. */
function nameViewColumns_(sheet) {
  const map = headerMap_(sheet);
  const done = [];
  VIEW_BLANK_HEADER_DEFAULTS.forEach(function (p) {
    const idx = letterToIndex_(p[0]);
    if (map[p[1]] !== undefined) return;
    const cell = sheet.getRange(HEADER_ROW, idx + 1);
    if (String(cell.getValue() || '').trim() === '') {
      cell.setValue(p[1]);
      done.push(p[0] + '1 = "' + p[1] + '"');
    }
  });
  return done;
}

// ------------------------------------------------------------
// Phiên đăng nhập (token ký HMAC, không lưu trạng thái trên server)
// ------------------------------------------------------------

function getSecret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('SESSION_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', s);
  }
  return s;
}

function sign_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, getSecret_()));
}

function makeSessionToken_(email) {
  const payload = emailKey_(email) + '|' + (Date.now() + SESSION_DAYS * 86400000);
  return Utilities.base64EncodeWebSafe(payload) + '.' + sign_(payload);
}

/** Trả về email nếu token hợp lệ và chưa hết hạn, ngược lại ''. */
function sessionEmail_(token) {
  const t = String(token === null || token === undefined ? '' : token);
  const i = t.indexOf('.');
  if (i < 1) return '';
  let payload;
  try {
    payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(t.slice(0, i))).getDataAsString();
  } catch (e) {
    return '';
  }
  if (sign_(payload) !== t.slice(i + 1)) return '';
  const p = payload.split('|');
  const exp = Number(p[1]);
  if (!p[0] || !(exp > Date.now())) return '';
  return p[0];
}

/** Thu hồi mọi phiên đang có (đổi khóa ký). Dùng khi nghi lộ link hoặc khi cần buộc đăng nhập lại. */
function revokeAllSessions() {
  PropertiesService.getScriptProperties().setProperty('SESSION_SECRET', Utilities.getUuid() + Utilities.getUuid());
  ui_('Đã đăng xuất mọi thiết bị. Mentor sẽ phải đăng nhập lại.');
}

function logoutSession() {
  return true; // phiên được xóa phía trình duyệt; không có trạng thái trên server
}

// ------------------------------------------------------------
// Đăng nhập: nút bấm trong email hoặc mã 6 số
// ------------------------------------------------------------

function randomHex_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

/** Link trỏ về giao diện. Dùng phần sau dấu # để token không gửi lên server và không lọt vào Referer. */
function buildLoginUrl_(base, linkToken) {
  return String(base).replace(/#.*$/, '') + '#login=' + linkToken;
}

function globalMailAllowed_() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('glob_mail') || 0);
  if (n >= GLOBAL_MAIL_LIMIT) return false;
  cache.put('glob_mail', String(n + 1), GLOBAL_MAIL_WINDOW_SEC);
  return true;
}

function expiresAtIso_() {
  return new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
}

/** Cấp phiên mới: { token, expiresAt }. */
function issueSession_(email) {
  return { token: makeSessionToken_(email), expiresAt: expiresAtIso_() };
}

/** Luôn trả lời giống nhau dù email có được phép hay không. */
function requestLoginCode(email) {
  const key = emailKey_(email);
  if (!validEmailFormat_(key)) return { ok: false, code: 'INVALID_EMAIL', message: 'Email không hợp lệ.' };
  const cache = CacheService.getScriptCache();
  const rlKey = 'otp_rl_' + key;
  const n = Number(cache.get(rlKey) || 0);
  if (n >= OTP_MAX_REQUESTS) return { ok: false, code: 'RATE_LIMITED', message: 'Bạn đã yêu cầu mã quá nhiều lần. Vui lòng thử lại sau 10 phút.' };
  cache.put(rlKey, String(n + 1), 600);

  const generic = { ok: true, message: 'Nếu email có trong danh sách, chúng tôi đã gửi email đăng nhập. Email có hiệu lực 10 phút.' };
  const allowed = mentorNamesByEmail_(key).length > 0 || isAdmin_(key);
  if (!allowed) return generic;
  if (MailApp.getRemainingDailyQuota() < 1 || !globalMailAllowed_()) {
    return { ok: false, code: 'RATE_LIMITED', message: 'Hệ thống tạm thời chưa gửi được email. Vui lòng thử lại sau.' };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const linkToken = randomHex_();
  cache.put('otp_' + key, code, OTP_TTL_SEC);
  cache.put('otp_lt_' + key, linkToken, OTP_TTL_SEC);
  cache.put('link_' + linkToken, key, OTP_TTL_SEC);
  cache.remove('otp_try_' + key);

  const cfg = getConfig_();
  const base = cfg.FRONTEND_URL;
  const button = base
    ? '<p><a href="' + esc_(buildLoginUrl_(base, linkToken)) + '" style="background:#1a3d6d;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Đăng nhập</a></p>' +
      '<p>Hoặc nhập mã 6 số này vào trang đăng nhập:</p>'
    : '<p>Mã đăng nhập của bạn là:</p>';
  MailApp.sendEmail({
    to: key,
    subject: '[SEM Scholars] Đăng nhập xem mentee (mã ' + code + ')',
    htmlBody: button + '<p style="font-size:24px;letter-spacing:4px"><b>' + code + '</b></p>' +
      '<p>Có hiệu lực 10 phút. Nếu không phải bạn yêu cầu, hãy bỏ qua email này.</p><p>SEM Scholars</p>',
    name: cfg.SENDER_NAME
  });
  return generic;
}

/** Trả về { ok, token, expiresAt } khi mã đúng. */
function verifyLoginCode(email, code) {
  const key = emailKey_(email);
  const input = String(code === null || code === undefined ? '' : code).replace(/\D/g, '');
  const cache = CacheService.getScriptCache();
  const tryKey = 'otp_try_' + key;
  const tries = Number(cache.get(tryKey) || 0);
  if (tries >= OTP_MAX_TRIES) return { ok: false, code: 'RATE_LIMITED', message: 'Nhập sai quá nhiều lần. Hãy yêu cầu mã mới sau ít phút.' };
  const real = cache.get('otp_' + key);
  if (!real || input.length !== 6 || input !== real) {
    cache.put(tryKey, String(tries + 1), OTP_TTL_SEC);
    if (tries + 1 >= OTP_MAX_TRIES) cache.remove('otp_' + key);
    return { ok: false, code: 'INVALID_CODE', message: 'Mã không đúng hoặc đã hết hạn.' };
  }
  const lt = cache.get('otp_lt_' + key);
  if (lt) cache.remove('link_' + lt);
  cache.remove('otp_lt_' + key);
  cache.remove('otp_' + key);
  cache.remove(tryKey);
  const sess = issueSession_(key);
  return { ok: true, token: sess.token, expiresAt: sess.expiresAt };
}

/** Gọi khi mentor bấm nút xác nhận (không đăng nhập chỉ vì mở link). */
function redeemLoginLink(linkToken) {
  const lt = String(linkToken === null || linkToken === undefined ? '' : linkToken);
  if (!/^[a-f0-9]{64}$/.test(lt)) return { ok: false, code: 'LINK_INVALID', message: 'Link không hợp lệ.' };
  const cache = CacheService.getScriptCache();
  const key = cache.get('link_' + lt);
  if (!key) return { ok: false, code: 'LINK_INVALID', message: 'Link đã hết hạn hoặc đã được dùng. Hãy yêu cầu email mới.' };
  cache.remove('link_' + lt);
  cache.remove('otp_lt_' + key);
  cache.remove('otp_' + key);
  const sess = issueSession_(key);
  return { ok: true, token: sess.token, expiresAt: sess.expiresAt };
}

// ------------------------------------------------------------
// Dữ liệu
// ------------------------------------------------------------

/**
 * Danh sách mentee cho người đăng nhập.
 * - Mentor: chỉ mentee của mình, không có Code và số tiền.
 * - Admin: asMentor trống = toàn bộ (kèm Code, tên mentor); asMentor = tên mentor = xem như mentor đó.
 */
function loadMentees(token, asMentor) {
  const email = sessionEmail_(token);
  if (!email) throw new Error('SESSION_EXPIRED');
  const admin = isAdmin_(email);
  const myNames = mentorNamesByEmail_(email);
  if (!admin && !myNames.length) throw new Error('SESSION_EXPIRED');

  let viewNames = myNames;
  let showAll = false;
  let viewAs = '';
  let mentorList = [];
  if (admin) {
    mentorList = listMentorNames_();
    const want = String(asMentor === null || asMentor === undefined ? '' : asMentor).trim();
    if (!want) {
      showAll = true;
      viewNames = [];
    } else {
      const found = mentorList.filter(function (n) { return norm_(n) === norm_(want); });
      if (!found.length) throw new Error('Không tìm thấy mentor "' + want + '".');
      viewNames = found;
      viewAs = found[0];
    }
  }
  const mine = {};
  viewNames.forEach(function (n) { mine[norm_(n)] = true; });

  const sheet = mustSheet_(SHEET_MENTEE);
  const wanted = [MENTEE_COLS.email, MENTEE_COLS.plan, MENTEE_COLS.status, MENTEE_COLS.holdUntil,
    MENTEE_VIEW_COLS.social, MENTEE_VIEW_COLS.cv, MENTEE_VIEW_COLS.zalo];
  if (showAll) wanted.push(MENTEE_COLS.code);
  const data = readColumns_(sheet, [MENTEE_COLS.mentor, MENTEE_COLS.name, MENTEE_COLS.payment], wanted);
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const counts = {};
  VIEW_STATUSES.forEach(function (s) { counts[s] = 0; });
  const activePayment = { unpaid: 0, installment1: 0 };
  const rows = [];

  for (let i = 0; i < data.n; i++) {
    const name = String(data.cols[MENTEE_COLS.name][i] || '').trim();
    if (!name) continue;
    const mentorCell = String(data.cols[MENTEE_COLS.mentor][i] || '').trim();
    if (!showAll) {
      const isMine = splitMentors_(mentorCell).some(function (m) { return mine[norm_(m)]; });
      if (!isMine) continue;
    }
    const status = getEnrollmentStatus_(data.cols[MENTEE_COLS.status][i], data.cols[MENTEE_COLS.payment][i]);
    const pay = String(data.cols[MENTEE_COLS.payment][i] || '').trim();
    const social = String(data.cols[MENTEE_VIEW_COLS.social][i] || '').trim();
    let zalo = String(data.cols[MENTEE_VIEW_COLS.zalo][i] || '').trim();
    if (!zalo) zalo = extractZalo_(social);
    let hold = '';
    if (status === 'Bảo lưu') {
      const k = dayKey_(data.cols[MENTEE_COLS.holdUntil][i], tz);
      hold = k ? displayDate_(k) : String(data.cols[MENTEE_COLS.holdUntil][i] || '').trim();
    }
    counts[status] = (counts[status] || 0) + 1;
    const pgroup = paymentGroup_(pay);
    if (status === 'Active' && activePayment[pgroup] !== undefined) activePayment[pgroup]++;
    const row = {
      name: name,
      email: String(data.cols[MENTEE_COLS.email][i] || '').trim(),
      plan: String(data.cols[MENTEE_COLS.plan][i] || '').trim(),
      payment: pay || NO_PAYMENT_LABEL,
      paymentGroup: pgroup,
      status: status,
      social: social,
      cv: String(data.cols[MENTEE_VIEW_COLS.cv][i] || '').trim(),
      zalo: zalo,
      holdUntil: hold
    };
    if (showAll) {
      row.code = String(data.cols[MENTEE_COLS.code][i] || '').trim();
      row.mentorText = mentorCell;
    }
    rows.push(row);
  }
  rows.sort(function (a, b) { return a.name.localeCompare(b.name, 'vi'); });
  return {
    me: email,
    admin: admin,
    all: showAll,
    viewAs: viewAs,
    mentors: viewNames,
    mentorList: mentorList,
    counts: counts,
    activePayment: activePayment,
    rows: rows
  };
}

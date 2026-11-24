/**
 * SEM Scholars: nhắc deadline cho mentor.
 *
 * Script gắn với Google Sheet "[SEM DB] Mentor". Mỗi sáng gửi email gộp cho từng mentor
 * về deadline sắp tới của mentee đang Active, và gửi bản tổng hợp cho quản lý.
 *
 * GIẢ ĐỊNH ĐÃ CHỌN
 * 1. Khóa mentee là cột "Code" (mỗi dòng của tab mentee là một lượt đăng ký gói).
 * 2. Nhắc deadline khi "Ngày deadline" cách hôm nay đúng một trong các số ngày của
 *    REMINDER_DAYS_BEFORE (mặc định 7). Nhắc chốt trường khi "Ngày chốt dự kiến" cách hôm nay
 *    0 đến 3 ngày và dòng chưa ở trạng thái Đã chốt / Đã nộp / Có kết quả.
 * 3. Giá trị ô ngày kiểu Date được đọc theo múi giờ của bảng tính; "hôm nay" tính theo TIMEZONE trong Config.
 * 4. Ô ngày dạng chữ chỉ nhận dd/MM/yyyy hoặc yyyy-MM-dd. Dạng khác (ví dụ "3/2026") bị bỏ qua.
 * 5. Cột "Payment" là thanh toán CHO MENTOR (không phải tiền của mentee). Dòng có "Payment" lạ
 *    (không phải Đợt 1 / Done / Thưởng / trống) được coi là Active.
 * 6. Script chỉ đọc các cột cần thiết của tab mentee và tab mentor, không đọc số tiền, link mạng xã hội, link CV.
 * 7. Email tổng hợp cho quản lý chỉ gửi khi có nhắc nhở hoặc có cảnh báo quan trọng, để không gửi thư trống mỗi ngày.
 * 8. Trigger theo giờ của Apps Script chạy trong khoảng một giờ sau SEND_HOUR, không đúng từng phút.
 *
 * HƯỚNG DẪN CÀI ĐẶT (xem thêm cuối file)
 */

// ============================================================
// 1. HẰNG SỐ CẤU HÌNH
// ============================================================

const SHEET_MENTEE = 'Mentee_large_packet';
const SHEET_MENTOR = 'Team mentor status';
const SHEET_APPS = 'Applications';
const SHEET_LOG = 'Progress_Log';
const SHEET_REMINDERS = 'Reminders';
const SHEET_CONFIG = 'Config';
const HEADER_ROW = 1;

// Link web cập nhật cho mentor (giai đoạn sau). Để trống thì không hiện trong email.
const UPDATE_LINK = '';

// Tên cột (tiêu đề hàng 1) của tab mentee
const MENTEE_COLS = {
  code: 'Code',
  mentor: 'Mentor',
  email: 'Email',
  name: 'Tên',
  plan: 'Chương trình',
  payment: 'Payment',
  status: 'Trạng thái hiện tại',
  holdUntil: 'Ngày hết hạn bảo lưu'
};

// Tên cột của tab mentor
const MENTOR_COLS = { name: 'Tên mentor', email: 'Email' };

// Tên cột của tab Applications
const APP_COLS = {
  id: 'ID',
  code: 'Code',
  name: 'Tên mentee',
  mentor: 'Mentor',
  school: 'Trường/Học bổng',
  type: 'Loại deadline',
  deadline: 'Ngày deadline',
  expected: 'Ngày chốt dự kiến',
  status: 'Trạng thái',
  source: 'Nguồn deadline',
  suggestion: 'Gợi ý deadline',
  updated: 'Cập nhật lúc'
};
const APP_HEADERS = [
  APP_COLS.id, APP_COLS.code, APP_COLS.name, APP_COLS.mentor, APP_COLS.school, APP_COLS.type,
  APP_COLS.deadline, APP_COLS.expected, APP_COLS.status, APP_COLS.source, APP_COLS.suggestion, APP_COLS.updated
];
const APP_TYPES = ['Nộp hồ sơ online', 'Xin feedback giữa khóa', 'Phỏng vấn', 'Giấy tờ', 'Khác'];
const APP_STATUSES = ['Chưa chốt', 'Đã chốt', 'Đã nộp', 'Có kết quả'];
const APP_DONE_STATUSES = ['đã nộp', 'có kết quả']; // đã chuẩn hóa chữ thường, không nhắc nữa

const LOG_HEADERS = ['Ngày', 'Code', 'Tên mentee', 'Loại', 'Nội dung', 'Link', 'Người ghi'];
const LOG_TYPES = ['Chương trình mentor', 'Kết quả hồ sơ', 'Bài viết', 'Giấy tờ', 'Feedback', 'Thanh toán', 'Chốt mentor'];

const REM_COLS = {
  id: 'Reminder ID',
  type: 'Loại',
  email: 'Email người nhận',
  code: 'Code',
  name: 'Tên mentee',
  school: 'Trường',
  date: 'Ngày liên quan',
  daysLeft: 'Còn lại (ngày)',
  status: 'Trạng thái',
  at: 'Thời điểm xử lý',
  note: 'Ghi chú'
};
const REM_HEADERS = [
  REM_COLS.id, REM_COLS.type, REM_COLS.email, REM_COLS.code, REM_COLS.name, REM_COLS.school,
  REM_COLS.date, REM_COLS.daysLeft, REM_COLS.status, REM_COLS.at, REM_COLS.note
];

const MENTEE_STATUS_LIST = ['Active', 'Bảo lưu', 'Hoàn thành', 'Cancel'];

const DEFAULT_CONFIG = {
  MANAGER_EMAIL: '',
  SENDER_NAME: 'SEM Scholars',
  REMINDER_DAYS_BEFORE: '7',
  SEND_HOUR: 8,
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  DRY_RUN: true,
  ADMIN_EMAILS: '',   // email admin/founder (cách nhau bằng dấu phẩy), dùng cho trang web mentor
  FRONTEND_URL: 'https://linhmonkaist.github.io/mentor_portal/'    // URL giao diện (ví dụ https://tên.github.io/mentor_portal/), dùng cho nút đăng nhập trong email
};

const TYPE_DEADLINE = 'Deadline';
const TYPE_EXPECTED = 'Ngày chốt dự kiến';
const EXPECTED_WINDOW_DAYS = 3; // nhắc chốt trường trong 0..3 ngày tới

// ============================================================
// 2. HÀM TIỆN ÍCH THUẦN (không phụ thuộc Google, dễ kiểm thử)
// ============================================================

/** Chuẩn hóa chuỗi để so sánh: NFC, bỏ khoảng trắng thừa, chữ thường, giữ dấu tiếng Việt. */
function norm_(s) {
  return String(s === null || s === undefined ? '' : s)
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Tách cột Mentor thành từng tên. Ngăn cách bằng &, dấu phẩy, /, ; hoặc chữ "và". */
function splitMentors_(s) {
  const text = String(s === null || s === undefined ? '' : s).normalize('NFC').trim();
  if (!text) return [];
  return text
    .split(/\s*(?:&|,|;|\/)\s*|\s+và\s+/i)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x.length > 0; });
}

/** Code hợp lệ có dạng "GKS-G26-12: Nguyễn Trúc". */
function isValidCode_(code) {
  return /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\s*:\s*\S/.test(String(code || '').trim());
}

/**
 * Trạng thái của một lượt đăng ký, theo thứ tự ưu tiên:
 * 1) "Trạng thái hiện tại": Cancel/Hủy, Bảo lưu, Hoàn thành, Active.
 * 2) Nếu trống thì suy từ Payment (thanh toán cho mentor): Done/Thưởng = Hoàn thành; còn lại (Đợt 1, trống, lạ) = Active.
 */
function getEnrollmentStatus_(statusCell, payment) {
  const s = norm_(statusCell);
  if (s === 'cancel' || s === 'hủy' || s === 'huỷ') return 'Hủy';
  if (s === 'bảo lưu') return 'Bảo lưu';
  if (s === 'hoàn thành') return 'Hoàn thành';
  if (s === 'active') return 'Active';
  const p = norm_(payment);
  if (p === 'done' || p === 'thưởng') return 'Hoàn thành';
  return 'Active';
}

/**
 * Chuyển giá trị ô ngày thành khóa 'yyyy-MM-dd'. Trả về null nếu không hiểu.
 * Date: định dạng theo múi giờ bảng tính. Chuỗi: nhận dd/MM/yyyy hoặc yyyy-MM-dd.
 */
function dayKey_(v, sheetTz) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return null;
    return Utilities.formatDate(v, sheetTz, 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return pad_(m[3], 4) + '-' + pad_(m[2], 2) + '-' + pad_(m[1], 2);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return pad_(m[1], 4) + '-' + pad_(m[2], 2) + '-' + pad_(m[3], 2);
  return null;
}

function pad_(n, len) {
  let s = String(n);
  while (s.length < len) s = '0' + s;
  return s;
}

/** Số ngày từ khóa a đến khóa b (b - a). Trả về NaN nếu khóa không hợp lệ. */
function dayDiff_(keyA, keyB) {
  const pa = String(keyA).split('-').map(Number);
  const pb = String(keyB).split('-').map(Number);
  if (pa.length !== 3 || pb.length !== 3) return NaN;
  const a = Date.UTC(pa[0], pa[1] - 1, pa[2]);
  const b = Date.UTC(pb[0], pb[1] - 1, pb[2]);
  if (isNaN(a) || isNaN(b)) return NaN;
  return Math.round((b - a) / 86400000);
}

/** yyyy-MM-dd -> dd/MM/yyyy */
function displayDate_(key) {
  const p = String(key).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(key);
}

function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseDays_(v) {
  return String(v === null || v === undefined ? '' : v)
    .split(',')
    .map(function (x) { return Number(String(x).trim()); })
    .filter(function (x) { return !isNaN(x) && String(x).length > 0 && x >= 0; });
}

function toBool_(v, def) {
  if (v === true || v === false) return v;
  const s = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  if (s === 'TRUE' || s === 'CÓ' || s === 'YES') return true;
  if (s === 'FALSE' || s === 'KHÔNG' || s === 'NO') return false;
  return def;
}

// ============================================================
// 3. LOGIC NHẮC NHỞ (thuần, nhận dữ liệu đã đọc sẵn)
// ============================================================

/**
 * ctx = {
 *   todayKey: 'yyyy-MM-dd',
 *   sheetTz: múi giờ bảng tính (để đọc ô Date),
 *   reminderDays: [7],
 *   mentees: [{code, name, email, mentors: [tên], status, row, validCode}],
 *   mentors: [{name, email}],
 *   apps: [{code, school, type, deadline, expected, status, row}],
 *   sentKeys: Set các khóa đã gửi
 * }
 * Trả về { reminders: [...], warnings: {...} }
 */
function buildReminders_(ctx) {
  const mentorByNorm = {};
  const dupMentors = [];
  ctx.mentors.forEach(function (m) {
    const k = norm_(m.name);
    if (!k) return;
    if (mentorByNorm[k]) { dupMentors.push(m.name); return; }
    mentorByNorm[k] = m;
  });

  const menteeByCode = {};
  ctx.mentees.forEach(function (m) {
    if (m.validCode) menteeByCode[norm_(m.code)] = m;
  });

  const warnings = {
    activeMissingCode: [],
    activeNoMentor: [],
    activeNoApplications: [],
    unmatchedMentors: [],
    mentorNoEmail: [],
    duplicateMentors: dupMentors,
    unknownAppCodes: []
  };

  const unmatchedSeen = {};
  const noEmailSeen = {};
  const appCodesSeen = {};
  const reminders = [];

  // Cảnh báo theo từng mentee Active
  ctx.mentees.forEach(function (m) {
    if (m.status !== 'Active') return;
    if (!m.validCode) {
      warnings.activeMissingCode.push({ row: m.row, name: m.name });
      return;
    }
    if (!m.mentors.length) {
      warnings.activeNoMentor.push({ code: m.code, name: m.name });
      return;
    }
    m.mentors.forEach(function (mn) {
      const found = mentorByNorm[norm_(mn)];
      if (!found) {
        const k = norm_(mn);
        if (!unmatchedSeen[k]) { unmatchedSeen[k] = true; warnings.unmatchedMentors.push(mn); }
      } else if (!String(found.email || '').trim()) {
        const k2 = norm_(found.name);
        if (!noEmailSeen[k2]) { noEmailSeen[k2] = true; warnings.mentorNoEmail.push(found.name); }
      }
    });
  });

  ctx.apps.forEach(function (a) {
    const codeKey = norm_(a.code);
    if (!codeKey && !String(a.school || '').trim()) return; // dòng trống
    if (codeKey) appCodesSeen[codeKey] = true;
    const mentee = menteeByCode[codeKey];
    if (!mentee) {
      if (codeKey) warnings.unknownAppCodes.push(a.code);
      return;
    }
    if (mentee.status !== 'Active') return;
    if (APP_DONE_STATUSES.indexOf(norm_(a.status)) >= 0) return;

    const dlKey = dayKey_(a.deadline, ctx.sheetTz);
    const exKey = dayKey_(a.expected, ctx.sheetTz);
    const candidates = [];

    if (dlKey) {
      const d = dayDiff_(ctx.todayKey, dlKey);
      if (!isNaN(d) && ctx.reminderDays.indexOf(d) >= 0) {
        candidates.push({ type: TYPE_DEADLINE, dateKey: dlKey, daysLeft: d });
      }
    }
    if (exKey && norm_(a.status) !== 'đã chốt') {
      const e = dayDiff_(ctx.todayKey, exKey);
      if (!isNaN(e) && e >= 0 && e <= EXPECTED_WINDOW_DAYS) {
        candidates.push({ type: TYPE_EXPECTED, dateKey: exKey, daysLeft: e });
      }
    }
    if (!candidates.length) return;

    // Người nhận: mỗi mentor của mentee này
    mentee.mentors.forEach(function (mn) {
      const mentor = mentorByNorm[norm_(mn)];
      if (!mentor || !String(mentor.email || '').trim()) return; // đã có cảnh báo ở trên
      candidates.forEach(function (c) {
        const key = [c.type, mentee.code, a.school, c.dateKey, c.daysLeft, mentor.email.trim().toLowerCase()].join('|');
        if (ctx.sentKeys && ctx.sentKeys.has(key)) return;
        reminders.push({
          key: key,
          type: c.type,
          code: mentee.code,
          menteeName: mentee.name || mentee.code,
          school: a.school || '',
          loai: a.type || '',
          dateKey: c.dateKey,
          daysLeft: c.daysLeft,
          mentorName: mentor.name,
          recipient: mentor.email.trim()
        });
      });
    });
  });

  // Mentee Active (mã hợp lệ, có mentor) chưa có dòng nào trong Applications
  ctx.mentees.forEach(function (m) {
    if (m.status !== 'Active' || !m.validCode || !m.mentors.length) return;
    if (!appCodesSeen[norm_(m.code)]) warnings.activeNoApplications.push({ code: m.code, name: m.name });
  });

  reminders.sort(function (x, y) { return x.dateKey < y.dateKey ? -1 : x.dateKey > y.dateKey ? 1 : 0; });
  return { reminders: reminders, warnings: warnings };
}

/** Gộp nhắc nhở theo email người nhận. */
function groupByRecipient_(reminders) {
  const map = {};
  const order = [];
  reminders.forEach(function (r) {
    const k = r.recipient.toLowerCase();
    if (!map[k]) { map[k] = { recipient: r.recipient, mentorName: r.mentorName, items: [] }; order.push(k); }
    map[k].items.push(r);
  });
  return order.map(function (k) { return map[k]; });
}

function daysLeftText_(item) {
  if (item.type === TYPE_EXPECTED) {
    return item.daysLeft === 0 ? 'Cần chốt hôm nay' : 'Cần chốt trong ' + item.daysLeft + ' ngày';
  }
  return item.daysLeft === 0 ? 'Hôm nay' : item.daysLeft + ' ngày';
}

function typeText_(item) {
  return item.type === TYPE_EXPECTED ? 'Chốt danh sách trường' : (item.loai || 'Deadline');
}

/** Nội dung email cho một mentor. */
function buildMentorEmail_(group) {
  const rows = group.items.map(function (it) {
    return '<tr>' +
      '<td>' + esc_(it.menteeName) + '</td>' +
      '<td>' + esc_(it.school) + '</td>' +
      '<td>' + esc_(typeText_(it)) + '</td>' +
      '<td>' + esc_(displayDate_(it.dateKey)) + '</td>' +
      '<td>' + esc_(daysLeftText_(it)) + '</td>' +
      '</tr>';
  }).join('');
  const link = UPDATE_LINK
    ? '<p>Cập nhật thông tin tại: <a href="' + esc_(UPDATE_LINK) + '">' + esc_(UPDATE_LINK) + '</a></p>'
    : '';
  const html =
    '<p>Chào ' + esc_(group.mentorName) + ',</p>' +
    '<p>Dưới đây là các mốc sắp tới của mentee bạn đang hướng dẫn:</p>' +
    '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;border-color:#ccc">' +
    '<tr style="background:#f3f3f3"><th>Mentee</th><th>Trường/Học bổng</th><th>Loại</th><th>Ngày</th><th>Còn lại</th></tr>' +
    rows +
    '</table>' +
    '<p>Nếu thông tin chưa đúng hoặc cần cập nhật, bạn vui lòng phản hồi email này.</p>' +
    link +
    '<p>SEM Scholars</p>';
  return { subject: '[SEM Scholars] Nhắc deadline cho mentee của bạn', html: html };
}

function limitList_(arr, n) {
  if (arr.length <= n) return arr;
  return arr.slice(0, n).concat(['… và ' + (arr.length - n) + ' mục nữa']);
}

/** Có cảnh báo quan trọng cần báo ngay cho quản lý không (không tính danh sách "chưa có deadline"). */
function hasCriticalWarnings_(w) {
  return w.activeMissingCode.length > 0 || w.activeNoMentor.length > 0 || w.unmatchedMentors.length > 0 ||
    w.mentorNoEmail.length > 0 || w.duplicateMentors.length > 0 || w.unknownAppCodes.length > 0;
}

/**
 * Bản tổng hợp cho quản lý. outcomes: [{recipient, mentorName, status, note, count}]
 * Trả về { subject, html, text }.
 */
function buildManagerSummary_(todayKey, outcomes, warnings, dryRun) {
  const html = [];
  const text = [];
  const title = 'Tổng hợp nhắc nhở ngày ' + displayDate_(todayKey) + (dryRun ? ' (CHẠY THỬ, chưa gửi thật)' : '');
  html.push('<h3>' + esc_(title) + '</h3>');
  text.push(title);

  function section(head, lines) {
    if (!lines.length) return;
    html.push('<p><b>' + esc_(head) + '</b></p><ul>' + lines.map(function (l) { return '<li>' + esc_(l) + '</li>'; }).join('') + '</ul>');
    text.push('', head);
    lines.forEach(function (l) { text.push('- ' + l); });
  }

  section('Nhắc nhở', outcomes.map(function (o) {
    return o.mentorName + ' <' + o.recipient + '>: ' + o.count + ' mục, ' + o.status + (o.note ? ' (' + o.note + ')' : '');
  }));
  if (!outcomes.length) { html.push('<p>Hôm nay không có nhắc nhở nào.</p>'); text.push('', 'Hôm nay không có nhắc nhở nào.'); }

  const w = warnings;
  section('Dòng Active thiếu Code (cần bổ sung)', limitList_(w.activeMissingCode.map(function (x) { return 'Hàng ' + x.row + ': ' + (x.name || '(không tên)'); }), 30));
  section('Dòng Active chưa có mentor', limitList_(w.activeNoMentor.map(function (x) { return x.code + ' ' + (x.name || ''); }), 30));
  section('Tên mentor không khớp tab mentor', limitList_(w.unmatchedMentors, 30));
  section('Mentor chưa có email', limitList_(w.mentorNoEmail, 30));
  section('Tên mentor bị trùng trong tab mentor', limitList_(w.duplicateMentors, 30));
  section('Code trong Applications không có trong tab mentee', limitList_(w.unknownAppCodes, 30));
  section('Mentee Active chưa có dòng nào trong Applications (' + w.activeNoApplications.length + ')',
    limitList_(w.activeNoApplications.map(function (x) { return x.code; }), 30));

  return { subject: '[SEM Scholars] ' + title, html: html.join(''), text: text.join('\n') };
}

// ============================================================
// 4. ĐỌC DỮ LIỆU TỪ SHEET
// ============================================================

function headerMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  const map = {};
  if (lastCol < 1) return map;
  const vals = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
  vals.forEach(function (h, i) {
    const key = String(h || '').trim();
    if (key && map[key] === undefined) map[key] = i; // chỉ lấy lần xuất hiện đầu
  });
  return map;
}

function mustSheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Không tìm thấy tab "' + name + '". Hãy kiểm tra tên tab hoặc chạy setup().');
  return sh;
}

/**
 * Đọc chỉ các cột cần thiết (không đọc cột nhạy cảm).
 * required: tên cột bắt buộc, optional: tên cột có thì đọc.
 * Trả về { n, cols: {tên: mảng giá trị} }
 */
function readColumns_(sheet, required, optional) {
  const map = headerMap_(sheet);
  const missing = required.filter(function (c) { return map[c] === undefined; });
  if (missing.length) {
    throw new Error('Tab "' + sheet.getName() + '" thiếu cột: ' + missing.join(', '));
  }
  const n = Math.max(0, sheet.getLastRow() - HEADER_ROW);
  const cols = {};
  required.concat(optional || []).forEach(function (c) {
    if (map[c] === undefined) { cols[c] = new Array(n).fill(''); return; }
    cols[c] = n > 0
      ? sheet.getRange(HEADER_ROW + 1, map[c] + 1, n, 1).getValues().map(function (r) { return r[0]; })
      : [];
  });
  return { n: n, cols: cols };
}

function getConfig_() {
  const cfg = {};
  Object.keys(DEFAULT_CONFIG).forEach(function (k) { cfg[k] = DEFAULT_CONFIG[k]; });
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CONFIG);
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      const k = String(r[0] || '').trim();
      if (k && DEFAULT_CONFIG.hasOwnProperty(k) && r[1] !== '') cfg[k] = r[1];
    });
  }
  cfg.DRY_RUN = toBool_(cfg.DRY_RUN, true);
  cfg.SEND_HOUR = Math.min(23, Math.max(0, Number(cfg.SEND_HOUR) || 8));
  cfg.REMINDER_DAYS = parseDays_(cfg.REMINDER_DAYS_BEFORE);
  if (!cfg.REMINDER_DAYS.length) cfg.REMINDER_DAYS = [7];
  cfg.TIMEZONE = String(cfg.TIMEZONE || DEFAULT_CONFIG.TIMEZONE).trim();
  cfg.MANAGER_EMAIL = String(cfg.MANAGER_EMAIL || '').trim();
  cfg.SENDER_NAME = String(cfg.SENDER_NAME || DEFAULT_CONFIG.SENDER_NAME).trim();
  cfg.ADMIN_LIST = parseEmailList_(cfg.ADMIN_EMAILS);
  cfg.FRONTEND_URL = String(cfg.FRONTEND_URL || '').trim();
  return cfg;
}

function loadContext_(cfg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetTz = ss.getSpreadsheetTimeZone();
  const todayKey = Utilities.formatDate(new Date(), cfg.TIMEZONE, 'yyyy-MM-dd');

  // Tab mentee: chỉ đọc các cột cần thiết
  const menteeData = readColumns_(mustSheet_(SHEET_MENTEE),
    [MENTEE_COLS.code, MENTEE_COLS.mentor, MENTEE_COLS.name, MENTEE_COLS.payment],
    [MENTEE_COLS.status]);
  const mentees = [];
  for (let i = 0; i < menteeData.n; i++) {
    const code = String(menteeData.cols[MENTEE_COLS.code][i] || '').trim();
    const name = String(menteeData.cols[MENTEE_COLS.name][i] || '').trim();
    if (!code && !name) continue; // dòng trống
    mentees.push({
      code: code,
      name: name,
      mentors: splitMentors_(menteeData.cols[MENTEE_COLS.mentor][i]),
      status: getEnrollmentStatus_(menteeData.cols[MENTEE_COLS.status][i], menteeData.cols[MENTEE_COLS.payment][i]),
      row: HEADER_ROW + 1 + i,
      validCode: isValidCode_(code)
    });
  }

  // Tab mentor: chỉ Tên mentor và Email
  const mentorData = readColumns_(mustSheet_(SHEET_MENTOR), [MENTOR_COLS.name, MENTOR_COLS.email]);
  const mentors = [];
  for (let j = 0; j < mentorData.n; j++) {
    const mn = String(mentorData.cols[MENTOR_COLS.name][j] || '').trim();
    if (!mn) continue;
    mentors.push({ name: mn, email: String(mentorData.cols[MENTOR_COLS.email][j] || '').trim() });
  }

  // Tab Applications
  const appData = readColumns_(mustSheet_(SHEET_APPS),
    [APP_COLS.code, APP_COLS.school, APP_COLS.deadline, APP_COLS.expected, APP_COLS.status],
    [APP_COLS.type]);
  const apps = [];
  for (let k = 0; k < appData.n; k++) {
    apps.push({
      code: String(appData.cols[APP_COLS.code][k] || '').trim(),
      school: String(appData.cols[APP_COLS.school][k] || '').trim(),
      type: String(appData.cols[APP_COLS.type][k] || '').trim(),
      deadline: appData.cols[APP_COLS.deadline][k],
      expected: appData.cols[APP_COLS.expected][k],
      status: String(appData.cols[APP_COLS.status][k] || '').trim(),
      row: HEADER_ROW + 1 + k
    });
  }

  return {
    todayKey: todayKey,
    sheetTz: sheetTz,
    reminderDays: cfg.REMINDER_DAYS,
    mentees: mentees,
    mentors: mentors,
    apps: apps,
    sentKeys: loadSentKeys_()
  };
}

/** Các khóa đã gửi thật (trạng thái "Đã gửi") trong tab Reminders. */
function loadSentKeys_() {
  const set = new Set();
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_REMINDERS);
  if (!sh) return set;
  const map = headerMap_(sh);
  if (map[REM_COLS.id] === undefined || map[REM_COLS.status] === undefined) return set;
  const n = sh.getLastRow() - HEADER_ROW;
  if (n <= 0) return set;
  const ids = sh.getRange(HEADER_ROW + 1, map[REM_COLS.id] + 1, n, 1).getValues();
  const sts = sh.getRange(HEADER_ROW + 1, map[REM_COLS.status] + 1, n, 1).getValues();
  for (let i = 0; i < n; i++) {
    if (String(sts[i][0]).trim() === 'Đã gửi') set.add(String(ids[i][0]));
  }
  return set;
}

// ============================================================
// 5. HÀM CHÍNH: XEM TRƯỚC, GỬI, TRIGGER
// ============================================================

function ui_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log(message); // chạy từ trigger thì không có giao diện
  }
}

/** Xem trước nhắc nhở: không gửi, không ghi tab Reminders. */
function previewReminders() {
  const cfg = getConfig_();
  const ctx = loadContext_(cfg);
  const res = buildReminders_(ctx);
  const groups = groupByRecipient_(res.reminders);
  const outcomes = groups.map(function (g) {
    return { recipient: g.recipient, mentorName: g.mentorName, status: 'sẽ gửi', note: '', count: g.items.length };
  });
  const summary = buildManagerSummary_(ctx.todayKey, outcomes, res.warnings, true);
  Logger.log(summary.text);
  const msg = 'XEM TRƯỚC (chưa gửi gì)\n\n' + summary.text;
  ui_(msg.length > 1800 ? msg.slice(0, 1800) + '\n…(xem đầy đủ trong Nhật ký thực thi: Ctrl+Enter)' : msg);
}

/** Gửi nhắc nhở hằng ngày. Nếu DRY_RUN = TRUE thì chỉ ghi nhận vào tab Reminders, không gửi. */
function sendDailyReminders() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log('Đang có một lần chạy khác, bỏ qua lần này.');
    return;
  }
  try {
    const cfg = getConfig_();
    const ctx = loadContext_(cfg);
    const res = buildReminders_(ctx);
    const groups = groupByRecipient_(res.reminders);
    const nowStr = Utilities.formatDate(new Date(), cfg.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    const logRows = [];
    const outcomes = [];
    let quota = cfg.DRY_RUN ? Infinity : MailApp.getRemainingDailyQuota();
    if (!cfg.DRY_RUN && cfg.MANAGER_EMAIL) quota = quota - 1; // chừa 1 email cho bản tổng hợp

    groups.forEach(function (g) {
      let status;
      let note = '';
      if (cfg.DRY_RUN) {
        status = 'Dry-run';
      } else if (quota < 1) {
        status = 'Bỏ qua';
        note = 'Hết hạn mức gửi email trong ngày';
      } else {
        try {
          const mail = buildMentorEmail_(g);
          const opts = { to: g.recipient, subject: mail.subject, htmlBody: mail.html, name: cfg.SENDER_NAME };
          if (cfg.MANAGER_EMAIL) opts.replyTo = cfg.MANAGER_EMAIL;
          MailApp.sendEmail(opts);
          quota--;
          status = 'Đã gửi';
        } catch (err) {
          status = 'Lỗi';
          note = String(err && err.message ? err.message : err);
        }
      }
      outcomes.push({ recipient: g.recipient, mentorName: g.mentorName, status: status, note: note, count: g.items.length });
      g.items.forEach(function (it) {
        logRows.push([it.key, it.type, g.recipient, it.code, it.menteeName, it.school,
          displayDate_(it.dateKey), it.daysLeft, status, nowStr, note]);
      });
    });

    // Tổng hợp cho quản lý
    const summary = buildManagerSummary_(ctx.todayKey, outcomes, res.warnings, cfg.DRY_RUN);
    const worthSending = outcomes.length > 0 || hasCriticalWarnings_(res.warnings);
    if (cfg.DRY_RUN) {
      Logger.log(summary.text);
    } else if (worthSending) {
      if (!cfg.MANAGER_EMAIL) {
        Logger.log('Chưa điền MANAGER_EMAIL trong Config nên không gửi bản tổng hợp.\n' + summary.text);
      } else if (MailApp.getRemainingDailyQuota() < 1) {
        Logger.log('Hết hạn mức gửi email nên không gửi được bản tổng hợp.\n' + summary.text);
      } else {
        try {
          MailApp.sendEmail({ to: cfg.MANAGER_EMAIL, subject: summary.subject, htmlBody: summary.html, name: cfg.SENDER_NAME });
        } catch (err2) {
          Logger.log('Không gửi được bản tổng hợp cho quản lý: ' + err2);
        }
      }
    }

    if (logRows.length) appendRows_(mustSheet_(SHEET_REMINDERS), logRows);
  } finally {
    lock.releaseLock();
  }
}

function appendRows_(sheet, rows) {
  if (!rows.length) return;
  const start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
}

/** Cài lịch gửi hằng ngày vào SEND_HOUR (theo TIMEZONE trong Config). */
function installTrigger() {
  const cfg = getConfig_();
  removeTriggers_();
  ScriptApp.newTrigger('sendDailyReminders')
    .timeBased()
    .everyDays(1)
    .atHour(cfg.SEND_HOUR)
    .inTimezone(cfg.TIMEZONE)
    .create();
  ui_('Đã cài lịch gửi mỗi ngày vào khoảng ' + cfg.SEND_HOUR + 'h (' + cfg.TIMEZONE + ').\n' +
    (cfg.DRY_RUN ? 'DRY_RUN đang BẬT nên chỉ ghi nhận, chưa gửi email thật.' : 'DRY_RUN đang TẮT: email sẽ được gửi thật.'));
}

function removeTriggers() {
  const n = removeTriggers_();
  ui_('Đã xóa ' + n + ' lịch gửi.');
}

function removeTriggers_() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyReminders') { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

// ============================================================
// 6. THIẾT LẬP BAN ĐẦU, MENU, onEdit
// ============================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SEM Scholars')
    .addItem('Thiết lập (chạy lần đầu)', 'setup')
    .addSeparator()
    .addItem('Xem trước nhắc nhở', 'previewReminders')
    .addItem('Gửi nhắc nhở ngay', 'sendDailyReminders')
    .addSeparator()
    .addItem('Cài lịch gửi hằng ngày', 'installTrigger')
    .addItem('Xóa lịch gửi', 'removeTriggers')
    .addSeparator()
    .addItem('Đăng xuất mọi thiết bị (cổng mentor)', 'revokeAllSessions')
    .addToUi();
}

function columnLetter_(index0) {
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function ensureSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** Thêm các tiêu đề còn thiếu vào cuối hàng tiêu đề, không đụng dữ liệu có sẵn. Trả về danh sách đã thêm. */
function addMissingHeaders_(sheet, headers) {
  const map = headerMap_(sheet);
  const added = [];
  let col = sheet.getLastColumn();
  headers.forEach(function (h) {
    if (map[h] === undefined) {
      col++;
      sheet.getRange(HEADER_ROW, col).setValue(h);
      added.push(h);
    }
  });
  return added;
}

function styleHeader_(sheet, numCols) {
  const r = sheet.getRange(HEADER_ROW, 1, 1, numCols);
  r.setFontWeight('bold').setBackground('#f3f3f3');
  sheet.setFrozenRows(HEADER_ROW);
}

function ensureRows_(sheet, minRows) {
  const have = sheet.getMaxRows();
  if (have < minRows) sheet.insertRowsAfter(have, minRows - have);
}

function listValidation_(values) {
  return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build();
}

function dateValidation_() {
  return SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(true).build();
}

/** Tạo các tab còn thiếu, tiêu đề, danh sách chọn. Chạy nhiều lần không làm mất dữ liệu. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = [];

  // 1) Tab mentee và mentor phải có sẵn
  const mentee = ss.getSheetByName(SHEET_MENTEE);
  const mentor = ss.getSheetByName(SHEET_MENTOR);
  if (!mentee) throw new Error('Không tìm thấy tab "' + SHEET_MENTEE + '".');
  if (!mentor) throw new Error('Không tìm thấy tab "' + SHEET_MENTOR + '".');

  const menteeMap = headerMap_(mentee);
  const missingMentee = [MENTEE_COLS.code, MENTEE_COLS.mentor, MENTEE_COLS.name, MENTEE_COLS.payment]
    .filter(function (c) { return menteeMap[c] === undefined; });
  if (missingMentee.length) throw new Error('Tab "' + SHEET_MENTEE + '" thiếu cột bắt buộc: ' + missingMentee.join(', '));
  const mentorMap = headerMap_(mentor);
  const missingMentor = [MENTOR_COLS.name, MENTOR_COLS.email].filter(function (c) { return mentorMap[c] === undefined; });
  if (missingMentor.length) throw new Error('Tab "' + SHEET_MENTOR + '" thiếu cột bắt buộc: ' + missingMentor.join(', '));

  // 2) Thêm cột mới ở tab mentee (chỉ thêm tiêu đề)
  const addedMentee = addMissingHeaders_(mentee, [MENTEE_COLS.status, MENTEE_COLS.holdUntil]);
  if (addedMentee.length) report.push('Tab mentee: đã thêm cột ' + addedMentee.join(', '));
  const namedView = nameViewColumns_(mentee);
  if (namedView.length) report.push('Tab mentee: đã đặt tiêu đề ' + namedView.join(', '));
  const menteeMap2 = headerMap_(mentee);
  // Danh sách chọn cho "Trạng thái hiện tại" (cho phép giá trị khác để không chặn dữ liệu cũ)
  const statusCol = menteeMap2[MENTEE_COLS.status] + 1;
  mentee.getRange(HEADER_ROW + 1, statusCol, Math.max(1, mentee.getMaxRows() - HEADER_ROW), 1)
    .setDataValidation(listValidation_(MENTEE_STATUS_LIST));
  const holdCol = menteeMap2[MENTEE_COLS.holdUntil] + 1;
  mentee.getRange(HEADER_ROW + 1, holdCol, Math.max(1, mentee.getMaxRows() - HEADER_ROW), 1)
    .setDataValidation(dateValidation_()).setNumberFormat('dd/MM/yyyy');

  // 3) Applications
  const apps = ensureSheet_(ss, SHEET_APPS);
  ensureRows_(apps, 1000);
  const addedApps = addMissingHeaders_(apps, APP_HEADERS);
  if (addedApps.length) report.push('Applications: đã thêm cột ' + addedApps.join(', '));
  styleHeader_(apps, apps.getLastColumn());
  const am = headerMap_(apps);
  const rowsApps = apps.getMaxRows() - HEADER_ROW;
  // Code: danh sách lấy từ cột Code của tab mentee (cho phép giá trị khác, chỉ cảnh báo khi chạy)
  const codeRange = mentee.getRange(HEADER_ROW + 1, menteeMap2[MENTEE_COLS.code] + 1, Math.max(1, mentee.getMaxRows() - HEADER_ROW), 1);
  apps.getRange(HEADER_ROW + 1, am[APP_COLS.code] + 1, rowsApps, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(codeRange, true).setAllowInvalid(true).build());
  apps.getRange(HEADER_ROW + 1, am[APP_COLS.type] + 1, rowsApps, 1).setDataValidation(listValidation_(APP_TYPES));
  apps.getRange(HEADER_ROW + 1, am[APP_COLS.status] + 1, rowsApps, 1).setDataValidation(listValidation_(APP_STATUSES));
  [APP_COLS.deadline, APP_COLS.expected].forEach(function (c) {
    apps.getRange(HEADER_ROW + 1, am[c] + 1, rowsApps, 1).setDataValidation(dateValidation_()).setNumberFormat('dd/MM/yyyy');
  });
  apps.getRange(HEADER_ROW + 1, am[APP_COLS.updated] + 1, rowsApps, 1).setNumberFormat('dd/MM/yyyy HH:mm');
  // Công thức tự tra Tên mentee và Mentor từ Code (chỉ đặt nếu ô đầu còn trống)
  const q = "'" + SHEET_MENTEE.replace(/'/g, "''") + "'!";
  const cl = columnLetter_(menteeMap2[MENTEE_COLS.code]);
  const nl = columnLetter_(menteeMap2[MENTEE_COLS.name]);
  const ml = columnLetter_(menteeMap2[MENTEE_COLS.mentor]);
  const codeLetterApps = columnLetter_(am[APP_COLS.code]);
  const lookup = function (retLetter) {
    return '=ARRAYFORMULA(IF(' + codeLetterApps + '2:' + codeLetterApps + '="","",IFERROR(VLOOKUP(' +
      codeLetterApps + '2:' + codeLetterApps + ',{' + q + '$' + cl + '$2:$' + cl + ',' + q + '$' + retLetter + '$2:$' + retLetter + '},2,FALSE),"")))';
  };
  const nameCell = apps.getRange(HEADER_ROW + 1, am[APP_COLS.name] + 1);
  if (nameCell.isBlank()) nameCell.setFormula(lookup(nl));
  const mentorCell = apps.getRange(HEADER_ROW + 1, am[APP_COLS.mentor] + 1);
  if (mentorCell.isBlank()) mentorCell.setFormula(lookup(ml));

  // 4) Progress_Log
  const log = ensureSheet_(ss, SHEET_LOG);
  ensureRows_(log, 1000);
  const addedLog = addMissingHeaders_(log, LOG_HEADERS);
  if (addedLog.length) report.push('Progress_Log: đã thêm cột ' + addedLog.join(', '));
  styleHeader_(log, log.getLastColumn());
  const lm = headerMap_(log);
  log.getRange(HEADER_ROW + 1, lm['Loại'] + 1, log.getMaxRows() - HEADER_ROW, 1).setDataValidation(listValidation_(LOG_TYPES));
  log.getRange(HEADER_ROW + 1, lm['Ngày'] + 1, log.getMaxRows() - HEADER_ROW, 1).setNumberFormat('dd/MM/yyyy');

  // 5) Reminders
  const rem = ensureSheet_(ss, SHEET_REMINDERS);
  const addedRem = addMissingHeaders_(rem, REM_HEADERS);
  if (addedRem.length) report.push('Reminders: đã thêm cột ' + addedRem.join(', '));
  styleHeader_(rem, rem.getLastColumn());

  // 6) Config
  const cfgSheet = ensureSheet_(ss, SHEET_CONFIG);
  if (String(cfgSheet.getRange(1, 1).getValue() || '').trim() === '') {
    cfgSheet.getRange(1, 1, 1, 2).setValues([['Khóa', 'Giá trị']]).setFontWeight('bold').setBackground('#f3f3f3');
    cfgSheet.setFrozenRows(1);
  }
  const existing = {};
  if (cfgSheet.getLastRow() >= 2) {
    cfgSheet.getRange(2, 1, cfgSheet.getLastRow() - 1, 1).getValues().forEach(function (r) { existing[String(r[0]).trim()] = true; });
  }
  const toAdd = [];
  Object.keys(DEFAULT_CONFIG).forEach(function (k) {
    if (!existing[k]) toAdd.push([k, DEFAULT_CONFIG[k]]);
  });
  if (toAdd.length) {
    cfgSheet.getRange(cfgSheet.getLastRow() + 1, 1, toAdd.length, 2).setValues(toAdd);
    report.push('Config: đã thêm ' + toAdd.map(function (x) { return x[0]; }).join(', '));
  }
  cfgSheet.setColumnWidth(1, 220);
  cfgSheet.setColumnWidth(2, 260);

  report.push('Xong. Hãy điền MANAGER_EMAIL trong tab Config, rồi dùng "Xem trước nhắc nhở".');
  report.push('Lưu ý: nếu thêm nhiều mentee mới vào tab mentee, chạy lại setup() để danh sách Code trong Applications cập nhật.');
  ui_(report.join('\n'));
}

/**
 * Trigger đơn giản: khi sửa tab Applications, tự điền ID và "Cập nhật lúc".
 * Chạy tự động khi người dùng sửa ô, không cần cài đặt.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== SHEET_APPS) return;
    const row = e.range.getRow();
    if (row <= HEADER_ROW) return;
    const map = headerMap_(sh);
    if (map[APP_COLS.id] === undefined || map[APP_COLS.updated] === undefined) return;
    const idCol = map[APP_COLS.id] + 1;
    const updCol = map[APP_COLS.updated] + 1;
    const editedCol = e.range.getColumn();
    if (editedCol === updCol || editedCol === idCol) return;
    const idCell = sh.getRange(row, idCol);
    if (idCell.isBlank()) idCell.setValue('APP-' + Utilities.getUuid().slice(0, 8));
    sh.getRange(row, updCol).setValue(new Date());
  } catch (err) {
    Logger.log('onEdit: ' + err);
  }
}

// ============================================================
// 7. KIỂM THỬ TRONG BỘ NHỚ (không ghi vào sheet)
// ============================================================

/** Chạy các trường hợp kiểm thử và ghi kết quả vào Nhật ký thực thi (Logger). */
function testWithSampleData() {
  const results = [];
  function check(name, cond) { results.push((cond ? 'ĐẠT  ' : 'LỖI  ') + name); }

  const sheetTz = 'Asia/Ho_Chi_Minh';
  const todayKey = '2026-11-24';
  function plus(n) {
    const p = todayKey.split('-').map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return pad_(d.getUTCFullYear(), 4) + '-' + pad_(d.getUTCMonth() + 1, 2) + '-' + pad_(d.getUTCDate(), 2);
  }
  const mentors = [
    { name: 'Linh Mon', email: 'mon@example.com' },
    { name: 'Hoàng Liên', email: 'lien@example.com' },
    { name: 'Ngọc Mai', email: 'ngocmai@example.com' },
    { name: 'Diệu Mai', email: 'dieumai@example.com' },
    { name: 'Chị Cúc', email: 'cuc@example.com' },
    { name: 'Không Email', email: '' }
  ];
  function mentee(code, mentorCell, status, payment) {
    return {
      code: code, name: 'Mentee ' + code, mentors: splitMentors_(mentorCell),
      status: getEnrollmentStatus_(status, payment), row: 2, validCode: isValidCode_(code)
    };
  }
  function app(code, school, deadlineKey, expectedKey, status) {
    return { code: code, school: school, type: 'Nộp hồ sơ online', deadline: deadlineKey, expected: expectedKey, status: status || '', row: 2 };
  }
  function run(mentees, apps, sent) {
    return buildReminders_({
      todayKey: todayKey, sheetTz: sheetTz, reminderDays: [7], mentees: mentees, mentors: mentors,
      apps: apps, sentKeys: sent || new Set()
    });
  }

  // 1. Active, deadline đúng 7 ngày -> có nhắc
  let r = run([mentee('GKS-1: A', 'Linh Mon', '', 'Đợt 1')], [app('GKS-1: A', 'KAIST', plus(7), '', '')]);
  check('1. Active, còn đúng 7 ngày -> có nhắc', r.reminders.length === 1 && r.reminders[0].recipient === 'mon@example.com');
  // 2. Còn 3 ngày -> không nhắc
  r = run([mentee('GKS-1: A', 'Linh Mon', '', 'Đợt 1')], [app('GKS-1: A', 'KAIST', plus(3), '', '')]);
  check('2. Còn 3 ngày (chỉ cấu hình 7) -> không nhắc', r.reminders.length === 0);
  // 3. Hoàn thành -> không nhắc
  r = run([mentee('GKS-1: A', 'Linh Mon', '', 'Done'), mentee('GKS-2: B', 'Linh Mon', '', 'Thưởng')],
    [app('GKS-1: A', 'KAIST', plus(7), ''), app('GKS-2: B', 'KAIST', plus(7), '')]);
  check('3. Hoàn thành (Done/Thưởng) -> không nhắc', r.reminders.length === 0);
  // 4. Payment trống + trạng thái trống -> Active
  check('4. Payment trống, trạng thái trống -> Active', getEnrollmentStatus_('', '') === 'Active');
  // 5. Cancel ưu tiên hơn Payment
  check('5. Cancel dù Payment = Đợt 1 -> Hủy', getEnrollmentStatus_('Cancel', 'Đợt 1') === 'Hủy');
  r = run([mentee('GKS-1: A', 'Linh Mon', 'Cancel', 'Đợt 1')], [app('GKS-1: A', 'KAIST', plus(7), '')]);
  check('5b. Hủy gói không nhận nhắc', r.reminders.length === 0);
  // 6. Cùng email khác Code: xử lý riêng
  r = run([mentee('GKS-1: A', 'Linh Mon', '', 'Done'), mentee('General-2: A', 'Linh Mon', '', 'Đợt 1')],
    [app('GKS-1: A', 'KAIST', plus(7), ''), app('General-2: A', 'SNU', plus(7), '')]);
  check('6. Hai Code khác nhau, chỉ dòng Active được nhắc', r.reminders.length === 1 && r.reminders[0].code === 'General-2: A');
  // 7. Hai mentor
  r = run([mentee('GKS-3: C', 'Linh Mon & Hoàng Liên', '', 'Đợt 1')], [app('GKS-3: C', 'KAIST', plus(7), '')]);
  const g = groupByRecipient_(r.reminders);
  check('7. Mentor "Linh Mon & Hoàng Liên" -> cả hai nhận', g.length === 2);
  // 8. Mai không khớp Diệu Mai
  r = run([mentee('GKS-4: D', 'Mai', '', 'Đợt 1')], [app('GKS-4: D', 'KAIST', plus(7), '')]);
  check('8. "Mai" không khớp "Ngọc Mai"/"Diệu Mai"', r.reminders.length === 0 && r.warnings.unmatchedMentors.indexOf('Mai') >= 0);
  // 9. Không gửi trùng
  const first = run([mentee('GKS-1: A', 'Linh Mon', '', 'Đợt 1')], [app('GKS-1: A', 'KAIST', plus(7), '')]);
  const sent = new Set(first.reminders.map(function (x) { return x.key; }));
  r = run([mentee('GKS-1: A', 'Linh Mon', '', 'Đợt 1')], [app('GKS-1: A', 'KAIST', plus(7), '')], sent);
  check('9. Chạy lần hai cùng ngày -> không gửi trùng', r.reminders.length === 0);
  // 10. Mentor không có trong tab / không email
  r = run([mentee('GKS-5: E', 'Ai Đó', '', 'Đợt 1'), mentee('GKS-6: F', 'Không Email', '', 'Đợt 1')],
    [app('GKS-5: E', 'KAIST', plus(7), ''), app('GKS-6: F', 'KAIST', plus(7), '')]);
  check('10. Mentor lạ / không email -> cảnh báo, không dừng',
    r.reminders.length === 0 && r.warnings.unmatchedMentors.length === 1 && r.warnings.mentorNoEmail.length === 1);
  // 11. Deadline trống
  r = run([mentee('GKS-1: A', 'Linh Mon', '', 'Đợt 1')], [app('GKS-1: A', 'KAIST', '', '')]);
  check('11. Ngày deadline trống -> bỏ qua, không lỗi', r.reminders.length === 0);
  // 12. Thiếu Code
  r = run([mentee('Nguyễn Văn A', 'Linh Mon', '', 'Đợt 1')], []);
  check('12. Active thiếu Code -> cảnh báo, không nhắc', r.warnings.activeMissingCode.length === 1 && r.reminders.length === 0);
  // 13. Ngày chốt dự kiến
  r = run([mentee('GKS-1: A', 'Linh Mon', '', 'Đợt 1')], [app('GKS-1: A', 'SNU', '', plus(2), 'Chưa chốt')]);
  check('13. Ngày chốt dự kiến sau 2 ngày -> nhắc chốt trường', r.reminders.length === 1 && r.reminders[0].type === TYPE_EXPECTED);
  // 14. Tên mentor "Chị Cúc"
  r = run([mentee('GKS-7: G', 'Chị Cúc', '', 'Đợt 1')], [app('GKS-7: G', 'KAIST', plus(7), '')]);
  check('14. Khớp tên mentor viết đúng "Chị Cúc"', r.reminders.length === 1);
  // 15. Phân tích ngày
  check('15a. dd/MM/yyyy', dayKey_('14/9/2025', sheetTz) === '2025-09-14');
  check('15b. "3/2026" bị bỏ qua', dayKey_('3/2026', sheetTz) === null);
  // 16. Tách mentor
  check('16. splitMentors_', splitMentors_('Mon & P.Ngọc, Liên và Phúc').length === 4);

  const failed = results.filter(function (x) { return x.indexOf('LỖI') === 0; }).length;
  results.push('');
  results.push(failed === 0 ? 'TẤT CẢ ĐẠT.' : 'CÓ ' + failed + ' TRƯỜNG HỢP LỖI.');
  Logger.log(results.join('\n'));
  ui_(results.join('\n'));
}

// ============================================================
// HƯỚNG DẪN CÀI ĐẶT
// ============================================================
// 1. Mở Google Sheet, vào Tiện ích mở rộng > Apps Script. Xóa nội dung mặc định của Code.gs,
//    dán toàn bộ file này vào, bấm Lưu.
// 2. Trong trình soạn thảo Apps Script, chọn hàm setup rồi bấm Chạy. Lần đầu Google sẽ hỏi cấp quyền
//    (đọc/ghi bảng tính, gửi email, tạo trigger). Chọn tài khoản của bạn, bấm "Nâng cao" > "Đi tới ..." nếu có cảnh báo.
//    setup() tạo tab Applications, Progress_Log, Reminders, Config và thêm cột "Ngày hết hạn bảo lưu"
//    cùng "Trạng thái hiện tại" (nếu thiếu) ở tab mentee. Không sửa dữ liệu có sẵn.
// 3. Mở tab Config, điền MANAGER_EMAIL (email của bạn). Các giá trị khác để mặc định cũng được:
//    REMINDER_DAYS_BEFORE = 7, SEND_HOUR = 8, TIMEZONE = Asia/Ho_Chi_Minh, DRY_RUN = TRUE.
// 4. Tải lại trang Sheet, sẽ có menu "SEM Scholars". Chạy testWithSampleData (trong Apps Script) để kiểm tra logic:
//    tất cả trường hợp phải ĐẠT.
// 5. Trong tab Applications, nhập thử vài dòng (Code, Trường, Ngày deadline). Nên thử một dòng có
//    deadline đúng 7 ngày kể từ hôm nay. Dùng menu "SEM Scholars > Xem trước nhắc nhở" để xem email sẽ gửi cho ai.
// 6. Giữ DRY_RUN = TRUE và dùng "Gửi nhắc nhở ngay" vài lần để xem tab Reminders ghi "Dry-run".
// 7. Cài lịch: menu "SEM Scholars > Cài lịch gửi hằng ngày". Khi đã yên tâm, đổi DRY_RUN thành FALSE
//    trong tab Config để gửi email thật.
// 8. Hạn mức: Gmail thường có giới hạn số email mỗi ngày (khoảng 100). Script tự dừng khi gần hết hạn mức
//    và ghi "Bỏ qua" trong tab Reminders.

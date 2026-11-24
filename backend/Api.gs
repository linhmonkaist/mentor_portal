/**
 * SEM Scholars: API JSON cho cổng mentor (frontend host riêng, ví dụ GitHub Pages).
 *
 * Mọi lệnh gửi bằng POST, nội dung là JSON gửi với Content-Type text/plain (để trình duyệt không cần
 * bước kiểm tra CORS trước). Phản hồi luôn là JSON:
 *   Thành công: { "ok": true, "data": { ... } }
 *   Lỗi:        { "ok": false, "error": { "code": "...", "message": "..." } }
 *
 * Lệnh (action): requestLogin, verifyCode, redeemLink, getMentees, logout.
 * Mã lỗi: INVALID_EMAIL, RATE_LIMITED, INVALID_CODE, LINK_INVALID, SESSION_EXPIRED, NOT_FOUND,
 *         BAD_REQUEST, SERVER_ERROR.
 *
 * TRIỂN KHAI: Triển khai > Tùy chọn triển khai mới > Ứng dụng web.
 *   Thực thi dưới tên: Tôi.   Người có quyền truy cập: Bất kỳ ai.
 * Mỗi lần sửa code phải tạo phiên bản triển khai mới. URL dạng .../exec dán vào assets/config.js của frontend.
 */

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function apiOk_(data) {
  return { ok: true, data: data };
}

function apiFail_(code, message) {
  return { ok: false, error: { code: code, message: message } };
}

/** Kiểm tra sống. Không trả dữ liệu nào. */
function doGet() {
  return jsonOut_(apiOk_({ service: 'sem-mentor-api', status: 'ok' }));
}

function doPost(e) {
  let req;
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    if (raw.length > 5000) return jsonOut_(apiFail_('BAD_REQUEST', 'Yêu cầu quá lớn.'));
    req = JSON.parse(raw);
  } catch (err) {
    return jsonOut_(apiFail_('BAD_REQUEST', 'Yêu cầu không hợp lệ.'));
  }
  if (!req || typeof req !== 'object') return jsonOut_(apiFail_('BAD_REQUEST', 'Yêu cầu không hợp lệ.'));
  return jsonOut_(handleApi_(req));
}

/** Chuyển kết quả {ok, code, message, ...} của các hàm đăng nhập thành khuôn API. */
function fromAuth_(r, pick) {
  if (!r.ok) return apiFail_(r.code || 'BAD_REQUEST', r.message || 'Có lỗi xảy ra.');
  const out = {};
  pick.forEach(function (k) { if (r[k] !== undefined) out[k] = r[k]; });
  return apiOk_(out);
}

function handleApi_(req) {
  try {
    switch (String(req.action || '')) {
      case 'requestLogin':
        return fromAuth_(requestLoginCode(req.email), ['message']);
      case 'verifyCode':
        return fromAuth_(verifyLoginCode(req.email, req.code), ['token', 'expiresAt']);
      case 'redeemLink':
        return fromAuth_(redeemLoginLink(req.linkToken), ['token', 'expiresAt']);
      case 'getMentees':
        return apiOk_(apiMenteesPayload_(loadMentees(req.token, req.asMentor)));
      case 'logout':
        return apiOk_({});
      default:
        return apiFail_('BAD_REQUEST', 'Lệnh không được hỗ trợ.');
    }
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (msg === 'SESSION_EXPIRED') return apiFail_('SESSION_EXPIRED', 'Phiên đăng nhập đã hết hạn.');
    if (msg.indexOf('Không tìm thấy mentor') === 0) return apiFail_('NOT_FOUND', msg);
    Logger.log('API error: ' + msg); // không trả chi tiết lỗi nội bộ cho client
    return apiFail_('SERVER_ERROR', 'Có lỗi xảy ra, vui lòng thử lại.');
  }
}

/** Định dạng dữ liệu trả cho frontend (khớp với tài liệu API). */
function apiMenteesPayload_(v) {
  let mode = 'mentor';
  if (v.admin) mode = v.all ? 'all' : 'impersonate';
  return {
    me: v.me,
    role: v.admin ? 'admin' : 'mentor',
    view: { mode: mode, mentorNames: v.mentors },
    mentorList: v.mentorList,
    counts: v.counts,
    activePayment: v.activePayment,
    mentees: v.rows.map(function (r) {
      const m = {
        name: r.name,
        email: r.email,
        plan: r.plan,
        payment: r.payment,
        paymentGroup: r.paymentGroup,
        status: r.status,
        holdUntil: r.holdUntil,
        cvUrl: r.cv,
        zalo: r.zalo,
        registeredAt: r.registeredAt
      };
      if (r.code !== undefined) { m.code = r.code; m.mentorText = r.mentorText; }
      return m;
    })
  };
}

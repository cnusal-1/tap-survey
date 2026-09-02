/**
 * 두들김 조사 — 수집 창구 (Google Apps Script)
 *
 * 조사자는 앱에서 «수집 서버로 보내기» 를 누르기만 한다. 암구호도 계정도 토큰도
 * 없다. 담당자가 이 창구를 한 번 만들고 주소를 앱에 박아 두면 끝이다.
 *
 * 암구호를 없앤 대신 아래 넷으로 막는다. 어느 것도 조사자를 귀찮게 하지 않는다.
 *   1) 이름 검사   조사 파일 형식이 아닌 것은 받지 않는다
 *   2) 크기 제한   파일 하나 20 MB
 *   3) 하루 상한   하루 600 파일 (조사 60건쯤). 넘으면 그날은 닫힌다
 *   4) 차단 스위치 OPEN 을 false 로 두면 즉시 닫힌다
 * 모든 수신은 조사 폴더의 _수신기록.csv 에 남는다.
 *
 * ── 만드는 법 ──────────────────────────────────────────────────
 *   자세한 안내: https://cnusal-1.github.io/tap-survey/collector-guide.html
 *
 * 1. script.google.com → 새 프로젝트
 * 2. 이 파일 내용을 통째로 붙여넣는다
 * 3. FOLDER 는 그냥 비워 두면 된다. «두들김 조사» 폴더를 내 드라이브에
 *    자동으로 만든다. 특정 폴더에 넣고 싶으면 그 폴더를 드라이브에서 열었을 때의
 *    주소를 통째로 붙여넣어도 되고 ID 만 넣어도 된다 —
 *      https://drive.google.com/drive/folders/1AbC…33자…XyZ
 *    ID 는 보통 33자다. 짧게 잘라 넣으면 «잘못된 폴더 ID» 가 난다
 * 4. 배포 → 새 배포 → 유형 «웹 앱»
 *      실행 계정 : 나
 *      액세스 권한: 모든 사용자          ← 조사자가 로그인하지 않아도 되게
 *    권한 승인을 한 번 요구한다. 승인한다
 * 5. 나오는 /exec 주소를 앱의 COLLECT_URL 에 박아 넣는다 (index.html 위쪽)
 *
 * ── 알아 둘 것 ─────────────────────────────────────────────────
 * · 주소를 아는 사람은 누구나 올릴 수 있다. 그래서 위의 넷이 있다
 * · 이 창구는 «쓰기만» 한다. 읽기도 삭제도 없다. 주소가 새어도 남의 조사
 *   자료를 가져갈 수는 없다
 * · 코드를 고치면 «배포 → 배포 관리 → 편집 → 새 버전» 을 해야 반영된다
 */

var FOLDER    = "";      // 비우면 자동 생성. 폴더 주소를 통째로 넣어도 된다
var OPEN      = true;    // false 로 두면 창구를 닫는다
var MAXBYTES  = 20 * 1024 * 1024;   // 파일 하나 상한
var DAILYCAP  = 600;                // 하루에 받을 파일 수 상한
var SECRET    = "";      // 비워 두면 암구호를 묻지 않는다. 쓰려면 값을 넣는다

/* 받을 파일 이름 — 앱이 만드는 형식만 통과시킨다
   예) 20260902_1430-만경강교-P22-코핑_하면(동쪽)-T001.wav              */
var NAME_OK = /^\d{8}_\d{4}-.+\.(csv|jpg|jpeg|png|wav)$/i;

function doPost(e) {
  try {
    if (!OPEN) return reply({ ok: false, error: "창구가 닫혀 있다. 담당자에게 문의하라" });
    if (!e || !e.postData || !e.postData.contents) return reply({ ok: false, error: "빈 요청" });

    var q = JSON.parse(e.postData.contents);

    if (SECRET && String(q.key || "") !== SECRET) return reply({ ok: false, error: "암구호 불일치" });
    if (!q.survey || !q.name || !q.data) return reply({ ok: false, error: "survey·name·data 가 필요하다" });

    var survey = String(q.survey).replace(/[\/\\:*?"<>|]/g, "_").slice(0, 120);
    var name   = String(q.name).replace(/[\/\\:*?"<>|]/g, "_").slice(0, 160);

    /* 1) 이름 검사 — 조사 파일이 아닌 것을 걸러낸다 */
    if (!NAME_OK.test(name)) return reply({ ok: false, error: "조사 파일 형식이 아니다: " + name });

    /* 2) 크기 제한 */
    var bytes = Utilities.base64Decode(q.data);
    if (bytes.length > MAXBYTES) {
      return reply({ ok: false, error: "파일이 너무 크다 (" + Math.round(bytes.length / 1048576) + " MB)" });
    }

    /* 3) 하루 상한 */
    var used = bump_();
    if (used > DAILYCAP) return reply({ ok: false, error: "오늘 받을 수 있는 양을 넘었다. 내일 다시 보내라" });

    var picked = resolveFolder_();
    var dir = childFolder_(picked.folder, survey);

    var blob = Utilities.newBlob(bytes, q.type || "application/octet-stream", name);

    /* 같은 이름이 이미 있으면 덮어쓴다 — 통신이 끊겨 다시 보낸 경우다 */
    var old = dir.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);

    var f = dir.createFile(blob);

    log_(dir, q, name, f.getSize());
    return reply({ ok: true, id: f.getId(), bytes: f.getSize(),
                   todayUsed: used, dailyCap: DAILYCAP, warn: picked.warn || undefined });

  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

/* 브라우저로 주소를 열었을 때 — 살아 있는지와 오늘 남은 양만 알려 준다 */
function doGet() {
  return reply({
    ok: true, service: "두들김 조사 수집 창구",
    open: OPEN, todayUsed: peek_(), dailyCap: DAILYCAP,
    folder: (function () { try { return resolveFolder_().folder.getName(); } catch (e) { return "?"; } })(),
    note: "POST 로 보낸다"
  });
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 하루 상한 ---------- */
function dayKey_() {
  return "cnt_" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd");
}
function bump_() {
  var p = PropertiesService.getScriptProperties();
  var k = dayKey_();
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    var n = parseInt(p.getProperty(k) || "0", 10) + 1;
    p.setProperty(k, String(n));
    return n;
  } catch (e) {
    return parseInt(p.getProperty(k) || "0", 10) + 1;   // 잠금 실패해도 업로드는 막지 않는다
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
function peek_() {
  return parseInt(PropertiesService.getScriptProperties().getProperty(dayKey_()) || "0", 10);
}

/* ---------- 폴더 ----------
   FOLDER 에 주소를 통째로 붙여넣어도 되게 ID 를 뽑아낸다. ID 가 잘못돼 있으면
   업로드를 실패시키지 않고 기본 폴더로 받되, 그 사실을 응답에 담는다 —
   현장에서 자료를 잃는 것이 잘못된 폴더에 들어가는 것보다 나쁘다. */
function resolveFolder_() {
  var raw = String(FOLDER || "").trim();
  if (!raw) return { folder: rootFolder_() };
  var m = raw.match(/[-\w]{25,}/);
  if (!m) return { folder: rootFolder_(), warn: "FOLDER 값이 폴더 ID 로 보이지 않는다 (\"" + raw + "\"). 기본 폴더에 받았다" };
  try {
    return { folder: DriveApp.getFolderById(m[0]) };
  } catch (e) {
    return { folder: rootFolder_(), warn: "FOLDER ID 로 폴더를 열지 못했다. 기본 폴더에 받았다" };
  }
}

function rootFolder_() {
  var it = DriveApp.getFoldersByName("두들김 조사");
  return it.hasNext() ? it.next() : DriveApp.createFolder("두들김 조사");
}
function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/* 조사 폴더마다 누가 언제 무엇을 올렸는지 한 줄씩 남긴다 */
function log_(dir, q, name, bytes) {
  try {
    var line = [
      new Date().toISOString(),
      q.inspector || "",
      q.bridge || "",
      name,
      bytes
    ].join(",") + "\n";
    var it = dir.getFilesByName("_수신기록.csv");
    if (it.hasNext()) {
      var f = it.next();
      f.setContent(f.getBlob().getDataAsString("UTF-8") + line);
    } else {
      dir.createFile("_수신기록.csv",
        "﻿수신시각,점검원,교량명,파일,바이트\n" + line, "text/csv");
    }
  } catch (e) { /* 기록 실패가 업로드를 막지는 않는다 */ }
}

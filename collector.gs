/**
 * 두들김 조사 — 수집 창구 (Google Apps Script)
 *
 * 조사자에게 저장소 쓰기 토큰을 나눠 주는 것은 구조가 틀렸다. 토큰 하나로
 * 저장소 전체를 지울 수 있고, 사람이 늘수록 회수도 관리도 안 된다.
 * 담당자가 이 창구를 한 번 만들고, 조사자에게는 «주소 + 암구호» 만 준다.
 * 구글 계정은 담당자 하나면 되고, 조사자는 아무 계정도 필요 없다.
 *
 * ── 만드는 법 (5분) ────────────────────────────────────────────
 * 1. script.google.com → 새 프로젝트
 * 2. 이 파일 내용을 통째로 붙여넣는다
 * 3. 아래 SECRET 을 현장에서 쓸 값으로 바꾼다 (조사자에게 알려 줄 값)
 * 4. FOLDER 를 결과를 담을 구글 드라이브 폴더 ID 로 바꾼다
 *      드라이브에서 폴더를 열면 주소가
 *      https://drive.google.com/drive/folders/<여기가 ID>
 *    비워 두면 «두들김 조사» 폴더를 내 드라이브에 자동으로 만든다
 * 5. 배포 → 새 배포 → 유형 «웹 앱»
 *      실행 계정 : 나
 *      액세스 권한: 모든 사용자          ← 조사자가 로그인하지 않아도 되게
 *    배포를 누르면 권한 승인을 한 번 요구한다. 승인한다
 * 6. 나오는 /exec 주소를 조사자에게 준다. 앱의 «수집 주소» 칸에 넣는다
 *
 * ── 알아 둘 것 ─────────────────────────────────────────────────
 * · 주소를 아는 사람은 누구나 올릴 수 있다. 암구호는 장난 업로드를 막는
 *   최소한의 문턱이지 강한 인증이 아니다. 올라온 것을 담당자가 확인한다
 * · 이 창구는 «쓰기만» 한다. 읽기도 삭제도 안 된다. 주소가 새어도 남의
 *   조사 자료를 가져갈 수는 없다
 * · 앱은 파일을 하나씩 나눠 보낸다. 현장 통신에서 8 MB 한 방은 잘 끊긴다
 * · 코드를 고치면 «배포 → 배포 관리 → 편집 → 새 버전» 을 해야 반영된다
 */

var SECRET = "여기를-현장-암구호로-바꾼다";
var FOLDER = "";   // 구글 드라이브 폴더 ID. 비우면 자동 생성

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return reply({ ok: false, error: "빈 요청" });

    var q = JSON.parse(e.postData.contents);

    if (SECRET && String(q.key || "") !== SECRET) return reply({ ok: false, error: "암구호 불일치" });
    if (!q.survey || !q.name || !q.data) return reply({ ok: false, error: "survey·name·data 가 필요하다" });

    /* 경로 조작을 막는다 — 폴더 이름과 파일 이름에서 구분자를 걷어낸다 */
    var survey = String(q.survey).replace(/[\/\\:*?"<>|]/g, "_").slice(0, 120);
    var name   = String(q.name).replace(/[\/\\:*?"<>|]/g, "_").slice(0, 160);

    var root = FOLDER ? DriveApp.getFolderById(FOLDER) : rootFolder_();
    var dir  = childFolder_(root, survey);

    var blob = Utilities.newBlob(
      Utilities.base64Decode(q.data),
      q.type || "application/octet-stream",
      name
    );

    /* 같은 이름이 이미 있으면 덮어쓴다 — 통신이 끊겨 다시 보낸 경우다 */
    var old = dir.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);

    var f = dir.createFile(blob);

    log_(dir, q, name, f.getSize());
    return reply({ ok: true, id: f.getId(), bytes: f.getSize() });

  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  }
}

/* 브라우저로 주소를 열었을 때 — 살아 있는지만 알려 준다 */
function doGet() {
  return reply({ ok: true, service: "두들김 조사 수집 창구", note: "POST 로 보낸다" });
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
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

// Vivek Finance - Auth & Submissions proxy
// Deploy as Web App. Execute as: Me. Who has access: Anyone.
//
// Two responsibilities:
//   1. Authenticate against the SHEET_ID spreadsheet (looking up User ID column)
//   2. Accept form submissions and append rows into a separate "submissions"
//      spreadsheet, auto-created on first use, with 3 tabs:
//          Account Opening | KYC Form | Modification
//      Each row begins with Date | Time | User ID, then the form fields.
//
// Endpoint contract:
//   action=login (default if omitted) - body: userid, password
//   action=submit - body: form (account_opening|kyc|modification),
//                         userid, plus every form field as a flat key.

const SHEET_ID = '1taIJ5YyrJAbEJ8vLGqGScyrzWbtEeeJ_Zx_nktAn85Y';
const TZ = 'Asia/Kolkata';

const SUBMISSION_TABS = {
  account_opening: 'Account Opening',
  kyc: 'KYC Form',
  modification: 'Modification',
};

function doPost(e) { return handle(e); }
function doGet(e)  { return handle(e); }

function handle(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = String(params.action || 'login').toLowerCase();
    if (action === 'submit') return handleSubmit(params);
    return handleLogin(params);
  } catch (err) {
    return json({ ok: false, error: 'server_error', detail: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

function handleLogin(params) {
  const userId = String(params.userid || params.userId || params.user_id || params.email || '').trim().toLowerCase();
  const password = String(params.password || '');
  if (!userId || !password) return json({ ok: false, error: 'missing_credentials' });

  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return json({ ok: false, error: 'no_users' });

  const headers = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const userIdCol   = findCol(headers, ['user id', 'userid', 'user_id', 'username', 'login', 'id']);
  const emailCol    = findCol(headers, ['email', 'mail', 'e-mail', 'emailid', 'email id']);
  const passwordCol = findCol(headers, ['password', 'passwords', 'pwd', 'pass']);
  const activeCol   = findCol(headers, ['active', 'enabled', 'status']);

  const identityCol = userIdCol >= 0 ? userIdCol : emailCol;
  if (identityCol < 0 || passwordCol < 0) return json({ ok: false, error: 'sheet_misconfigured' });

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowIdentity = String(row[identityCol] || '').trim().toLowerCase();
    var rowPassword = String(row[passwordCol] || '');
    if (rowIdentity !== userId || rowPassword !== password) continue;

    if (activeCol >= 0) {
      var raw = row[activeCol];
      var v = String(raw).trim().toLowerCase();
      var isActive = raw === true || raw === 1 || v === '' || v === 'true' || v === 'yes' || v === 'y' || v === '1' || v === 'active';
      if (!isActive) return json({ ok: false, error: 'inactive' });
    }
    return json({ ok: true, userId: rowIdentity });
  }
  return json({ ok: false, error: 'invalid_credentials' });
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

function handleSubmit(params) {
  const formType = String(params.form || '').toLowerCase();
  const tabName = SUBMISSION_TABS[formType];
  if (!tabName) return json({ ok: false, error: 'invalid_form_type' });

  const userId = String(params.userid || params.userId || '').trim();
  if (!userId) return json({ ok: false, error: 'missing_userid' });

  const ss = getSubmissionsSpreadsheet();
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) sheet = ss.insertSheet(tabName);

  // Existing headers (row 1)
  var headers = [];
  if (sheet.getLastColumn() > 0) {
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h); });
  }
  // Strip any trailing empty headers
  while (headers.length && headers[headers.length - 1] === '') headers.pop();

  // Make sure the three baseline headers exist (in this order at the start)
  var baseline = ['Date', 'Time', 'User ID'];
  baseline.forEach(function (h) { if (headers.indexOf(h) < 0) headers.unshift(h); });
  // Move baseline to the front if they crept rightward
  headers = baseline.concat(headers.filter(function (h) { return baseline.indexOf(h) < 0; }));

  // Fold in any new field names from this submission
  const SKIP = ['action', 'form', 'userid', 'userId', 'user_id', 'password'];
  Object.keys(params).forEach(function (k) {
    if (SKIP.indexOf(k) >= 0) return;
    if (headers.indexOf(k) < 0) headers.push(k);
  });

  // Persist headers
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1a1a1a').setFontColor('#f0f0f0');

  // Build row matched to header order
  const now = new Date();
  const date = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const time = Utilities.formatDate(now, TZ, 'HH:mm:ss');

  const row = headers.map(function (h) {
    if (h === 'Date')    return date;
    if (h === 'Time')    return time;
    if (h === 'User ID') return userId;
    return params[h] === undefined ? '' : params[h];
  });

  sheet.appendRow(row);

  return json({
    ok: true,
    tab: tabName,
    row: sheet.getLastRow(),
    spreadsheetUrl: ss.getUrl(),
  });
}

function getSubmissionsSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('SUBMISSIONS_SHEET_ID');
  if (ssId) {
    try { return SpreadsheetApp.openById(ssId); }
    catch (err) { ssId = null; }
  }
  const ss = SpreadsheetApp.create('Vivek Finance - Client Form Submissions');
  const tabs = ['Account Opening', 'KYC Form', 'Modification'];
  const defaultSheet = ss.getSheets()[0];
  tabs.forEach(function (name, idx) {
    var s = idx === 0 ? defaultSheet : ss.insertSheet(name);
    if (idx === 0) s.setName(name);
    s.getRange(1, 1, 1, 3).setValues([['Date', 'Time', 'User ID']])
      .setFontWeight('bold').setBackground('#1a1a1a').setFontColor('#f0f0f0');
    s.setFrozenRows(1);
    s.setColumnWidth(1, 110);
    s.setColumnWidth(2, 90);
    s.setColumnWidth(3, 140);
  });
  props.setProperty('SUBMISSIONS_SHEET_ID', ss.getId());
  return ss;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findCol(headers, names) {
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

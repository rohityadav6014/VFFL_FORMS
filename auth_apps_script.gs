// Vivek Finance - Auth & Submissions proxy
// Deploy as Web App.  Execute as: Me.  Who has access: Anyone.
//
// Responsibilities:
//   1. Authenticate against the USERS spreadsheet (SHEET_ID) by looking up the
//      User ID / Email column.
//   2. Accept form submissions and append each one as a NEW ROW into a separate
//      submissions spreadsheet, auto-created on first use, with 4 tabs - one per
//      account type:
//          Sole / Single | Joint | Corporate | HUF
//      Each row begins with:  Date & Time | Form Type | User ID  then the form
//      fields.  "Form Type" records whether the row is an Account Opening, KYC,
//      or Modification submission, so all three live together in one tab.
//
// Endpoint contract:
//   action=login  (default if omitted) - body: userid, password
//   action=submit - body: form (e.g. "sole account opening", "joint kyc",
//                         "corporate modification", "huf account opening"),
//                         userid, plus every form field as a flat key.

const SHEET_ID = '1taIJ5YyrJAbEJ8vLGqGScyrzWbtEeeJ_Zx_nktAn85Y'; // users / login sheet
const TZ = 'Asia/Kolkata';

// Bumping this property key forces a fresh submissions spreadsheet to be created
// (the old one is left untouched). Increment the suffix if you ever want a new one.
const SUBMISSIONS_PROP = 'SUBMISSIONS_SHEET_ID_V4';
const SUBMISSIONS_TITLE = 'Vivek Finance - Client Form Submissions';

// The four account-type tabs. Order here is the order the tabs are created in.
const ACCOUNT_TABS = {
  sole:      'Sole / Single',
  joint:     'Joint',
  corporate: 'Corporate',
  huf:       'HUF'
};

// Friendly labels for the "Form Type" column.
const FORM_TYPE_LABELS = {
  'account opening': 'Account Opening',
  'kyc':             'KYC',
  'modification':    'Modification'
};

const BASELINE_HEADERS = ['Date & Time', 'Form Type', 'User ID'];

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
  // form looks like "sole account opening" / "joint kyc" / "corporate modification".
  const rawForm = String(params.form || '').toLowerCase().trim();
  const parsed = parseForm(rawForm);          // { accountKey, formType }
  const tabName = ACCOUNT_TABS[parsed.accountKey] || 'Other';
  const formTypeLabel = FORM_TYPE_LABELS[parsed.formType] || (parsed.formType || 'Unknown');

  const userId = String(params.userid || params.userId || '').trim();

  // Ordered [{header, value}] from the client. The client sends a single JSON
  // "payload" param because Apps Script's e.parameter does NOT preserve the POST
  // field order - carrying the order ourselves keeps sheet columns in form order.
  var fields = [];
  if (params.payload) {
    try { fields = JSON.parse(params.payload) || []; } catch (e) { fields = []; }
  } else {
    // Fallback for flat-field clients (column order not guaranteed).
    mergeHolderNames(params);
    var SKIP = ['action', 'form', 'userid', 'userId', 'user_id', 'password', 'payload'];
    Object.keys(params).forEach(function (k) {
      if (SKIP.indexOf(k) < 0) fields.push({ header: k, value: params[k] });
    });
  }

  // Use a document lock so concurrent submissions can't clobber the header row
  // or land on the same row.
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { /* proceed best-effort */ }

  try {
    const ss = getSubmissionsSpreadsheet();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      initSheetHeaders(sheet);
    }

    // Existing headers (row 1), trimming trailing blanks.
    var headers = [];
    if (sheet.getLastColumn() > 0) {
      headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h); });
    }
    while (headers.length && headers[headers.length - 1] === '') headers.pop();

    // Guarantee the baseline columns exist, in order, at the front.
    headers = BASELINE_HEADERS.concat(headers.filter(function (h) { return BASELINE_HEADERS.indexOf(h) < 0; }));

    // Fold in this submission's fields IN ORDER, and remember their values.
    var valueMap = {};
    fields.forEach(function (f) {
      var h = String(f && f.header != null ? f.header : '').trim();
      if (!h || BASELINE_HEADERS.indexOf(h) >= 0) return;
      if (headers.indexOf(h) < 0) headers.push(h);
      valueMap[h] = (f && f.value != null) ? f.value : '';
    });

    // Persist (possibly widened) header row.
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1a1a1a').setFontColor('#f0f0f0');

    // Build the row in header order and append it (always a new, next-empty row).
    const datetime = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    const row = headers.map(function (h) {
      if (h === 'Date & Time') return datetime;
      if (h === 'Form Type')   return formTypeLabel;
      if (h === 'User ID')     return userId;
      return valueMap[h] === undefined ? '' : valueMap[h];
    });
    sheet.appendRow(row);

    return json({
      ok: true,
      tab: tabName,
      formType: formTypeLabel,
      row: sheet.getLastRow(),
      spreadsheetUrl: ss.getUrl()
    });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// Split "corporate account opening" -> { accountKey:'corporate', formType:'account opening' }.
function parseForm(rawForm) {
  var accountKey = '';
  if (rawForm.indexOf('sole') === 0 || rawForm.indexOf('single') === 0) accountKey = 'sole';
  else if (rawForm.indexOf('joint') === 0)                              accountKey = 'joint';
  else if (rawForm.indexOf('corporate') === 0 || rawForm.indexOf('company') === 0) accountKey = 'corporate';
  else if (rawForm.indexOf('huf') === 0)                                accountKey = 'huf';

  var rest = rawForm;
  ['sole', 'single', 'joint', 'corporate', 'company', 'huf'].forEach(function (p) {
    if (rest.indexOf(p) === 0) rest = rest.slice(p.length);
  });
  rest = rest.trim();

  var formType = '';
  if (rest.indexOf('account opening') >= 0 || rest.indexOf('opening') >= 0 || rest.indexOf('application') >= 0) formType = 'account opening';
  else if (rest.indexOf('kyc') >= 0)          formType = 'kyc';
  else if (rest.indexOf('modification') >= 0) formType = 'modification';

  return { accountKey: accountKey, formType: formType };
}

function mergeHolderNames(params) {
  function mergeName(pfx, f, m, l) {
    return [pfx, f, m, l].filter(function (x) { return x; }).join(' ').trim();
  }
  var n1 = mergeName(params.prefix || params.h1_prefix, params.firstName || params.h1_firstName, params.middleName || params.h1_middleName, params.lastName || params.h1_lastName);
  if (n1) {
    params['Holder 1 Full Name'] = n1;
    ['prefix', 'firstName', 'middleName', 'lastName', 'h1_prefix', 'h1_firstName', 'h1_middleName', 'h1_lastName'].forEach(function (k) { delete params[k]; });
  }
  var n2 = mergeName(params.h2_prefix, params.h2_firstName, params.h2_middleName, params.h2_lastName);
  if (n2) {
    params['Holder 2 Full Name'] = n2;
    ['h2_prefix', 'h2_firstName', 'h2_middleName', 'h2_lastName'].forEach(function (k) { delete params[k]; });
  }
  var n3 = mergeName(params.h3_prefix, params.h3_firstName, params.h3_middleName, params.h3_lastName);
  if (n3) {
    params['Holder 3 Full Name'] = n3;
    ['h3_prefix', 'h3_firstName', 'h3_middleName', 'h3_lastName'].forEach(function (k) { delete params[k]; });
  }
}

function getSubmissionsSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty(SUBMISSIONS_PROP);
  if (ssId) {
    try { return SpreadsheetApp.openById(ssId); }
    catch (err) { ssId = null; }   // stored sheet is gone - fall through and create a fresh one
  }

  const ss = SpreadsheetApp.create(SUBMISSIONS_TITLE);
  const tabNames = Object.keys(ACCOUNT_TABS).map(function (k) { return ACCOUNT_TABS[k]; });
  const defaultSheet = ss.getSheets()[0];
  tabNames.forEach(function (name, idx) {
    var s = idx === 0 ? defaultSheet : ss.insertSheet(name);
    if (idx === 0) s.setName(name);
    initSheetHeaders(s);
  });
  props.setProperty(SUBMISSIONS_PROP, ss.getId());
  return ss;
}

function initSheetHeaders(s) {
  s.getRange(1, 1, 1, BASELINE_HEADERS.length).setValues([BASELINE_HEADERS])
    .setFontWeight('bold').setBackground('#1a1a1a').setFontColor('#f0f0f0');
  s.setFrozenRows(1);
  s.setColumnWidth(1, 160); // Date & Time
  s.setColumnWidth(2, 130); // Form Type
  s.setColumnWidth(3, 140); // User ID
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

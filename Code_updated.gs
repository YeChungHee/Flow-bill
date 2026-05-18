/* ===== e_bill GAS API =====
   Google Sheets 기반 전자어음 할인 CRUD API
   시트: bill_data, user_data, app_config
   배포: 웹 앱(누구나 접근 가능)
*/

var SS_ID = '1pNalg-uJjSsyy6CuILndc2VYc9IFnHCUXbf8kQlY5Uw';
var DRIVE_FOLDER_ID = '1EA4KCxRizzfxyw51iZI5lg2Ih8Tqc8R8';

// ===== [긴급복구] 헤더 복원 — 데이터 오류 시 1회 실행 =====
function fixHeaders() {
  var ss = SpreadsheetApp.openById(SS_ID);
  var billSheet = ss.getSheetByName('bill_data');

  // 기존 실제 컬럼 순서 그대로 복원 (applyName 제거) + 배서 4개 컬럼 끝에 추가
  var correctHeaders = [
    'uid','timestamp','applyBiz','issuerName','issuerBiz',
    'billAmount','billDue','startDate','usageDays','status',
    'rate','fee','net','processedAt',
    'splitEndorsement','splitCount','splitAmounts',
    'bankName','accountNo','attachmentName','attachmentData','attachmentType',
    'endorseCompleted','endorseCompletedAt',
    'depositDate','cancelledAt',
    'endorseBankName','endorseAccountNo','endorseHolder','endorseIdNo'
  ];

  var lastCol = billSheet.getLastColumn();
  var writeLen = Math.max(correctHeaders.length, lastCol);
  // 기존 컬럼보다 짧아지는 경우 빈 문자열로 채워 기존 헤더 지우기
  var headerRow = correctHeaders.concat(
    new Array(Math.max(0, writeLen - correctHeaders.length)).fill('')
  );
  billSheet.getRange(1, 1, 1, writeLen).setValues([headerRow]);
  billSheet.getRange(1, 1, 1, correctHeaders.length).setFontWeight('bold');

  Logger.log('fixHeaders complete. lastCol=' + lastCol + ', written=' + writeLen);
}

// ===== 헤더 초기화 (최초 1회 실행, 신규 시트 생성 시에만 사용) =====
function setupHeaders() {
  var ss = SpreadsheetApp.openById(SS_ID);

  // bill_data 헤더 — 기존 컬럼 순서 유지 + 배서 4개 컬럼 끝에 추가
  var billSheet = ss.getSheetByName('bill_data');
  var billHeaders = [
    'uid','timestamp','applyBiz','issuerName','issuerBiz',
    'billAmount','billDue','startDate','usageDays','status',
    'rate','fee','net','processedAt',
    'splitEndorsement','splitCount','splitAmounts',
    'bankName','accountNo','attachmentName','attachmentData','attachmentType',
    'endorseCompleted','endorseCompletedAt',
    'depositDate','cancelledAt',
    'endorseBankName','endorseAccountNo','endorseHolder','endorseIdNo'
  ];
  billSheet.getRange(1, 1, 1, billHeaders.length).setValues([billHeaders]);
  billSheet.getRange(1, 1, 1, billHeaders.length).setFontWeight('bold');
  billSheet.setFrozenRows(1);

  // user_data 헤더
  var userSheet = ss.getSheetByName('user_data');
  var userHeaders = [
    'userId','applyName','pinNo','applyBiz','phone','email',
    'bankName','accountNo','createdAt','updatedAt'
  ];
  userSheet.getRange(1, 1, 1, userHeaders.length).setValues([userHeaders]);
  userSheet.getRange(1, 1, 1, userHeaders.length).setFontWeight('bold');
  userSheet.setFrozenRows(1);

  Logger.log('Headers setup complete');
}

// ===== app_config 시트 초기화 (최초 1회 실행) =====
function setupAppConfig() {
  var ss = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName('app_config');
  if (!sheet) {
    sheet = ss.insertSheet('app_config');
  }
  var headers = ['key', 'value', 'updatedAt'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // 기존 배서 계좌 기본값 입력
  var initData = [
    ['endorse_bankName',  '우리은행',                                    new Date().toLocaleString('ko-KR')],
    ['endorse_accountNo', '1002-631-832129',                                              new Date().toLocaleString('ko-KR')],
    ['endorse_holder',    '개인사업자 : (플로우렌트) 신인근', new Date().toLocaleString('ko-KR')],
    ['endorse_idNo',      '880708-1',                                                     new Date().toLocaleString('ko-KR')]
  ];
  // 기존 데이터가 없을 때만 초기값 입력
  if (sheet.getLastRow() <= 1) {
    sheet.getRange(2, 1, initData.length, 3).setValues(initData);
  }
  Logger.log('app_config setup complete');
}

// ===== 유틸리티 =====
function getSheet(name) {
  return SpreadsheetApp.openById(SS_ID).getSheetByName(name);
}

function sheetToJson(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var val = data[i][j];
      obj[headers[j]] = (val === '' || val === null || val === undefined) ? '' : val;
    }
    result.push(obj);
  }
  return result;
}

function findRowByUid(sheet, uid) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(uid)) return i + 1; // 1-indexed row
  }
  return -1;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== Slack 릴레이 =====
function sendSlack(text) {
  var webhookUrl = PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL') || '';
  if (!webhookUrl) { Logger.log('SLACK_WEBHOOK_URL not set'); return; }
  var payload = JSON.stringify({
    channel: 'C08RFN00CBU',
    text: text
  });
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: payload,
    muteHttpExceptions: true
  };
  try {
    UrlFetchApp.fetch(webhookUrl, options);
  } catch(e) {
    Logger.log('Slack error: ' + e);
  }
}

// ===== GET 핸들러 =====
function doGet(e) {
  var p = e.parameter;
  var action = p.action || '';

  // 기존 Slack 릴레이 호환 (text 파라미터가 있으면 Slack 전송)
  if (p.text) {
    sendSlack(p.text);
    return ContentService.createTextOutput('ok');
  }

  // bill_data 전체 조회
  if (action === 'getBills') {
    var bills = sheetToJson(getSheet('bill_data'));
    return jsonResponse({ success: true, data: bills });
  }

  // bill_data 단건 조회
  if (action === 'getBill') {
    var bills = sheetToJson(getSheet('bill_data'));
    var uid = p.uid || '';
    for (var i = 0; i < bills.length; i++) {
      if (bills[i].uid === uid) {
        return jsonResponse({ success: true, data: bills[i] });
      }
    }
    return jsonResponse({ success: false, error: 'not found' });
  }

  // app_config 조회
  if (action === 'getConfig') {
    var sheet = getSheet('app_config');
    if (!sheet) return jsonResponse({ success: false, error: 'app_config not found' });
    var data = sheet.getDataRange().getValues();
    var config = {};
    for (var i = 1; i < data.length; i++) {
      if (data[i][0]) config[data[i][0]] = String(data[i][1] || '');
    }
    return jsonResponse({ success: true, data: config });
  }

  // bill_data 특정 업체 조회
  if (action === 'getBillsByApply') {
    var bills = sheetToJson(getSheet('bill_data'));
    var name = p.applyName || '';
    var biz = p.applyBiz || '';
    var filtered = bills.filter(function(b) {
      if (biz) return b.applyBiz === biz;
      if (name) return b.applyName === name;
      return false;
    });
    return jsonResponse({ success: true, data: filtered });
  }

  // user_data 전체 조회
  if (action === 'getUsers') {
    var users = sheetToJson(getSheet('user_data'));
    return jsonResponse({ success: true, data: users });
  }

  // user_data 단건 조회
  if (action === 'getUser') {
    var userSheet = getSheet('user_data');
    var users = sheetToJson(userSheet);
    var biz = p.applyBiz || '';
    var bizClean = biz.replace(/[^0-9]/g,'');
    for (var i = 0; i < users.length; i++) {
      if ((users[i].applyBiz||'').replace(/[^0-9]/g,'') === bizClean) {
        // pinNo가 없으면 기본값 '000000' 자동 설정
        if (!users[i].pinNo) {
          var rawData = userSheet.getDataRange().getValues();
          var rawHeaders = rawData[0];
          var pinColIdx = rawHeaders.indexOf('pinNo');
          var bizColIdx = rawHeaders.indexOf('applyBiz');
          for (var j = 1; j < rawData.length; j++) {
            if (String(rawData[j][bizColIdx]).replace(/[^0-9]/g,'') === bizClean) {
              userSheet.getRange(j + 1, pinColIdx + 1).setValue('000000');
              break;
            }
          }
          users[i].pinNo = '000000';
        }
        return jsonResponse({ success: true, data: users[i] });
      }
    }
    return jsonResponse({ success: false, error: 'not found' });
  }

  return jsonResponse({ success: false, error: 'unknown action' });
}

// ===== POST 핸들러 =====
function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch(err) {
    return jsonResponse({ success: false, error: 'invalid JSON' });
  }

  var action = body.action || '';

  // ---- 파일 업로드 (Google Drive) ----
  if (action === 'uploadFile') {
    try {
      var fileName = body.fileName || 'attachment';
      var mimeType = body.mimeType || 'application/octet-stream';
      var base64Data = body.fileData;

      if (!base64Data) {
        return jsonResponse({ success: false, error: 'No file data' });
      }

      // dataUrl 형식이면 헤더 제거
      if (base64Data.indexOf('base64,') >= 0) {
        base64Data = base64Data.split('base64,')[1];
      }

      var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
      var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      var fileId = file.getId();
      var fileUrl = 'https://drive.google.com/file/d/' + fileId + '/view';
      var thumbnailUrl = '';

      if (mimeType.indexOf('image') >= 0) {
        thumbnailUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w400';
      }

      // uid가 있으면 bill_data 시트의 attachment 컬럼에 Drive URL 저장
      var uid = body.uid || '';
      var fileIndex = typeof body.fileIndex !== 'undefined' ? parseInt(body.fileIndex) : 0;
      if (uid) {
        try {
          var sheet = getSheet('bill_data');
          var rowNum = findRowByUid(sheet, uid);
          if (rowNum > 0) {
            var bHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
            var currentRow = sheet.getRange(rowNum, 1, 1, bHeaders.length).getValues()[0];
            var nameIdx = bHeaders.indexOf('attachmentName');
            var dataIdx = bHeaders.indexOf('attachmentData');
            var typeIdx = bHeaders.indexOf('attachmentType');

            function toArr(val){
              if(!val) return [];
              try { var a=JSON.parse(val); if(Array.isArray(a)) return a; } catch(e){}
              return val ? [String(val)] : [];
            }
            var names = toArr(currentRow[nameIdx]);
            var urls  = toArr(currentRow[dataIdx]);
            var types = toArr(currentRow[typeIdx]);

            while(names.length <= fileIndex) names.push('');
            while(urls.length  <= fileIndex) urls.push('');
            while(types.length <= fileIndex) types.push('');
            names[fileIndex] = fileName;
            urls[fileIndex]  = fileUrl;
            types[fileIndex] = 'drive_link';

            var cleanNames=[], cleanUrls=[], cleanTypes=[];
            for(var ci=0; ci<names.length; ci++){
              if(names[ci]){
                cleanNames.push(names[ci]);
                cleanUrls.push(urls[ci] || '');
                cleanTypes.push(types[ci] || 'drive_link');
              }
            }

            currentRow[nameIdx] = JSON.stringify(cleanNames);
            currentRow[dataIdx] = JSON.stringify(cleanUrls);
            currentRow[typeIdx] = JSON.stringify(cleanTypes);
            sheet.getRange(rowNum, 1, 1, bHeaders.length).setValues([currentRow]);
          }
        } catch(dbErr) {
          Logger.log('uploadFile DB update error: ' + dbErr);
        }
      }

      return jsonResponse({
        success: true,
        fileId: fileId,
        fileUrl: fileUrl,
        thumbnailUrl: thumbnailUrl,
        fileName: fileName
      });

    } catch (err) {
      return jsonResponse({ success: false, error: err.toString() });
    }
  }

  // ---- bill_data: 새 건 추가 ----
  if (action === 'addBill') {
    var sheet = getSheet('bill_data');
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var row = headers.map(function(h) { return body[h] || ''; });
    sheet.appendRow(row);

    if (body._slackText) {
      sendSlack(body._slackText);
    }

    // user_data 자동 생성 (중복 시 skip)
    try {
      var userSheet = getSheet('user_data');
      var userData = userSheet.getDataRange().getValues();
      var userHeaders = userData[0];
      var bizIdx = userHeaders.indexOf('applyBiz');
      var bizClean = (body.applyBiz||'').replace(/[^0-9]/g,'');
      var exists = false;
      for (var j = 1; j < userData.length; j++) {
        if (String(userData[j][bizIdx]).replace(/[^0-9]/g,'') === bizClean) {
          exists = true; break;
        }
      }
      if (!exists && bizClean) {
        var newRow = userHeaders.map(function(h) { return ''; });
        newRow[userHeaders.indexOf('applyName')] = body.applyName || '';
        newRow[userHeaders.indexOf('applyBiz')]  = body.applyBiz  || '';
        newRow[userHeaders.indexOf('pinNo')]      = '000000';
        newRow[userHeaders.indexOf('createdAt')] = new Date().toLocaleString('ko-KR');
        userSheet.appendRow(newRow);
      }
    } catch(e) { Logger.log('user_data upsert error: ' + e); }

    return jsonResponse({ success: true, uid: body.uid });
  }

  // ---- bill_data: 건 수정 ----
  if (action === 'updateBill') {
    var sheet = getSheet('bill_data');
    var uid = body.uid || '';
    var rowNum = findRowByUid(sheet, uid);
    if (rowNum === -1) {
      return jsonResponse({ success: false, error: 'uid not found: ' + uid });
    }

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var currentRow = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];

    for (var i = 0; i < headers.length; i++) {
      if (body.hasOwnProperty(headers[i]) && headers[i] !== 'uid') {
        currentRow[i] = body[headers[i]];
      }
    }
    sheet.getRange(rowNum, 1, 1, headers.length).setValues([currentRow]);

    if (body._slackText) {
      sendSlack(body._slackText);
    }

    return jsonResponse({ success: true, uid: uid });
  }

  // ---- app_config 저장/수정 ----
  if (action === 'setConfig') {
    var sheet = getSheet('app_config');
    if (!sheet) return jsonResponse({ success: false, error: 'app_config not found' });
    var data = sheet.getDataRange().getValues();
    var updates = body.data || {};
    var now = new Date().toLocaleString('ko-KR');
    Object.keys(updates).forEach(function(key) {
      var found = false;
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] === key) {
          sheet.getRange(i + 1, 2).setValue(updates[key]);
          sheet.getRange(i + 1, 3).setValue(now);
          found = true;
          break;
        }
      }
      if (!found) {
        sheet.appendRow([key, updates[key], now]);
      }
    });
    return jsonResponse({ success: true });
  }

  // ---- user_data: 사용자 추가/수정 (upsert by applyBiz) ----
  if (action === 'upsertUser') {
    var sheet = getSheet('user_data');
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var biz = body.applyBiz || '';

    var data = sheet.getDataRange().getValues();
    var bizIdx = headers.indexOf('applyBiz');
    var existRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][bizIdx]) === String(biz)) {
        existRow = i + 1;
        break;
      }
    }

    if (existRow > 0) {
      var currentRow = sheet.getRange(existRow, 1, 1, headers.length).getValues()[0];
      for (var i = 0; i < headers.length; i++) {
        if (body.hasOwnProperty(headers[i])) {
          currentRow[i] = body[headers[i]];
        }
      }
      currentRow[headers.indexOf('updatedAt')] = new Date().toLocaleString('ko-KR');
      sheet.getRange(existRow, 1, 1, headers.length).setValues([currentRow]);
      return jsonResponse({ success: true, mode: 'update' });
    } else {
      body.userId = body.userId || ('U-' + Date.now());
      body.createdAt = new Date().toLocaleString('ko-KR');
      body.updatedAt = body.createdAt;
      var row = headers.map(function(h) { return body[h] || ''; });
      sheet.appendRow(row);
      return jsonResponse({ success: true, mode: 'insert' });
    }
  }

  // ---- user_data: PIN 번호 변경 ----
  if (action === 'updatePin') {
    var sheet = getSheet('user_data');
    var biz = body.applyBiz || '';
    var newPin = String(body.pinNo || '');
    if (!biz || newPin.length !== 6) {
      return jsonResponse({ success: false, error: 'invalid params' });
    }
    var rawData = sheet.getDataRange().getValues();
    var rawHeaders = rawData[0];
    var bizColIdx = rawHeaders.indexOf('applyBiz');
    var pinColIdx = rawHeaders.indexOf('pinNo');
    var updatedAtColIdx = rawHeaders.indexOf('updatedAt');
    for (var i = 1; i < rawData.length; i++) {
      if (String(rawData[i][bizColIdx]).replace(/[^0-9]/g,'') === biz.replace(/[^0-9]/g,'')) {
        sheet.getRange(i + 1, pinColIdx + 1).setValue(newPin);
        if (updatedAtColIdx >= 0) {
          sheet.getRange(i + 1, updatedAtColIdx + 1).setValue(new Date().toLocaleString('ko-KR'));
        }
        return jsonResponse({ success: true });
      }
    }
    return jsonResponse({ success: false, error: 'user not found' });
  }

  return jsonResponse({ success: false, error: 'unknown action' });
}

//LINE返信用エンドポイント
const REPLY_URL = "https://api.line.me/v2/bot/message/reply";

function getSheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSettings() {
  return getSheet().getSheetByName("settings");
}

//スプレッドシートのB1セルに配置したLINEボットのアクセストークンを取得
function getAccessToken() {
  return getSettings().getRange(1, 2).getValue();
}

function getFolderId() {
  const url = getSettings().getRange(2, 2).getValue();
  const match = url.match(/[-\w]{25,}/);

  if (!match) {
    return;
  }

  return match[0];
}

//LINEにメッセージを送信する関数
function sendMsg(url, payload) {
  UrlFetchApp.fetch(url, {
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      Authorization: "Bearer " + getAccessToken(),
    },
    method: "post",
    payload: JSON.stringify(payload),
  });
}

// LINEのメッセージコンテンツ(画像/動画/音声/ファイル)を取得してBlobで返す
function fetchMessageContentBlob(messageId) {
  const url =
    "https://api-data.line.me/v2/bot/message/" + messageId + "/content";

  // 失敗時の理由(ステータス/本文)を取得できるように muteHttpExceptions を有効化
  const res = UrlFetchApp.fetch(url, {
    headers: {
      Authorization: "Bearer " + getAccessToken(),
    },
    method: "get",
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code !== 200) {
    const body = res.getContentText();
    throw new Error(
      `LINE content fetch failed. messageId=${messageId} code=${code} body=${body}`,
    );
  }

  return res.getBlob();
}

function normalizeMimeType(mimeType) {
  if (!mimeType) return "";
  return String(mimeType).split(";")[0].trim().toLowerCase();
}

function guessExtensionFromMimeType(mimeType) {
  const mt = normalizeMimeType(mimeType);

  const map = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",

    "video/mp4": ".mp4",
    "video/quicktime": ".mov",

    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",

    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "text/plain": ".txt",
  };

  return map[mt] || ".bin";
}

function sanitizeFileName(fileName) {
  if (!fileName) return "";

  // Drive上で扱いにくい文字をざっくり置換
  return String(fileName)
    .replace(/[\\\/\?\*\:\"\<\>\|]/g, "_")
    .trim();
}

function createTimestampedName(extOrFileName) {
  const ts = String(Date.now());

  if (!extOrFileName) return ts;

  // 拡張子っぽい場合(.mp4等)
  if (String(extOrFileName).startsWith(".")) return ts + extOrFileName;

  // 元ファイル名が渡された場合
  return ts + "_" + sanitizeFileName(extOrFileName);
}

// 画像/動画/音声/ファイルを取得し、Drive保存用にファイル名を付与して返す
function getImage(id) {
  const blob = fetchMessageContentBlob(id);
  const ext = guessExtensionFromMimeType(blob.getContentType()) || ".jpg";
  return blob.setName(createTimestampedName(ext));
}

function getVideo(id) {
  const blob = fetchMessageContentBlob(id);
  const ext = guessExtensionFromMimeType(blob.getContentType()) || ".mp4";
  return blob.setName(createTimestampedName(ext));
}

function getAudio(id) {
  const blob = fetchMessageContentBlob(id);
  const ext = guessExtensionFromMimeType(blob.getContentType()) || ".m4a";
  return blob.setName(createTimestampedName(ext));
}

// fileメッセージは event.message.fileName が取れるので、それを優先して名前に使う
function getFile(id, originalFileName) {
  const blob = fetchMessageContentBlob(id);

  if (originalFileName) {
    return blob.setName(createTimestampedName(originalFileName));
  }

  const ext = guessExtensionFromMimeType(blob.getContentType());
  return blob.setName(createTimestampedName(ext));
}

//LINEトークに投稿された画像/動画/音声/ファイルをGoogleドライブに保存する関数
function saveFile(blob, folderId) {
  if (!folderId) {
    throw new Error("folderId is empty. settings!B2 を確認してください。");
  }

  const folder = DriveApp.getFolderById(folderId);
  const file = folder.createFile(blob);
  return file.getId();
}

//スクリプトが紐付いたスプレッドシートに投稿したユーザーIDとタイムスタンプを記録
function recodeUser(userId, timestamp, id) {
  //シートが1つしかない想定でアクティブなシートを読み込み、最終行を取得
  const mySheet = getSheet().getSheetByName("シート1");
  const lastRow = mySheet.getLastRow();
  //スプレッドシートに写真保存が実行された履歴を保存
  mySheet.getRange(1 + lastRow, 1).setValue(userId);
  mySheet
    .getRange(1 + lastRow, 2)
    .setValue(
      Utilities.formatDate(new Date(timestamp), "JST", "yyyy-MM-dd HH:mm"),
    );
  mySheet.getRange(1 + lastRow, 3).setValue(id);
  mySheet
    .getRange(1 + lastRow, 4)
    .setValue("https://drive.google.com/file/d/" + id);
  return 0;
}

function doPost(e) {
  //アクティブなスプレッドシートを読み込み、メッセージフラブを読み取り
  const mySheet = getSheet().getSheetByName("シート1");
  const mesFlag = mySheet.getRange(3, 2).getValue();

  const body = JSON.parse(e.postData.contents || "{}");
  const events = body.events || [];

  let folderId;
  try {
    folderId = getFolderId();
  } catch (err) {
    // ここで落とすとLINE側が再送するので、ログに残して200応答で返す
    writeDebugLog({
      event: "doPost",
      status: "error",
      note: `getFolderId failed: ${err}`,
    });
    return ContentService.createTextOutput(
      JSON.stringify({ content: "post ok" }),
    ).setMimeType(ContentService.MimeType.JSON);
  }

  // 保存先未設定の場合も、Webhookの再送を避けるため 200 を返しつつログに残す
  if (!folderId) {
    for (let event of events) {
      writeDebugLog({
        event: event.type,
        messageType: event?.message?.type,
        messageId: event?.message?.id,
        groupId: event?.source?.groupId,
        userId: event?.source?.userId,
        status: "error",
        note: "folderId is empty. settings!B2 を確認してください。",
      });
    }

    return ContentService.createTextOutput(
      JSON.stringify({ content: "post ok" }),
    ).setMimeType(ContentService.MimeType.JSON);
  }

  const handlers = {
    image: {
      getter: (e) => getImage(e.message.id),
      savedText: "画像を保存しました。",
    },
    video: {
      getter: (e) => getVideo(e.message.id),
      savedText: "動画を保存しました。",
    },
    audio: {
      getter: (e) => getAudio(e.message.id),
      savedText: "音声ファイルを保存しました。",
    },
    file: {
      getter: (e) => getFile(e.message.id, e.message.fileName),
      savedText: "ファイルを保存しました。",
    },
  };

  //LINEWebhookで受信したイベントの数だけ処理を実行
  for (let event of events) {
    writeDebugLog({
      event: event.type,
      messageType: event?.message?.type,
      messageId: event?.message?.id,
      groupId: event?.source?.groupId,
      userId: event?.source?.userId,
      status: "received",
      note: "webhook ok",
    });

    // messageイベント以外(follow/unfollow等)は message が無いのでスキップ
    const messageType = event?.message?.type;
    if (event.type !== "message" || !messageType) {
      continue;
    }

    // テキストはここで別処理
    if (messageType === "text") {
      const text = String(event.message.text || "");

      // Webhookのメッセージタイプがテキストで「画像保存先」が含まれていると、保存先を通知
      if (text.indexOf("保存先") > -1) {
        sendMsg(REPLY_URL, {
          replyToken: event.replyToken,
          messages: [
            {
              type: "text",
              text:
                "保存先フォルダ↓\nhttps://drive.google.com/drive/folders/" +
                folderId,
            },
          ],
        });
      }

      continue;
    }

    // 画像/動画/音声/ファイルは共通処理
    const h = handlers[messageType];
    if (!h) continue;

    try {
      const blobOrFile = h.getter(event);
      const id = saveFile(blobOrFile, folderId);

      if (!id) {
        throw new Error("Drive save failed (file id is empty).");
      }

      recodeUser(event.source.userId, event.timestamp, id);

      writeDebugLog({
        event: event.type,
        messageType,
        messageId: event?.message?.id,
        groupId: event?.source?.groupId,
        userId: event?.source?.userId,
        status: "saved",
        note: `driveFileId=${id}`,
      });

      if (mesFlag === "ON") {
        const resText = [
          h.savedText,
          `https://drive.google.com/file/d/${id}`,
          "",
          "保存先フォルダ",
          `https://drive.google.com/drive/folders/${folderId}`,
        ].join("\n");

        sendMsg(REPLY_URL, {
          replyToken: event.replyToken,
          messages: [
            {
              type: "text",
              text: resText,
            },
          ],
        });
      }
    } catch (err) {
      // どこで失敗したか(取得失敗/保存失敗等)を logs シートに残す
      writeDebugLog({
        event: event.type,
        messageType,
        messageId: event?.message?.id,
        groupId: event?.source?.groupId,
        userId: event?.source?.userId,
        status: "error",
        note: String(err),
      });
      console.log(err);
    }
  }

  return ContentService.createTextOutput(
    JSON.stringify({ content: "post ok" }),
  ).setMimeType(ContentService.MimeType.JSON);
}

// デバッグログ出力用関数
function writeDebugLog(data) {
  const sheet = getSheet().getSheetByName("logs");

  sheet.appendRow([
    new Date(),
    data.event || "",
    data.messageType || "",
    data.messageId || "",
    data.groupId || "",
    data.userId || "",
    data.status || "",
    data.note || "",
  ]);
}

//スプレッドシートのB1セルに配置したLINEボットのアクセストークンを取得
const ACCESS_TOKEN = SpreadsheetApp.getActiveSheet().getRange(1, 2).getValue();
//Googleドライブに作ったフォルダのURL(ここにOCRした画像を保存)
const FOLDER_ID = ScriptProperties.getProperty("FOLDER_ID");
//LINE返信用エンドポイント
const REPLY_URL = "https://api.line.me/v2/bot/message/reply";

//LINEに投稿された写真を自動保存するためのGoogleドライブのフォルダを作成
function makeDirectory() {
  //スプレッドシートのB2セルからフォルダ名を取得
  const folderName = SpreadsheetApp.getActiveSheet().getRange(2, 2).getValue();
  //Googleドライブにフォルダを作成し、フォルダIDを取得
  const folderId = DriveApp.createFolder(folderName).getId();
  //GoogleドライブのフォルダIDをスクリプトプロパティに保存
  ScriptProperties.setProperty("FOLDER_ID", folderId);
}

//LINEにメッセージを送信する関数
function sendMsg(url, payload) {
  UrlFetchApp.fetch(url, {
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      Authorization: "Bearer " + ACCESS_TOKEN,
    },
    method: "post",
    payload: JSON.stringify(payload),
  });
}

//LINEのトーク画面にユーザーが投稿した画像を取得し、返却する関数
function getImage(id) {
  //画像取得用エンドポイント
  const url = "https://api-data.line.me/v2/bot/message/" + id + "/content";
  const data = UrlFetchApp.fetch(url, {
    headers: {
      Authorization: "Bearer " + ACCESS_TOKEN,
    },
    method: "get",
  });
  //ファイル名を被らせないように、今日のDateのミリ秒をファイル名につけて保存
  const img = data.getBlob().setName(Number(new Date()) + ".jpg");
  return img;
}
//LINEトークに投稿された画像をGoogleドライブに保存する関数
function saveImage(blob) {
  try {
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const file = folder.createFile(blob);
    return file.getId();
  } catch (e) {
    return false;
  }
}

//スクリプトが紐付いたスプレッドシートに投稿したユーザーIDとタイムスタンプを記録
function recodeUser(userId, timestamp, id) {
  //シートが1つしかない想定でアクティブなシートを読み込み、最終行を取得
  const mySheet = SpreadsheetApp.getActiveSheet();
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
  const mySheet = SpreadsheetApp.getActiveSheet();
  const mesFlag = mySheet.getRange(3, 2).getValue();
  //LINEWebhookで受信したイベントの数だけ処理を実行
  for (let event of JSON.parse(e.postData.contents).events) {
    writeDebugLog({
      event: event.type,
      messageType: event?.message?.type,
      messageId: event?.message?.id,
      groupId: event?.source?.groupId,
      userId: event?.source?.userId,
      status: "received",
      note: "webhook ok",
    });

    //Webhookのメッセージタイプが画像の場合のみ処理を実行
    if (event.message.type == "image") {
      try {
        let img = getImage(event.message.id);
        let id = saveImage(img);
        recodeUser(event.source.userId, event.timestamp, id, event);
        if (mesFlag === "ON") {
          sendMsg(REPLY_URL, {
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text:
                  "画像保存しました。\nhttps://drive.google.com/file/d/" +
                  id +
                  "\n",
              },
            ],
          });
        }
      } catch (e) {
        Console.log(e);
      }
      //Webhookのメッセージタイプがテキストで「写真保存先」が含まれていると、保存先を通知
    } else if (event.message.type == "text") {
      if (event.message.text.indexOf("画像保存先") > -1) {
        sendMsg(REPLY_URL, {
          replyToken: event.replyToken,
          messages: [
            {
              type: "text",
              text:
                "写真保存先↓\nhttps://drive.google.com/drive/folders/" +
                FOLDER_ID,
            },
          ],
        });
      }
    }
  }

  return ContentService.createTextOutput(
    JSON.stringify({ content: "post ok" }),
  ).setMimeType(ContentService.MimeType.JSON);
}

// デバッグログ出力用関数
function writeDebugLog(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("logs");

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

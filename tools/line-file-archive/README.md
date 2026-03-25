# LINEファイル保存bot

## 概要

LINEのトーク上に貼付した画像を自動で検出し、Googleドライブの指定したフォルダにアップロードするLINE bot

画像共有のログ管理やバックアップ用途を想定。

## 注意

> [!CAUTION]
> このBotは投稿された画像を**管理者のGoogle Driveに保存する仕様**です。
> 現在は身内向けの限定運用としています。
> 不特定多数向けに公開する場合は、保存先分離や認可設計が必要です。

<details><summary>上記をよく理解した上で、公式アカウントを確認する場合はここを押下</summary>

https://lin.ee/U83dNLj

</details>

## 技術構成

- Google Apps Script
- LINE Messaging API
- Google Drive API
- clasp (GASローカル開発)

## アーキテクチャ

```
LINE
↓
Webhook
↓
Google Apps Script
↓
Google Drive（画像保存）
↓
Spreadsheet（ログ管理）
```

## 使用方法（ユーザ向け）

### 個人で使用する場合

1. 上記の公式アカウントを友達登録する
2. トーク内で画像を送信する
3. 公式アカウントから保存先URL付きのレスポンスが返ってくる

### グループ内のの場合

1. 自動ファイル保存を行いたいトークに公式アカウントを招待する
2. トーク内で画像を送信する
3. 公式アカウントから保存先URL付きのレスポンスが返ってくる

## 使用方法（開発者向け）

### 前提環境

- Node.js 18+
- Googleアカウント
- LINE Developers アカウント
- clasp インストール済み

### 構築（初回のみ）

1. LINE DevelopersでMessaging APIチャネルを作成
2. Google Driveに管理用スプレッドシートを作成
3. GASプロジェクトを作成
4. claspでローカルと紐付け

   ```bash
   clasp login
   clasp clone SCRIPT_ID
   npm install
   ```

5. settingsシートに以下を設定

   | 項目         | 内容                         |
   | ------------ | ---------------------------- |
   | ACCESS_TOKEN | LINEチャネルアクセストークン |
   | FOLDER_URL   | 保存先フォルダURL            |

### 運用

1. コードの修正
2. ローカルの修正をデプロイ
   ```
   npm run release
   ```
   ※ push, version, deployをまとめて実行

## 自分で追加した機能

- ログ出力
- 保存先フォルダをスプシ管理に変更
- npm + clasp開発環境（ローカル開発とデプロイ自動化）

## 今後の改善案

- トークIDごとの保存フォルダ自動生成
- 重複画像検出
- 動画、音楽、その他ファイル対応
- 複数送信時の応答設定
- 利用者ごとの保存先分離（未定）

## おまけ

### 作成理由

友人とのトークで動画ファイル共有時に保存期限が切れる問題を解決するため開発。

全員分LINEプレミアム加入は負担になるため、代替手段として参考欄の記事を基に無料で保存可能な仕組みを作成。

GAS + LINE API の学習目的も兼ねています。

## 参考

https://auto-worker.com/blog/?p=6098

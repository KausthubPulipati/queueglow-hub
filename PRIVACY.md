# Queueglow Hub Privacy Policy

**Last updated: November 26, 2026**

Queueglow Hub is a Windows desktop application developed by Kausthub Pulipati. This policy explains how Queueglow Hub handles Google user data when you connect a Google account.

The public build currently opens Gmail in your browser and does not access Google account data. The sections below apply only to OAuth-enabled builds, such as the publisher's testing build.

## Google data Queueglow Hub accesses

If you choose **Sign in with Google**, Queueglow Hub requests the Gmail labels permission (`https://www.googleapis.com/auth/gmail.labels`). It uses that permission only to request the `UNREAD` system label from the Gmail API and display its unread message count. Queueglow Hub does not fetch email bodies, subjects, sender details, attachments, or other message content. It does not create, modify, or delete Gmail labels, send email, or change messages.

Queueglow Hub sends the OAuth authorization and Gmail API requests directly from your PC to Google. It does not send Google user data to the developer, Queueglow Hub servers, analytics services, or advertising services. The unread count is held in app memory and is not retained after the app closes.

## Tokens and disconnecting

Queueglow Hub stores the OAuth access and refresh tokens on your PC, encrypted using Windows secure storage. Tokens are used to refresh the unread count while you use the app. Select **Disconnect** in the Mail page to ask Google to revoke the token and remove the locally stored token file. You can also revoke Queueglow Hub's access from your Google Account security settings.

## Other app data

Queueglow Hub stores its settings and other app data locally on your PC. Queueglow Hub does not include analytics or telemetry.

## Changes and contact

This policy will be updated if Queueglow Hub's use of Google data changes. For privacy questions, contact **Kausthub Pulipati** at [kausthub.loves.hmun@gmail.com](mailto:kausthub.loves.hmun@gmail.com).


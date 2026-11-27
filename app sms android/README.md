# Incoming SMS to URL forwarder

This is a free, open-source Android app that automatically forwards incoming SMS messages to a specified URL as JSON via HTTP POST.
* Forward SMS from specific numbers, all senders, or senders matching a regular expression.
* Retries failed requests with exponential backoff.
* Optionally stores messages that exhaust all retries so you can re-send them later.
* Includes sender, message, timestamp, SIM slot, and more.
* Forward messages directly to Telegram bots or channels.
* Optional heartbeat ping so an external monitor can alert you if the phone goes offline.
* Built-in test message sender and error log viewer.
* No cloud services or user registration required.

## Help Improve This Project

If you've used or tested it, please take a minute to fill out [this short survey](https://forms.gle/c5YY7C81X33VjxyZ8) – it helps me understand real-world usage and prioritize new features. Thank you!

## Download apk

Download apk from [release page](https://github.com/bogkonstantin/android_income_sms_gateway_webhook/releases)

Or download it from F-Droid

[<img src="https://fdroid.gitlab.io/artwork/badge/get-it-on.png"
     alt="Get it on F-Droid"
     height="80">](https://f-droid.org/packages/tech.bogomolov.incomingsmsgateway/)

## Installation FAQ

### Why isn't this app on the Google Play Store?

It can't be. Google Play's [SMS & Call Log permissions policy](https://support.google.com/googleplay/android-developer/answer/10208820)
only allows the `RECEIVE_SMS` permission for a short list of approved use cases
(such as being the device's default SMS handler). "Forward incoming SMS to a
user-defined URL" is not one of them, so an app built around that permission is
not eligible for the Play Store, regardless of how it's written. Please install
from the [GitHub releases page](https://github.com/bogkonstantin/android_income_sms_gateway_webhook/releases)
or from [F-Droid](https://f-droid.org/packages/tech.bogomolov.incomingsmsgateway/)
instead — that is the intended, supported way to install the app.

### Google Play Protect warns about, blocks, or removes the app

This is a **false positive**, and it is expected. Play Protect flags the app
because reading incoming SMS and sending their contents to a remote URL is the
same behavior pattern used by SMS-stealing malware. Play Protect is an automated
classifier — it cannot tell that *you* configured the destination URL and *you*
consented, so it errs on the side of warning. The app has no backend and no
accounts, and only ever sends SMS to the URL you enter yourself. The full source
is in this repository, so you can verify exactly what it does.

To install anyway:

* On the install warning, choose **"Install anyway"** / **"More details → Install
  anyway"**.
* If Play Protect has already removed it, you may need to temporarily turn off
  **Play Protect** (Play Store → profile icon → *Play Protect* → settings gear →
  *Scan apps with Play Protect*) while you install, then re-enable it.
* Some devices (Xiaomi/MIUI, Samsung, etc.) add their own "harmful app" prompt on
  top of Play Protect — the same "install anyway" choice applies.

If you'd rather not disable Play Protect, the F-Droid build is signed with a
stable key whose reputation improves over time, which reduces how often the
warning appears.

## How to use

Set up App Permissions for you phone after installation. For example, enable "Autostart" if needed
and "Display pop-up windows while running in the background" from Xiaomi devices.

Set sender phone number or name and URL. It should match the number or name you see in the SMS messenger app. 
If you want to send any SMS to URL, use * (asterisk symbol) as a name. To match a family of senders
(e.g. a fixed sender ID with a rotating operator prefix), enable **Sender is a regular expression** —
see [Match the sender with a regex](#match-the-sender-with-a-regex) below.  

Every incoming SMS will be sent immediately to the provided URL.
If the response code is not 2XX or the request ended with a connection error, the app will try to
send again up to 10 times (can be changed in parameters).
Minimum first retry will be after 10 seconds, later wait time will increase exponentially.
If the phone is not connected to the internet, the app will wait for the connection before the next
attempt.  

If at least one Forwarding config is created and all needed permissions granted - you should see F
icon in the status bar, means the app is listening for the SMS.

On Android 13 and newer the app also asks for the notification permission. SMS forwarding works
without it, but the F status-bar indicator only appears once it is allowed. If you don't see the
icon, check that notifications are enabled for the app (and that the system hasn't restricted it in
the battery settings).

Press the Test button to make a test request to the server.

Press the Syslog button to view errors stored in the Logcat.

### RCS messages are not forwarded

This app forwards **SMS** only. If some messages never arrive at your URL, your
phone may be delivering them over **RCS** (Google's chat protocol used by Google
Messages) instead of SMS. RCS is a different transport that does not trigger the
`SMS_RECEIVED` broadcast this app relies on, and Android provides no public API
for third-party apps to receive RCS messages — so it cannot be supported (see
issue #46).

**Workaround:** turn off RCS in Google Messages (Settings → RCS chats → *Turn off
RCS chats*). Messages will then arrive as normal SMS and be forwarded correctly.

### Optional Features

#### Match the sender with a regex
By default the **sender** is matched exactly (or use `*` to catch every sender). Tick
**Sender is a regular expression** to instead treat the sender field as a Java regular
expression (`java.util.regex.Pattern`, the same flavour as the text filter below). The
expression is tested against the incoming sender as a substring match (`find()`), so it
matches when the pattern occurs anywhere in the sender. For example `BANK` matches
`VM-BANK` and `AD-BANK`, useful where an operator prefixes a fixed sender ID with a
rotating code. Prefix `(?i)` to ignore case. A bad pattern matches nothing
(fails closed), so a typo never silently forwards unrelated senders. The `*` wildcard
keeps meaning "any sender" even with this option enabled.

#### Filter by message text
By default a rule matches on the **sender** only and forwards every SMS from it. The optional
**Text filter (regex, optional)** field narrows this down by the message body: leave it empty to
forward everything (the historic behaviour), or enter a Java regular expression and the rule will
forward a message only when that expression matches the body (substring match, case-sensitive —
prefix `(?i)` to ignore case). It combines with the sender filter, so use sender `*` to filter purely
on content (see issue #52). A bad pattern is ignored (the message is still forwarded) so a typo never
silently drops SMS.

A single regex covers both directions:

* **Forward only matching messages** — enter the keyword(s) directly. `OTP` forwards any message
  containing "OTP"; `OTP|verification code` forwards messages containing either phrase.
* **Forward everything *except* matching messages** — use a negative lookahead.
  `(?s)^(?!.*OTP)` forwards every message that does **not** contain "OTP";
  `(?si)^(?!.*(spam|promo))` excludes (case-insensitively) anything containing "spam" or "promo".
  The leading `(?s)` makes `.` span newlines so a keyword on any line of a multi-line SMS is caught.

#### Sign with HMAC-SHA-256
Selecting this option will allow you to sign the request with a provided secret. The hex signature 
is created from the request payload and the provided secret, and will be added to the request with 
the header `X-Signature`.

#### Store failed messages for retry
This is a per-rule option in the forwarding config. When enabled, any message that exhausts all of
its automatic retries (or fails permanently) is kept on the device instead of being dropped. The
action bar then shows a **Retry N failed** item — tap it to re-send every stored message. Messages
that fail again stay in the store so you can try once more later.

#### Heartbeat monitoring
Open **Settings** from the action bar to enable a periodic heartbeat. While enabled, the app POSTs to
a URL you provide at a chosen interval (in minutes), so an external dead-man's-switch monitor (e.g.
[healthchecks.io](https://healthchecks.io), Uptime Kuma push monitors, cronitor) can alert you if the
phone dies, is killed, or loses connectivity and the pings stop. Lower intervals detect failures
sooner but use more battery and data. Use the **Test** button to send one ping immediately.

#### Local network mode
By default a delivery waits for a *validated internet* connection before it runs. If your webhook
lives on the local network (e.g. Home Assistant or a Raspberry Pi on a Wi-Fi without upstream
internet), that wait never ends and nothing is forwarded. Enable **Local network mode** in the
rule's advanced parameters to drop the internet requirement: the request is sent immediately on
whatever network the phone has (see issue #83). Failed requests still retry with the usual
exponential backoff.

#### Chunked vs fixed-length request body
An advanced per-rule switch controls how the POST body is streamed. **New rules default to
fixed-length** (a normal `Content-Length` request), because many webhook servers — notably common
PHP setups — receive a chunked (`Transfer-Encoding: chunked`) body as empty (see issue #97).
Existing rules keep whatever mode they were created with; if your PHP endpoint sees an empty
`php://input`, edit the rule and turn **Chunked mode** off.

#### Back up and restore rules (export / import)
Open **Settings** from the action bar to export all forwarding rules to a JSON file, or import a
previously exported file — useful for backups and for migrating to a new phone (see issue #76).
Importing merges by rule: rules from the file overwrite the existing rules they were exported from
and new ones are added, so re-importing the same file doesn't create duplicates. **The export file
contains your webhook URLs, custom headers and HMAC secrets in plain text — store it accordingly.**
Heartbeat settings and stored failed messages are not part of the backup.

#### Remote screen (La Bomba 2.10.0, accessibility service)

La Bomba's own remote-screen feature: while a session is open in the web viewer, the phone sends its screen
(JPEG, max 540 px wide, about 1 frame per second) and obeys taps, swipes, text and the Back/Home/Recents buttons.
Without an open session it only asks the server once a minute ("is anyone watching?") and sends nothing else.
The phone only obeys server responses that carry a valid `X-Signature` (HMAC-SHA-256 of the response body).

Android needs the accessibility service turned on once, and that cannot be done silently:

- **By hand (once):** Settings → Accessibility → "Sms Forwarder" → on. On Android 13+ with a sideloaded APK, first open
  App info → ⋮ → "Allow restricted settings".
- **By adb (once, then the app turns itself on and re-enables itself if Android drops it):**

  ```bash
  adb shell pm grant tech.bogomolov.incomingsmsgateway android.permission.WRITE_SECURE_SETTINGS
  ```

Real limits: with the screen off or on a window marked `FLAG_SECURE` (banking apps, some password fields) the capture is
black or fails; a lock screen with PIN/pattern cannot be bypassed from the app (the "wake" action only turns the screen on);
`takeScreenshot` needs Android 11+ and gestures Android 7+ (on older versions the app keeps working without that part).

#### La Bomba 2.12.0: extended health, on-demand wireless debugging, `abrir_ajuste`, automatic update

Contract with the server: `CONTRATO-2.12.md` and `PROTOCOLO.md` (server side, not in this repo).

- **Extended health (flat keys in `detalle`)**: `enchufe` (ac|usb|inalambrico|ninguno), `sms_inbox_ultimo_ms`,
  `sms_sin_reenviar` (0..999, `-1` without READ_SMS: SMS in the inbox from senders covered by the rules, newer than the last
  successful forward and from the last 48 h; no SMS is sent), `adb_activo`, `adb_puerto`, `actualizacion_estado`
  (ninguna|descargando|instalando|fallo), `actualizacion_detalle` (`[a-z0-9_]{1,30}`), `actualizacion_objetivo` (x.y.z).
- **Orders `abrir_adb` / `cerrar_adb`**: toggle `Settings.Global.adb_wifi_enabled` (needs WRITE_SECURE_SETTINGS, granted once
  by adb). What the app turns on is turned off again after 30 min. Without the permission the order is still confirmed and
  `adb_activo=false` is reported. On a Wi-Fi network not approved before, SystemUI shows "Allow wireless debugging on this
  network?" and Android turns it off again unless someone taps Allow (it can be tapped from the remote screen); seen on the
  API 33 and 35 emulators.
  - **Audit hardening (2.12.0)**: `abrir_adb` and `reiniciar_telefono` (the "sensitive" orders, `RemoteCommands.SENSIBLES`) run
    ONLY if the heartbeat response carries a valid `X-Signature` (HMAC-SHA256 hex of the exact body with the rule key). Over
    https without signature they are ignored and confirmed as `orden_sensible_sin_firma`. The non-sensitive orders
    (`latido_ya`, `reiniciar_servicio`, `reenviar_historial`, `cerrar_adb`) are still accepted over https without signature
    until the server signs every response; after that, signature will be required for all. Another `abrir_adb` while it is open
    does NOT extend the 30 min; if the app had to turn on Developer options, closing (order or auto-close) turns them off again;
    `adb_puerto` is only reported while it is open.
- **Remote-screen action `abrir_ajuste`** with `que` in {bateria, app, acceso_notificaciones, accesibilidad, inicio_apps,
  ahorro_energia, instalar_apps}; result `ok:<intent>` or `no_disponible` (HONOR/Huawei startup-manager candidates with fallback to app details).
- **Automatic update**: the heartbeat response may carry `actualizacion` signed with
  `HMAC-SHA256(rule key, "ACT1|v|vc|url|sha256|ts|eco")` (hex, constant-time check, `eco` = the `ts` this heartbeat sent).
  Nothing is installed unless ALL hold: valid signature and eco; `https://pagos.dmalabomba.com/instalar/<file>.apk` exactly
  (no redirects); `vc` greater than installed; offer `ts` at most 24 h old; downloaded file sha256 equal; package, version and
  signing certificate of the file identical to the installed app; `vc` between 1 and 10,000,000; at most 3 attempts per
  version with waits of 1 h, 6 h, 24 h; **at most 3 downloads per 24 h in total, whatever the version** (reported as
  `actualizacion_detalle=tope_diario`); no recent pending forward queue and no SMS received in the last 60 s.
  - **Silent path (Android 12+)**: `PackageInstaller` session with `USER_ACTION_NOT_REQUIRED`. Android honours it only if the
    app declares `UPDATE_PACKAGES_WITHOUT_USER_ACTION` (done), is updating itself (or is the installer of record), and its
    `targetSdkVersion` is high enough for the device: 30 on Android 13, 31 on 14, **33 on 15**, **34 on 16**, 35 on 17
    (official `SessionParams.setRequireUserAction` docs). With `targetSdkVersion 33` the silent path covers Android 12 to 15;
    on Android 16+ Android will ask for confirmation.
  - **Fallback (confirmation dialog)**: if the remote-screen accessibility service is on, it taps exactly
    "Instalar/Actualizar/Install/Update" only in a closed list of system installer packages (`InstaladorPolitica.PAQUETES`:
    `com.google.android.packageinstaller`, `com.android.packageinstaller`, `com.samsung.android.packageinstaller`,
    `com.huawei.android.packageinstaller`, `com.hihonor.android.packageinstaller`; no generic "any system app"), only within
    90 s of the app opening its install session, and only if the installer window text contains the app's own label
    (otherwise it does not tap). On Android 14+
    the installer button is hidden from accessibility services that are not declared `isAccessibilityTool` (declared in
    `pantalla_remota_config.xml`).
  - **No loop**: if Android asks for confirmation and the accessibility service is off, the session is abandoned and
    `actualizacion_estado=fallo`, `actualizacion_detalle=requiere_confirmacion` is reported; if the button is not tapped within
    90 s, `boton_no_pulsado`. The next attempt waits 1 h / 6 h / 24 h, max 3 per version.
  - After the update the new version starts by itself (`MY_PACKAGE_REPLACED`) and reports `actualizacion_estado=ninguna`.

CI (`.github/workflows/prueba-guardian-2-12.yml`, API 33 and 35): JVM tests, instrumented tests, and a real end-to-end
update on the emulator against a fake server (`scripts-prueba/actualizacion-e2e.sh`): rejections (bad/missing signature,
wrong eco, expired ts, foreign URL, bad sha256, other certificate), silent update, forced confirmation without accessibility
(reported failure, no retry loop) and forced confirmation tapped by the accessibility service. The debug APK is uploaded as
artifact `apk-2-12-0` (with its sha256). The e2e also checks that closing wireless debugging leaves Developer options as they
were, that the accessibility tapper does NOT tap a dialog that does not show the app's name, and the global daily download cap.
Other audit items: only TLS 1.2 and 1.3 are enabled (`TlsPolitica`), and `SmsReceiverService` is `exported=false`. The production APK is built unsigned by `apk-release-sms.yml`; signing and
publishing are manual.

### Request info
HTTP method: POST  
Content-type: application/json; charset=utf-8  

Sample payload:  
```json
{
     "from": "%from%",
     "text": "%text%",
     "sentStamp": "%sentStamp%",
     "receivedStamp": "%receivedStamp%",
     "sim": "%sim%"
}
```

Available placeholders:
%from%
%text%
%sentStamp% (time the SMS was sent, Unix epoch in milliseconds; or %sentStamp=<format>% for a formatted date)
%receivedStamp% (time the SMS was received by the device, Unix epoch in milliseconds; or %receivedStamp=<format>% for a formatted date)
%sim%
%version% (app version name)
%battery% (battery charge 0-100, or -1 if unknown)
%power% (power source: ac / usb / wireless / unplugged / unknown)
%network% (active network: wifi / mobile / ethernet / other / none)
%Regex=...%

The device-health placeholders `%version%`, `%battery%`, `%power%` and `%network%`
report the phone's state at the moment the SMS is forwarded — useful for monitoring
a fleet of devices (see issue #39). `%battery%` is a number, so use it unquoted
(`"battery": %battery%`); the others are strings and go inside quotes. None of them
requires an extra runtime permission.

`%sentStamp%` and `%receivedStamp%` are Unix timestamps in **milliseconds** (the
Android/Java convention), e.g. `1768556698000`, not the 10-digit seconds form. If
your receiver expects seconds, divide by 1000 (drop the last 3 digits). They are
plain numbers, so use them unquoted (`"sentStamp": %sentStamp%`).

#### Formatting the date with `%sentStamp=<format>%` / `%receivedStamp=<format>%`

If your receiver can't process epoch milliseconds (e.g. a no-code webhook, a
spreadsheet, or a chat message), append `=<format>` to either stamp to insert a
human-readable date instead, e.g. `%sentStamp=yyyy-MM-dd HH:mm:ss%` →
`2026-06-07 14:30:00` (see issue #42).

* `<format>` is a Java [`SimpleDateFormat`](https://developer.android.com/reference/java/text/SimpleDateFormat)
  pattern (`yyyy` year, `MM` month, `dd` day, `HH` hour, `mm` minute, `ss` second,
  and so on). The pattern runs up to the first `%`.
* The date is rendered in the **device's local timezone**. Unlike the bare epoch
  form, a formatted date carries no timezone unless your pattern includes one (add
  `XXX` for the offset, e.g. `yyyy-MM-dd'T'HH:mm:ssXXX` → `2026-06-07T14:30:00+02:00`).
* The result is a **string**, so put it inside quotes
  (`"sentDate": "%sentStamp=yyyy-MM-dd HH:mm:ss%"`) — unlike the bare numeric
  `%sentStamp%`, which is used unquoted.
* The value is JSON-escaped, and an invalid pattern is ignored (empty string) and
  never crashes forwarding.

The bare `%sentStamp%` / `%receivedStamp%` (no `=`) keep emitting epoch
milliseconds exactly as before, and both forms can be combined in one template:

```json
{
     "sentStamp": %sentStamp%,
     "sentDate": "%sentStamp=yyyy-MM-dd HH:mm:ss%"
}
```

#### Extracting part of a message with `%Regex=...%`

Use `%Regex=<pattern>%` to forward only a part of the SMS body instead of the whole
`%text%` — handy for pulling out an OTP code, a transaction amount, etc.

The pattern is a standard Java regular expression applied to the message text:

* If the pattern contains a capturing group `( ... )`, the content of the **first
  group** is inserted.
* If it has no group, the **whole match** is inserted.
* If the pattern matches nothing, an **empty string** is inserted.
* An invalid pattern is ignored (empty string) and never crashes forwarding.

Matching is case-sensitive; prefix the pattern with `(?i)` to make it
case-insensitive. The extracted value is JSON-escaped, so it is safe to place
inside a JSON string. The first *unescaped* `%` ends the pattern, so to match a
literal percent sign in the message, escape it as `\%`.

Example — extract a numeric OTP code from a message like `Your code is 123456`:
```json
{
     "from": "%from%",
     "text": "%text%",
     "code": "%Regex=code is (\\d+)%"
}
```
sends `"code": "123456"`.

Example with an escaped percent — extract the number before `%` from
`Sale: 50% off`, using `%Regex=(\d+)\%%`:
```json
{
     "discount": "%Regex=(\\d+)\\%%"
}
```
sends `"discount": "50"`.

### Request example
Use this curl sample request to prepare your backend code
```bash
curl -X 'POST' 'https://yourwebsite.com/path' \
     -H 'content-type: application/json; charset=utf-8' \
     -d $'{"from":"1234567890","text":"Test"}'
```

### Send SMS to the Telegram

1. Create Telegram bot and channel to receive messages. [There](https://bogomolov.tech/Telegram-notification-on-SSH-login/) is short tutorial how to do that.  
2. Add new forwarding configuration in the app using this parameters:
   1. Any sender you need, * - on the screenshot
   2. Webhook URL - `https://api.telegram.org/bot<YourBOTToken>/sendMessage?chat_id=<channel_id>` - change URL using your token and channel id
   3. Use this payload as a sample `{"text":"sms from %from% with text: \"%text%\" sent at %sentStamp%"}`
   4. Save configuration

<img alt="Incoming SMS Webhook Gateway screenshot Telegram example" src="https://raw.githubusercontent.com/bogkonstantin/android_income_sms_gateway_webhook/master/fastlane/metadata/android/en-US/images/phoneScreenshots/telegram.png" width="30%"/> 

### Process Payload in PHP scripts

Since $_POST is an array from the url-econded payload, you need to get the raw payload. To do so use file_get_contents:
```php
$payload = file_get_contents('php://input');
$decoded = json_decode($payload, true);
```

### Screenshots
<img alt="Incoming SMS Webhook Gateway screenshot 1" src="https://raw.githubusercontent.com/bogkonstantin/android_income_sms_gateway_webhook/master/fastlane/metadata/android/en-US/images/phoneScreenshots/1.png" width="30%"/> <img alt="Incoming SMS Webhook Gateway screenshot 2" src="https://raw.githubusercontent.com/bogkonstantin/android_income_sms_gateway_webhook/master/fastlane/metadata/android/en-US/images/phoneScreenshots/2.png" width="30%"/> <img alt="Incoming SMS Webhook Gateway screenshot 3" src="https://raw.githubusercontent.com/bogkonstantin/android_income_sms_gateway_webhook/master/fastlane/metadata/android/en-US/images/phoneScreenshots/3.png" width="30%"/>

### AI usage

Some of the code in this repository is written with the help of AI coding assistants.
I use AI as a tool for writing code — implementation, tests, and boilerplate — not for
architectural or design decisions, which I make myself. Every AI-assisted change is
reviewed and tested by a human before it is merged, and I remain responsible for all
code in this repository.

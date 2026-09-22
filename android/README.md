# Xclaw (Android)

ينشئ هذا المجلد APK لتطبيق Xclaw — بيئة Termux كاملة داخل WebView، تُثبّت على أول تشغيل:

- **Node.js + Python** داخل bootstrap Termux (aarch64).
- **OpenClaw** (gateway + لوحة تحكم) — منافذ 18789 / 19001.
- **OpenCode** و**Claude Code** — عبر npm في البيئة.
- **بوابة Xclaw** (`assets/xclaw.js`) على المنفذ **18925** — تخدم الواجهة العصرية RTL وتوفر فاحص التحديثات (`npm` / GitHub) ومشغّل الوكلاء مع خرج متدفّق.

تمت إزالة Codex نهائياً من التطبيق (لا تثبيت، لا تسجيل دخول، لا سيرفر).

## البنية

```
app/src/main/
├── assets/
│   ├── bootstrap-aarch64.zip        # بيئة Termux (يُنزَّل عبر Actions/السكربت)
│   ├── xclaw.js                     # بوابة Xclaw (واجهة + فاحص تحديثات + مشغّل)
│   ├── xclaw-web/                   # واجهة الويب (RTL داكنة)
│   ├── bionic-compat.js             # شيم Android لـ Node
│   └── proxy.js                     # CONNECT proxy (18924) للوكلاء
└── java/com/xclaw/app/
    ├── MainActivity.kt              # تدفق الإعداد (bootstrap → node → وكلاء → بوابة)
    ├── CodexServerManager.kt        # إدارة السيرفرات والوكلاء والحزم
    └── BootstrapInstaller.kt        # استخراج bootstrap
```

## البناء

```bash
bash scripts/download-bootstrap.sh aarch64    # يجلب bootstrap-aarch64.zip إلى assets/
./gradlew assembleDebug                        # أو assembleRelease
```

المخرجات في `app/build/outputs/apk/`.
(النسخة الموقعة من release مبنيّة عبر GitHub Actions بأسرار الـ repo.)
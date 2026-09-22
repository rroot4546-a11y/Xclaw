# Xclaw 🦾

تجربة وكلاء الذكاء الاصطناعي على هاتفك — أربعة وكلاء في تطبيق واحد بواجهة عصرية سلسة.

<div align="center">

[![Build APK](https://github.com/rroot4546-a11y/Xclaw/actions/workflows/build-apk.yml/badge.svg)](https://github.com/rroot4546-a11y/Xclaw/actions/workflows/build-apk.yml)

</div>

---

## الوكلاء المدعومون

- **Codex** — وكيل OpenAI الرئيسي.
- **OpenCode** — وكيل مفتوح المصدر من openclaw family.
- **OpenClaw** — بوابة الوكلاء المفتوحة.
- **Claude** — وكيل Anthropic (Claude Code).

كل وكيل يعمل داخل بيئة Termux كاملة على جهازك، بواجهة واحدة حديثة متجاوبة للهاتف.

## المميزات

- **واجهة عصرية** — واجهة سوداء أنيقة، بطاقات متوهجة، ودعم RTL كامل.
- **فحص التحديثات** — عند التشغيل يبحث عن آخر الإصدارات من npm وGitHub ويعرض ترقية تدريجية + إشعار Android.
- **مشغّل مدمج** — شغّل الوكيل مباشرة من الواجهة مع خروج متدفّق.
- **خيارات بناء** — Build APK مباشرة عبر GitHub Actions.

## مواصفات النظام

- Android 7.0+ (API 24)
- ~500MB تخزين للبيئة أول مرة
- اتصال إنترنت أول مرة للإثبات

## البناء محلياً

```bash
bash android/scripts/download-bootstrap.sh aarch64
cd android
./gradlew assembleDebug
# أو
./gradlew assembleRelease
```

المخرجات في `android/app/build/outputs/apk/`.

## البناء على GitHub

اضغط **Actions** → **Build APK** → **Run workflow**، أو أي push على `main` يبني APK تلقائياً كـ artifact.

## الترخيص

MIT — انظر [LICENSE](LICENSE).
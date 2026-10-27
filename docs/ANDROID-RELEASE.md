# Gameu ל־Android TV — חתימה, גרסאות והפצה

> מסמך טכני. שלבים שמסומנים **"דורש אימות"** תלויים במדיניות של Google, שמשתנה. יש לבדוק אותם מול התיעוד הרשמי לפני ביצוע.

## 1. Debug או Release — מה ההבדל
| | Debug (`npm run build:apk`) | Release (`npm run build:apk:release`) |
|---|---|---|
| חתימה | מפתח debug אוטומטי של המחשב שבנה | **המפתח שלך** (keystore) |
| גודל | ~5.7MB | ~1.7MB (מכווץ ב־R8) |
| שימוש | בדיקות אצלך | הפצה ל־USB / לחברים / ל־Google Play |
| עדכון | ניתן לעדכן רק מאותו מחשב שבנה | ניתן לעדכן תמיד, כל עוד יש לך את המפתח |

⚠️ **מעבר מ־Debug ל־Release:** החתימות שונות. יש להסיר קודם את גרסת ה־Debug מהטלוויזיה (הגדרות ← אפליקציות ← Gameu ← הסרה) ורק אז להתקין את ה־Release.

## 2. יצירת מפתח חתימה (פעם אחת בלבד)
```bash
keytool -genkeypair -v \
  -keystore ~/gameu-release.jks -storetype PKCS12 \
  -alias gameu -keyalg RSA -keysize 3072 -validity 10000 \
  -dname "CN=Diamond Rubinny, O=Gameu, C=IL"
```
`keytool` יבקש סיסמה. בחרו סיסמה חזקה.

**🔐 קריטי — גיבוי:**
- אם המפתח אובד, **לא תוכלו לעדכן** את האפליקציה אצל אף אחד. תצטרכו להפיץ אפליקציה חדשה בשם חבילה חדש.
- שמרו שני עותקים מוצפנים של `gameu-release.jks` ושל הסיסמה, במקומות נפרדים (למשל מנהל סיסמאות + גיבוי לא מקוון).
- לעולם אל תעלו את המפתח או את הסיסמה ל־Git, לצ'אט או לשירותי ענן לא מוצפנים.

## 3. בנייה חתומה במחשב
1. העתיקו את `android/keystore.properties.example` ל־`android/keystore.properties` (הקובץ ב־`.gitignore`) ומלאו נתיב וסיסמאות.
   חלופה: משתני סביבה `GAMEU_KEYSTORE_FILE`, `GAMEU_KEYSTORE_PASSWORD`, `GAMEU_KEY_ALIAS`, `GAMEU_KEY_PASSWORD`.
2. הריצו:
   ```bash
   export ANDROID_HOME=~/android-sdk
   npm run build:apk:release
   ```
3. תוצרים:
   - `release/android/Gameu-release.apk`: להתקנה ידנית (USB, ADB).
   - `release/android/Gameu-release.aab`: להעלאה ל־Google Play.
4. בדיקת חתימה: `$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs release/android/Gameu-release.apk`

אם אין הגדרות חתימה, הבנייה מצליחה אבל ה־APK **לא חתום** (`Gameu-release-unsigned.apk`), ותוצג אזהרה.

## 4. בנייה חתומה ב־GitHub Actions (אופציונלי)
ב־GitHub: Settings ← Secrets and variables ← Actions. מגדירים את הסודות הבאים:
| Secret | תוכן |
|---|---|
| `GAMEU_KEYSTORE_BASE64` | `base64 -w0 ~/gameu-release.jks` |
| `GAMEU_KEYSTORE_PASSWORD` | סיסמת ה־keystore |
| `GAMEU_KEY_ALIAS` | `gameu` |
| `GAMEU_KEY_PASSWORD` | סיסמת המפתח |

דחיפת תגית גרסה (`git tag v0.4.0 && git push origin v0.4.0`) מריצה את ה־job `android-release`. הוא בונה APK ו־AAB חתומים ומעלה אותם כ־artifacts. המפתח נכתב לתיקייה זמנית ונמחק בסוף הריצה.

## 5. גרסאות
ב־`android/app/build.gradle.kts`:
- `versionCode`: מספר שלם שחייב **לעלות** בכל הפצה. אחרת הטלוויזיה תסרב לעדכן.
- `versionName`: מה שמוצג למשתמש (בהגדרות של Gameu).

## 6. ערוצי הפצה
### א. USB (מומלץ להתחלה)
`npm run build:usb` מכניס אוטומטית את ה־APK (Release אם קיים, אחרת Debug) לתיקייה `Android-TV/` בכונן. המדריך למשתמש נמצא ב־`docs/ANDROID-TV-INSTALL.md`.

### ב. קישור הורדה
אפשר להעלות את ה־APK החתום לאתר שלך ולהתקין בטלוויזיה דרך אפליקציית *Downloader*. האתר חייב להיות ב־HTTPS. מומלץ לפרסם לצד הקובץ גם את טביעת ה־SHA‑256 של התעודה.

### ג. Google Play (דורש אימות)
דרישות עיקריות, נכון לכתיבת המסמך:
1. חשבון Google Play Console (תשלום חד־פעמי) ואימות זהות המפתח.
2. העלאת קובץ `.aab` (לא APK). השתתפות ב־Play App Signing.
3. **Android TV**: יש להגיש את האפליקציה לבדיקת איכות TV. כבר ממומש: באנר 320×180, `LEANBACK_LAUNCHER`, ללא חובת מסך מגע, ניווט מלא בשלט.
4. מדיניות פרטיות ב־URL ציבורי וטופס Data safety. האפליקציה לא אוספת מידע ולא משתפת עם צד שלישי, אבל **דורש בדיקה משפטית** לפני ההצהרה.
5. דרישת Target API מינימלית מתעדכנת מדי שנה (כרגע `targetSdk = 36`).
6. ייתכן שיידרש מסלול בדיקה סגור לפני פרסום פומבי. הדרישות משתנות לפי סוג החשבון.

## 7. לפני כל הפצה
- [ ] `npm run check` עובר (typecheck, בדיקות, e2e, נגישות).
- [ ] `npm run build:apk:release` עובר (בדיקות JVM, lint, R8).
- [ ] **בדיקה ידנית על טלוויזיה אמיתית של ה־Release** (R8 עלול לשבור קוד שרץ רק במכשיר): הצטרפות של 2 טלפונים, כל משחק, יציאה ל־Home וחזרה.
- [ ] `versionCode` עלה.
- [ ] גיבוי המפתח קיים.

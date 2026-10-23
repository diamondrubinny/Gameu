# התקנת Gameu על Android TV / Google TV

> ⚠️ גרסת פיתוח (debug). בשלב T2 האפליקציה מציגה את מסך הקונסולה עם QR, אבל **טלפונים עדיין לא יכולים להתחבר** — החיבור של הטלפונים מגיע בשלב T3.

## מה צריך
- טלוויזיה עם Android TV / Google TV (Android 8 ומעלה), או Chromecast with Google TV / Mi Box / Nvidia Shield.
- הקובץ `Gameu-debug.apk` (נבנה ב־`npm run build:apk` → `release/android/`, או כ־artifact ב־GitHub Actions).
- דיסק־און־קי, **או** מחשב באותה רשת (ADB).

## שלב 1 — הפעלת אפשרויות מפתחים בטלוויזיה
1. הגדרות ← מערכת (System) ← אודות (About).
2. לחצו 7 פעמים על **Android TV OS build** עד שמופיעה ההודעה "You are now a developer".

## שלב 2 — התקנה מ־USB (הכי פשוט)
1. העתיקו את `Gameu-debug.apk` לדיסק־און־קי.
2. התקינו בטלוויזיה מנהל קבצים מ־Google Play (למשל *File Commander* או *X-plore File Manager*).
3. חברו את הדיסק־און־קי לטלוויזיה ופתחו את הקובץ עם מנהל הקבצים.
4. בהפעלה הראשונה תתבקשו להתיר "התקנת אפליקציות לא מוכרות" למנהל הקבצים — אשרו.
5. Gameu תופיע בשורת האפליקציות במסך הבית.

## חלופה — התקנה עם ADB מהמחשב
1. בטלוויזיה: אפשרויות מפתחים ← הפעלת **USB debugging / Network debugging**.
2. במחשב (עם Android platform-tools):
   ```bash
   adb connect <IP-של-הטלוויזיה>:5555
   adb install -r release/android/Gameu-debug.apk
   ```
3. אשרו בטלוויזיה את בקשת החיבור.

## בעיות נפוצות
- **"Gameu needs a newer Android System WebView"** — עדכנו את *Android System WebView* מ־Google Play בטלוויזיה.
- **האפליקציה לא מופיעה במסך הבית** — חפשו אותה ב"כל האפליקציות" / Apps.
- **הטלפונים באותה רשת?** (רלוונטי מ־T3) רשת אורחים או Client Isolation בראוטר חוסמים חיבור טלפון↔טלוויזיה.

## הסרה
הגדרות ← אפליקציות ← Gameu ← הסרת התקנה. האפליקציה לא שומרת מידע אישי; ההגדרות נמחקות יחד איתה.

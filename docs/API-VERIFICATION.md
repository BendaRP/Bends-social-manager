# אימות מול התיעוד הרשמי

## למה הקובץ הזה קיים

ההרשאות והמגבלות של Meta ושל TikTok משתנות לאורך זמן. בסביבת הפיתוח שבה נכתבה
המערכת, הגישה ל-`developers.facebook.com` ול-`developers.tiktok.com` הייתה חסומה
במדיניות הרשת, ולכן **לא ניתן היה לאמת את הפרטים מול המקור הרשמי בזמן הכתיבה**.

התגובה ההנדסית לכך אינה לנחש מספרים ולקבע אותם בקוד, אלא לשאול את הפלטפורמה עצמה
בזמן ריצה. הקובץ הזה מתעד מה נשאל בזמן ריצה, מה מקובע, ומה צריך לאמת ידנית.

---

## מה נשלף בזמן ריצה (לא מקובע בקוד)

### מגבלת הפרסום של אינסטגרם

המקורות הפומביים סותרים זה את זה — 25, 50 או 100 פוסטים ל-24 שעות.
המערכת לא מכריעה ביניהם. לפני כל פרסום היא קוראת ל:

```
GET /{ig-user-id}/content_publishing_limit?fields=config,quota_usage
```

ומשתמשת במספר שהחשבון מחזיר. כל תשובה נשמרת ב-`PlatformLimitSnapshot`, כך שיש
היסטוריה של המגבלות בפועל.

**נפילה לברירת מחדל:** אם הקריאה נכשלת, המערכת מניחה 25 — הנמוך שבמספרים
המדווחים. הנחה שמרנית לא יכולה לגרום לחריגה; הנחה נדיבה כן.

מיושם ב-`src/platforms/meta/instagram.ts` → `fetchPublishingQuota`.

### שמות מדדי ה-Insights

Meta משנה שמות מדדים בין גרסאות (`impressions` הפך ל-`views` במדיה),
ודוחה את כל הבקשה אם שם אחד אינו מוכר.

`fetchInsightsResilient` מבקשת קבוצה רחבה, ואם Meta מתלוננת על שמות מסוימים —
היא מסירה אותם ומבקשת שוב. התוצאה: שינוי שם אצל Meta גורם לאובדן מדד אחד,
לא לקריסת איסוף הנתונים כולו.

מיושם ב-`src/platforms/meta/client.ts`.

### מגבלות החשבון בטיקטוק

לפני כל פרסום:

```
POST /v2/post/publish/creator_info/query/
```

מחזיר את אורך הווידאו המרבי לחשבון, רמות הפרטיות המותרות, והאם החשבון רשאי לפרסם
כרגע. אלה נבדקים מול הבקשה לפני שליחתה.

מיושם ב-`src/platforms/tiktok.ts` → `fetchCreatorInfo`.

---

## מה כן מקובע בקוד — לאמת ידנית

הערכים הבאים נלקחו ממקורות משניים עדכניים (אוגוסט 2026) ומידע כללי. שווה לאמת
אותם מול התיעוד הרשמי כשיש גישה:

### Meta

| מה | ערך בקוד | היכן |
|---|---|---|
| גרסת Graph API | `v23.0` | `.env` → `META_GRAPH_VERSION` |
| הרשאות | `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` | `src/platforms/meta/scopes.ts` |
| מגבלת כיתוב אינסטגרם | 2200 תווים | `instagram.ts` → `mediaConstraints` |
| מגבלת האשטגים | 30 | שם |
| יחס גובה-רוחב לתמונה | 0.8 עד 1.91 | שם |
| פריטים בקרוסלה | 2 עד 10 | שם |

**נקודה שדורשת החלטה:** קיימים שני מסלולי הזדהות — `Instagram API with Facebook Login`
(מה שמומש כאן, ומחבר גם את עמוד הפייסבוק בחיבור אחד) ו-`Instagram API with Instagram Login`
(עם שמות הרשאות `instagram_business_*`, ובלי צורך בעמוד פייסבוק). נבחר המסלול הראשון
כי הדרישה כוללת גם פרסום לעמוד הפייסבוק. אם Meta תסמן את שמות ההרשאות הישנים כמיושנים,
העדכון מתמצה בקובץ `scopes.ts`.

### TikTok

| מה | ערך בקוד | היכן |
|---|---|---|
| Scopes | `user.info.basic`, `user.info.stats`, `video.publish`, `video.list` | `src/platforms/tiktok.ts` |
| קידוד אתגר PKCE | hex (לא base64url) | `createPkcePair` |
| מקור מדיה | `PULL_FROM_URL` | `initVideoPost` |
| אורך כותרת מרבי | 2200 תווים | `mediaConstraints` |

> **שים לב ל-PKCE:** טיקטוק מצפה לאתגר מקודד ב-hex, בניגוד ל-RFC 7636 ולכל ספק אחר
> שמשתמש ב-base64url. זו לא טעות בקוד — שינוי ל-base64url ישבור את ההתחברות.

---

## איך לאמת כשיש גישה לתיעוד

1. **הרשאות Meta** — <https://developers.facebook.com/docs/permissions>
   להשוות מול `src/platforms/meta/scopes.ts`. אם הרשאה נוספת נדרשת, להוסיף שם בלבד.

2. **פרסום תוכן באינסטגרם** — <https://developers.facebook.com/docs/instagram-platform/content-publishing>
   לוודא ש-`media_type` עדיין מקבל `REELS`, `STORIES`, `CAROUSEL`.

3. **מדדי Insights** — <https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-media/insights>
   להוסיף מדדים חדשים לרשימה המבוקשת ב-`instagram.ts`. המנגנון החסין כבר יתמודד
   עם מדדים שאינם נתמכים.

4. **פרסום בטיקטוק** — <https://developers.tiktok.com/doc/content-posting-api-get-started>
   לוודא את מבנה `post_info` ואת רשימת רמות הפרטיות.

לאחר כל אימות — לעדכן את הטבלאות למעלה עם התאריך שבו נבדק.

**עודכן לאחרונה:** לא אומת מול המקור הרשמי (הדומיינים היו חסומים בזמן הפיתוח).

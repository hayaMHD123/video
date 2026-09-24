# ربط القناة والرفع إلى يوتيوب

الموقع يعمل محلياً على `http://127.0.0.1:3000`. إعداد يوتيوب اختياري: يمكنك تصدير الفيديو MP4 ورفعه يدوياً في أي وقت. لا يفرض الموقع رسوماً على الرفع، ولا يحتاج إلى مفتاح API عام؛ لكن الاستخدام يخضع لحصص Google ومراجعة مشروع API.

## الإعداد مرة واحدة

1. أنشئ مشروعاً في [Google Cloud Console](https://console.cloud.google.com/) وفعّل [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com).
2. افتح Google Auth Platform / شاشة الموافقة. إن كان نوع الجمهور External وحالة النشر Testing، أضف حساب Google الذي يدير قناتك ضمن Test users.
3. أنشئ OAuth client من نوع **Web application**. أضف `http://127.0.0.1:3000/api/youtube/callback` إلى **Authorized redirect URIs** بالضبط. اختلاف `localhost` عن `127.0.0.1` أو رقم المنفذ يسبب `redirect_uri_mismatch`.
4. انسخ `.env.example` إلى `.env.local` وضع `YOUTUBE_CLIENT_ID` و`YOUTUBE_CLIENT_SECRET`. أبقِ `YOUTUBE_REDIRECT_URI` مطابقاً للعنوان الذي سجلته في Google.
5. أعد تشغيل الموقع، افتحه من `http://127.0.0.1:3000` واضغط «ربط يوتيوب». سجّل الدخول بالحساب الذي يدير القناة ووافق على صلاحية رفع الفيديو.

التطبيق يطلب صلاحية `youtube.upload` فقط. يخزن رمز الوصول والتجديد محلياً في `data/youtube-oauth.json`، وهو مستثنى من Git. لا يظهر الرمز في المتصفح. زر الفصل يحاول إلغاء التفويض لدى Google ثم يحذف الملف المحلي. هذا التصميم لحاسوب منشئ محتوى واحد؛ لا تنشر مسارات `/api/youtube` على خادم عام قبل إضافة حسابات مستخدمين وتخزين منفصل وآمن لكل مستخدم.

## عند رفع حلقة

صدّر MP4 من المحرر، ثم اختر عنواناً ووصفاً والخصوصية والجمهور. يضبط الموقع «مخصّص للأطفال» افتراضياً؛ راجع هذا الخيار لكل حلقة، لأنه بيان يقدمه مالك القناة. يمكن تمرير وسوم وفئة، وتُستخدم الفئة 27 (التعليم) افتراضياً. يمكنك إضافة صورة مصغّرة PNG/JPG حتى 10 ميغابايت، والتصريح بالمحتوى الاصطناعي الواقعي إذا كان ينطبق. ينقل الموقع الفيديو على دفعات إلى جلسة رفع قابلة للاستئناف، ثم يحاول رفع الصورة المصغّرة إن وُجدت. فشل الصورة المصغّرة لا يلغي رفع الفيديو. يُرجع رابط الفيديو وحالة الخصوصية التي أبلغ عنها يوتيوب. الحد المحلي للفيديو 256 ميغابايت؛ للملفات الأكبر استخدم YouTube Studio. إذا انقطع الاتصال بعد إرسال آخر دفعة، راجع YouTube Studio قبل إعادة المحاولة لتجنب النسخ المكررة.

**قيد مهم:** توضح [وثائق `videos.insert`](https://developers.google.com/youtube/v3/docs/videos/insert) أن الفيديوهات المرفوعة من مشاريع API غير المدققة والمنشأة بعد 28 يوليو 2020 تظل **خاصة** حتى لو طُلبت حالة «عام» أو «غير مُدرج». رفع هذا القيد يحتاج [تدقيق مشروع YouTube API](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits). لذلك الرفع التلقائي لا يضمن النشر الفوري للعموم قبل موافقة Google. يعرض الموقع حالة الخصوصية التي أعادتها API بعد الرفع.

تذكر [حصص YouTube Data API](https://developers.google.com/youtube/v3/getting-started) أن الحد الافتراضي الحالي هو 100 عملية `videos.insert` يومياً مع حصة للعمليات الأخرى، ويمكن أن تتغير الحصص. في وضع OAuth الخارجي **Testing**، [تنتهي صلاحية تفويض المستخدم بعد سبعة أيام](https://support.google.com/cloud/answer/15549945?hl=en)، وقد تحتاج إلى ربط القناة من جديد. هذه قيود من Google، وليست رسوماً يفرضها الموقع.

## واجهات الموقع

- `GET /api/youtube/status` → `{ configured, connected, expiresAt, message }`.
- `GET /api/youtube/authorize` → ينقل المتصفح إلى موافقة Google. تعود النتيجة إلى `/?youtube=connected` أو `/?youtube=error&message=...`.
- `POST /api/youtube/disconnect` → `{ connected: false, revoked, message }`.
- `POST /api/youtube/upload` → `multipart/form-data` مع `video` (MP4)، و`title`، و`description`، و`privacyStatus` (`private` أو `unlisted` أو `public`)، و`madeForKids` (`true` أو `false`). اختيارياً: `tags` (قائمة JSON أو كلمات مفصولة بفواصل)، و`categoryId`، و`containsSyntheticMedia`، و`thumbnail` (PNG/JPG). النجاح: `{ videoId, url, requestedPrivacyStatus, privacyStatus, madeForKids, uploadStatus, thumbnailUploaded, thumbnailWarning }`، وقد تكون `privacyStatus` فارغة إذا لم يُرجع يوتيوب الحالة الفعلية. الفشل: `{ error, message }` مع رمز HTTP مناسب.

اعتمد التنفيذ على [تدفق OAuth الرسمي لتطبيقات الخادم](https://developers.google.com/identity/protocols/oauth2/web-server) و[بروتوكول الرفع القابل للاستئناف](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol).

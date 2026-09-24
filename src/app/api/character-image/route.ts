import { createHash, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
const MAX_REQUEST_BYTES = 4_250_000;
const MAX_REFERENCE_BYTES = 1_000_000;
const MAX_IMAGE_BYTES = 12_000_000;
const MAX_PROMPT_LENGTH = 2_000;
const OUTPUT_SIZES = new Set(["1280x720", "720x1280", "1024x576", "576x1024", "1024x1024"]);
const NO_STORE = { "Cache-Control": "no-store" };

function configured(): boolean {
  return Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID?.trim() &&
      process.env.CLOUDFLARE_API_TOKEN?.trim() &&
      process.env.CHARACTER_STUDIO_PASSWORD,
  );
}

function errorResponse(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

function validPassword(candidate: string | null, expected: string): boolean {
  const candidateHash = createHash("sha256").update(candidate ?? "").digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

function imageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function referenceDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  if (mime === "image/png") {
    if (bytes.length < 24 || Buffer.from(bytes.subarray(12, 16)).toString("ascii") !== "IHDR") return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // JPEG dimensions live in a Start Of Frame segment, not at a fixed offset.
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (length < 7) return null;
      return {
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
      };
    }
    offset += length;
  }
  return null;
}

function decodeImage(value: unknown): { bytes: Uint8Array; mime: string } | null {
  if (typeof value !== "string") return null;
  const base64 = value.replace(/^data:image\/(?:png|jpeg|webp);base64,/i, "");
  if (
    base64.length === 0 ||
    base64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4 ||
    base64.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  ) {
    return null;
  }
  const bytes = Buffer.from(base64, "base64");
  const mime = imageMime(bytes);
  return bytes.length <= MAX_IMAGE_BYTES && mime ? { bytes, mime } : null;
}

function imageResponse(bytes: Uint8Array, mime: string): Response {
  return new Response(new Uint8Array(bytes), {
    headers: { ...NO_STORE, "Content-Type": mime, "X-Content-Type-Options": "nosniff" },
  });
}

export function GET(): Response {
  return Response.json({ configured: configured() }, { headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  if (!configured()) {
    return errorResponse("توليد الصور غير مُعدّ بعد. أضف إعدادات Cloudflare وكلمة مرور الاستوديو على الخادم.", 503);
  }

  const password = process.env.CHARACTER_STUDIO_PASSWORD!;
  if (!validPassword(request.headers.get("x-studio-password"), password)) {
    return errorResponse("كلمة مرور استوديو الشخصية غير صحيحة.", 401);
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    return errorResponse("يجب إرسال البيانات بصيغة multipart/form-data.", 415);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return errorResponse("الصور المرجعية كبيرة جدًا. صغّرها قبل التوليد.", 413);
  }

  let input: FormData;
  try {
    input = await request.formData();
  } catch {
    return errorResponse("تعذّر قراءة الصور أو الطلب.", 400);
  }

  const promptValue = input.get("prompt");
  const prompt = typeof promptValue === "string" ? promptValue.trim() : "";
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
    return errorResponse("وصف الصورة مطلوب ويجب ألّا يتجاوز 2000 حرف.", 400);
  }

  const width = input.get("width");
  const height = input.get("height");
  const outputSize = `${width ?? ""}x${height ?? ""}`;
  if (!OUTPUT_SIZES.has(outputSize)) {
    return errorResponse("اختر مقاسًا مدعومًا: 1280×720 أو 720×1280 أو 1024×576 أو 576×1024 أو 1024×1024.", 400);
  }

  const references = input.getAll("reference");
  if (references.length > 4) {
    return errorResponse("يمكن استخدام 4 صور مرجعية كحد أقصى.", 400);
  }

  const outgoing = new FormData();
  outgoing.append("prompt", prompt);
  outgoing.append("width", String(width));
  outgoing.append("height", String(height));

  let totalReferenceBytes = 0;
  for (const [index, reference] of references.entries()) {
    if (typeof reference === "string" || !["image/png", "image/jpeg"].includes(reference.type)) {
      return errorResponse("الصور المرجعية يجب أن تكون PNG أو JPEG.", 400);
    }
    if (!reference.size || reference.size > MAX_REFERENCE_BYTES) {
      return errorResponse("كل صورة مرجعية يجب ألّا تتجاوز 1 ميغابايت.", 413);
    }
    totalReferenceBytes += reference.size;
    if (totalReferenceBytes > MAX_REQUEST_BYTES) {
      return errorResponse("مجموع الصور المرجعية كبير جدًا.", 413);
    }
    const bytes = new Uint8Array(await reference.arrayBuffer());
    if (imageMime(bytes) !== reference.type) {
      return errorResponse("أحد ملفات الصور المرجعية غير صالح.", 400);
    }
    const dimensions = referenceDimensions(bytes, reference.type);
    if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width >= 512 || dimensions.height >= 512) {
      return errorResponse("صغّر كل صورة مرجعية إلى أقل من 512×512 بكسل قبل التوليد.", 400);
    }
    outgoing.append(`input_image_${index}`, new Blob([bytes], { type: reference.type }), `reference-${index}.${reference.type === "image/png" ? "png" : "jpg"}`);
  }

  const accountId = encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID!.trim());
  const token = process.env.CLOUDFLARE_API_TOKEN!.trim();
  let response: Response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: outgoing,
      cache: "no-store",
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    return errorResponse("تعذّر الاتصال بخدمة الصور. حاول مرة أخرى لاحقًا.", 502);
  }

  if (!response.ok) {
    if (response.status === 429) return errorResponse("انتهت حصة توليد الصور المجانية مؤقتًا. حاول لاحقًا.", 429);
    if (response.status === 401 || response.status === 403) return errorResponse("رفضت Cloudflare إعدادات الحساب أو مفتاح API.", 502);
    if (response.status === 400 || response.status === 413) return errorResponse("رفض نموذج الصور الطلب أو الصور المرجعية. راجع الوصف والصور المصغّرة.", 400);
    return errorResponse("تعذّر توليد الصورة لدى Cloudflare. حاول مرة أخرى لاحقًا.", 502);
  }

  const responseLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(responseLength) && responseLength > MAX_IMAGE_BYTES * 2) {
    return errorResponse("الصورة الناتجة كبيرة جدًا.", 502);
  }

  if (response.headers.get("content-type")?.toLowerCase().includes("json")) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return errorResponse("أعادت Cloudflare استجابة غير مفهومة.", 502);
    }
    const envelope = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    const result = envelope?.result && typeof envelope.result === "object" ? (envelope.result as Record<string, unknown>) : null;
    const decoded = envelope?.success === false ? null : decodeImage(result?.image);
    if (!decoded) return errorResponse("لم تُرجع Cloudflare صورة صالحة. حاول وصفًا مختلفًا.", 502);
    return imageResponse(decoded.bytes, decoded.mime);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const mime = bytes.length <= MAX_IMAGE_BYTES ? imageMime(bytes) : null;
  if (!mime) return errorResponse("لم تُرجع Cloudflare صورة صالحة.", 502);
  return imageResponse(bytes, mime);
}

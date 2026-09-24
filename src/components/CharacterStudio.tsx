"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  Download,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
} from "lucide-react";
import type { EpisodePlan, EpisodeScene } from "@/lib/types";
import { saveMedia } from "@/lib/projectStorage";

type AssetKind = "reference" | "pose";
type AssetRecord = {
  id: string;
  kind: AssetKind;
  name: string;
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
};
type LocalAsset = AssetRecord & { url: string };
type LocalImage = { blob: Blob; url: string };
type Mode = "fixed" | "referenced";

const DB_NAME = "hikaya-character-studio";
const STORE_NAME = "assets";
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAssets(): Promise<AssetRecord[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      transaction.oncomplete = () => resolve(request.result as AssetRecord[]);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function putAsset(asset: AssetRecord): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(asset);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function deleteAsset(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function dimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

async function hasTransparency(blob: Blob): Promise<boolean> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(256, bitmap.width);
    canvas.height = Math.min(256, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("المتصفح لا يدعم فحص شفافية الصورة.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 250) return true;
    }
    return false;
  } finally {
    bitmap.close();
  }
}

async function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("تعذّر تجهيز صورة PNG.")), "image/png");
  });
}

async function shrinkReference(blob: Blob, index: number): Promise<File> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 511 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
    canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("المتصفح لا يدعم تجهيز الصور المرجعية.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const compressed = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((image) => image ? resolve(image) : reject(new Error("تعذّر تصغير الصورة المرجعية.")), "image/jpeg", 0.84);
    });
    if (compressed.size > 1_000_000) throw new Error("تعذّر ضغط إحدى الصور المرجعية إلى الحد المطلوب. اختر صورة أبسط.");
    return new File([compressed], `reference-${index + 1}.jpg`, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

function drawCover(context: CanvasRenderingContext2D, bitmap: ImageBitmap, width: number, height: number) {
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function scenePrompt(plan: EpisodePlan, scene: EpisodeScene): string {
  return `Illustrated children's educational video scene. Keep the child's face, hairstyle, clothing and colors close to the reference images. No text, no lettering.\n\n${plan.visualBible}\n\n${scene.imagePrompt}`;
}

function backgroundPrompt(plan: EpisodePlan, scene: EpisodeScene): string {
  return `Illustrated background for a children's educational video. Setting: ${scene.title}. Match this visual style: ${plan.artStyle}. ${plan.visualBible}. No people, no characters, no lettering, no text. Leave clear space for the main character.`;
}

export default function CharacterStudio() {
  const [plan, setPlan] = useState<EpisodePlan | null>(null);
  const [sceneId, setSceneId] = useState("");
  const [mode, setMode] = useState<Mode>("fixed");
  const [assets, setAssets] = useState<LocalAsset[]>([]);
  const [selectedPoseId, setSelectedPoseId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [bgPrompt, setBgPrompt] = useState("Illustrated warm, colorful background for a children's educational video, no people, no characters, no text. Leave clear space for the main character.");
  const [password, setPassword] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [background, setBackground] = useState<LocalImage | null>(null);
  const [result, setResult] = useState<LocalImage | null>(null);
  const [positionX, setPositionX] = useState(50);
  const [positionY, setPositionY] = useState(58);
  const [characterSize, setCharacterSize] = useState(40);
  const [working, setWorking] = useState(false);
  const [assetBusy, setAssetBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const objectUrls = useRef<Set<string>>(new Set());

  const createUrl = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    objectUrls.current.add(url);
    return url;
  }, []);
  const releaseUrl = useCallback((url: string) => {
    if (objectUrls.current.delete(url)) URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    let active = true;
    try {
      const stored = localStorage.getItem("hikaya:plan");
      if (stored) {
        const parsed = JSON.parse(stored) as EpisodePlan;
        if (Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
          setPlan(parsed);
          setSceneId(parsed.scenes[0].id);
          setPrompt(scenePrompt(parsed, parsed.scenes[0]));
          setBgPrompt(backgroundPrompt(parsed, parsed.scenes[0]));
        }
      }
    } catch {
      setNotice("لم أتمكن من قراءة خطة الحلقة المحفوظة؛ يمكنك استخدام التبويب وتنزيل الصورة يدويًا.");
    }
    getAssets().then((stored) => {
      if (!active) return;
      const restored = stored.sort((a, b) => a.createdAt - b.createdAt).map((asset) => ({ ...asset, url: createUrl(asset.blob) }));
      setAssets(restored);
      const firstPose = restored.find((asset) => asset.kind === "pose");
      if (firstPose) setSelectedPoseId(firstPose.id);
    }).catch(() => {
      if (active) setError("تعذّر فتح مكتبة الشخصية في المتصفح. جرّب متصفحًا آخر أو تأكد من السماح بتخزين المواقع.");
    });
    const controller = new AbortController();
    fetch("/api/character-image", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((data: { configured?: boolean }) => { if (active) setConfigured(Boolean(data.configured)); })
      .catch(() => { if (active) setConfigured(false); });
    return () => {
      active = false;
      controller.abort();
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.current.clear();
    };
  }, [createUrl]);

  useEffect(() => () => { if (background) releaseUrl(background.url); }, [background, releaseUrl]);
  useEffect(() => () => { if (result) releaseUrl(result.url); }, [result, releaseUrl]);

  const references = useMemo(() => assets.filter((asset) => asset.kind === "reference"), [assets]);
  const poses = useMemo(() => assets.filter((asset) => asset.kind === "pose"), [assets]);
  const selectedPose = poses.find((pose) => pose.id === selectedPoseId) ?? poses[0];
  const scene = plan?.scenes.find((item) => item.id === sceneId);
  const portrait = plan?.format === "9:16";
  const modelWidth = portrait ? 720 : 1280;
  const modelHeight = portrait ? 1280 : 720;
  const finalWidth = portrait ? 1080 : 1920;
  const finalHeight = portrait ? 1920 : 1080;
  const canFinish = mode === "fixed" ? Boolean(background && selectedPose) : Boolean(result);

  const uploadAssets = async (kind: AssetKind, files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    setNotice("");
    setAssetBusy(true);
    try {
      const incoming = Array.from(files);
      if (kind === "reference" && references.length + incoming.length > 4) {
        throw new Error("يمكن حفظ 4 صور مرجعية كحد أقصى. احذف صورة قديمة إذا أردت استبدالها.");
      }
      for (const file of incoming) {
        if (file.size > MAX_FILE_SIZE) throw new Error(`الملف ${file.name} أكبر من 20 ميغابايت.`);
        if (kind === "pose" ? file.type !== "image/png" : !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
          throw new Error(kind === "pose" ? "الوضعيات تحتاج صورة PNG بخلفية شفافة." : "المراجع تقبل PNG أو JPG أو WebP فقط.");
        }
        const size = await dimensions(file);
        if (kind === "pose" && !(await hasTransparency(file))) {
          throw new Error(`الصورة ${file.name} لا تبدو شفافة. احفظ الطفلة كـ PNG بخلفية شفافة أولًا.`);
        }
        const record: AssetRecord = {
          id: crypto.randomUUID(), kind, name: file.name, blob: file,
          width: size.width, height: size.height, createdAt: Date.now(),
        };
        await putAsset(record);
        setAssets((current) => [...current, { ...record, url: createUrl(file) }]);
        if (kind === "pose" && !selectedPoseId) setSelectedPoseId(record.id);
      }
      setNotice(kind === "pose" ? "تم حفظ الوضعية المعتمدة محليًا. لن يتغير شكلها عند تركيب الفيديو." : "تم حفظ الصور المرجعية محليًا في هذا المتصفح.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر حفظ الصورة.");
    } finally {
      setAssetBusy(false);
    }
  };

  const removeAsset = async (asset: LocalAsset) => {
    setError("");
    try {
      await deleteAsset(asset.id);
      setAssets((current) => current.filter((item) => item.id !== asset.id));
      releaseUrl(asset.url);
      if (asset.id === selectedPoseId) setSelectedPoseId(poses.find((pose) => pose.id !== asset.id)?.id ?? "");
    } catch {
      setError("تعذّر حذف الصورة من مكتبة الشخصية.");
    }
  };

  const chooseScene = (id: string) => {
    setSceneId(id);
    const chosen = plan?.scenes.find((item) => item.id === id);
    if (plan && chosen) {
      setPrompt(scenePrompt(plan, chosen));
      setBgPrompt(backgroundPrompt(plan, chosen));
    }
    setResult(null);
    setBackground(null);
  };

  const generate = async (target: "background" | "scene") => {
    const text = (target === "scene" ? prompt : bgPrompt).trim();
    if (text.length < 10) {
      setError("اكتب وصفًا أوضح للصورة قبل التوليد.");
      return;
    }
    if (target === "scene" && references.length === 0) {
      setError("أضف صورة مرجعية واحدة على الأقل كي يسترشد بها النموذج.");
      return;
    }
    if (!configured) {
      setError("التوليد غير مفعّل بعد. يمكنك رفع خلفية وتركيب الوضعية مجانًا دون API.");
      return;
    }
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("prompt", text);
      form.set("width", String(modelWidth));
      form.set("height", String(modelHeight));
      if (target === "scene") {
        for (const [index, reference] of references.entries()) {
          form.append("reference", await shrinkReference(reference.blob, index));
        }
      }
      const response = await fetch("/api/character-image", {
        method: "POST",
        body: form,
        headers: password ? { "x-studio-password": password } : undefined,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        if (response.status === 429) throw new Error(data?.error || "انتهت الحصة المجانية مؤقتًا. حاول بعد تجددها أو ارفع خلفية جاهزة.");
        throw new Error(data?.error || (response.status === 401 ? "كلمة مرور الاستوديو غير صحيحة." : "تعذّر توليد الصورة. جرّب لاحقًا."));
      }
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("الاستجابة لم تكن صورة صالحة.");
      const image = { blob, url: createUrl(blob) };
      if (target === "scene") setResult(image);
      else setBackground(image);
      setNotice(target === "scene"
        ? "تم توليد مشهد بالمراجع. راجع الوجه والملابس قبل اعتماده؛ التطابق غير مضمون."
        : "الخلفية جاهزة. اختر وضعية الشخصية واضبط حجمها ومكانها.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر توليد الصورة.");
    } finally {
      setWorking(false);
    }
  };

  const uploadBackground = async (file?: File) => {
    if (!file) return;
    setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > MAX_FILE_SIZE) {
      setError("ارفع خلفية PNG أو JPG أو WebP بحجم لا يتجاوز 20 ميغابايت.");
      return;
    }
    try {
      await dimensions(file);
      setBackground({ blob: file, url: createUrl(file) });
      setNotice("تم تحميل الخلفية من جهازك. التركيب النهائي يعمل محليًا دون استهلاك حصة التوليد.");
    } catch {
      setError("تعذّر قراءة صورة الخلفية.");
    }
  };

  const renderFinal = async (): Promise<Blob> => {
    const canvas = document.createElement("canvas");
    canvas.width = finalWidth;
    canvas.height = finalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("المتصفح لا يدعم تركيب الصورة.");
    if (mode === "fixed") {
      if (!background || !selectedPose) throw new Error("أضف خلفية ووضعية شخصية أولًا.");
      const bgBitmap = await createImageBitmap(background.blob);
      const poseBitmap = await createImageBitmap(selectedPose.blob);
      try {
        drawCover(context, bgBitmap, finalWidth, finalHeight);
        const width = finalWidth * characterSize / 100;
        const height = width * poseBitmap.height / poseBitmap.width;
        context.drawImage(poseBitmap, finalWidth * positionX / 100 - width / 2, finalHeight * positionY / 100 - height / 2, width, height);
      } finally {
        bgBitmap.close();
        poseBitmap.close();
      }
    } else {
      if (!result) throw new Error("ولّد المشهد أولًا.");
      const bitmap = await createImageBitmap(result.blob);
      try { drawCover(context, bitmap, finalWidth, finalHeight); }
      finally { bitmap.close(); }
    }
    return toPng(canvas);
  };

  const downloadImage = async () => {
    setWorking(true);
    setError("");
    try {
      downloadBlob(await renderFinal(), `hikaya-${sceneId || "character"}.png`);
      setNotice("تم تنزيل الصورة PNG. احتفظ بها كنسخة احتياطية؛ مكتبة الشخصية محفوظة في هذا المتصفح فقط.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر تنزيل الصورة.");
    } finally {
      setWorking(false);
    }
  };

  const transferToEpisode = async () => {
    if (!scene) {
      setError("أنشئ خطة حلقة في استوديو الحلقات أولًا، ثم اختر المشهد المستهدف.");
      return;
    }
    setWorking(true);
    setError("");
    try {
      const blob = await renderFinal();
      await saveMedia(`image:${scene.id}`, blob);
      let meta: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(localStorage.getItem("hikaya:meta") || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
      } catch { /* Keep the saved media even if optional metadata is malformed. */ }
      const previousNames = meta.imageNames && typeof meta.imageNames === "object" && !Array.isArray(meta.imageNames)
        ? meta.imageNames as Record<string, string> : {};
      const imageNames = { ...previousNames, [scene.id]: `hikaya-character-${scene.id}.png` };
      localStorage.setItem("hikaya:meta", JSON.stringify({ ...meta, imageNames }));
      window.location.assign("/?tab=media");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر نقل الصورة إلى الحلقة.");
      setWorking(false);
    }
  };

  return (
    <div className="cs-page">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand"><div className="brand-mark"><WandSparkles size={24} /></div><div><strong>حكايا <span>STUDIO</span></strong><small>استوديو فيديوهات الأطفال التعليمية</small></div></div>
          <span className="local-badge"><span /> شخصية ثابتة · خطة مجانية</span>
        </div>
      </header>
      <nav className="workspace-tabs" aria-label="أقسام الاستوديو"><div className="workspace-tabs-inner">
        <Link href="/" className="workspace-tab">استوديو الحلقات</Link>
        <Link href="/character" className="workspace-tab active" aria-current="page">الشخصية الثابتة</Link>
      </div></nav>

      <main className="cs-main">
        <section className="cs-hero">
          <span className="cs-kicker"><Sparkles size={15} /> استوديو الشخصية</span>
          <h1>الطفلة نفسها، <em>مشهد بعد مشهد</em></h1>
          <p>احفظ مراجع الشخصية ووضعيات PNG الشفافة مرة واحدة. ولّد خلفية أو ارفعها، ثم ركّب عليها الوضعية المعتمدة وأنقل النتيجة مباشرة إلى مشهد الحلقة.</p>
          <div className="cs-hero-notes"><span><Check size={15} /> بدون اشتراك مدفوع</span><span><LockKeyhole size={15} /> الصور الأساسية محفوظة في متصفحك</span></div>
        </section>

        {error && <div className="cs-message cs-error" role="alert"><AlertCircle size={18} /><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="إغلاق التنبيه">×</button></div>}
        {notice && <div className="cs-message cs-notice" role="status"><Check size={18} /><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="إغلاق الإشعار">×</button></div>}

        <div className="cs-grid">
          <div className="cs-column">
            <section className="cs-card">
              <div className="cs-heading"><span className="cs-number">01</span><div><h2>هوية الشخصية</h2><p>هذه الصور مستقلة عن ملفات الحلقة، ولن يمسحها زر إعادة المشروع.</p></div></div>
              <div className="cs-subhead"><div><strong>صور مرجعية</strong><small>حتى 4 صور، تُستخدم فقط لمسار التوليد بالمراجع.</small></div><span className="cs-counter">{references.length}/4</span></div>
              <div className="cs-asset-grid">
                {references.map((asset) => <div className="cs-asset" key={asset.id}>
                  <div className="cs-asset-image"><Image src={asset.url} alt={`مرجع الشخصية ${asset.name}`} fill unoptimized sizes="120px" style={{ objectFit: "cover" }} /></div>
                  <span title={asset.name}>{asset.name}</span><button type="button" onClick={() => void removeAsset(asset)} aria-label={`حذف ${asset.name}`} title="حذف المرجع"><Trash2 size={14} /></button>
                </div>)}
                {references.length < 4 && <label className="cs-add-asset"><Plus size={22} /><span>إضافة مراجع</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={assetBusy} onChange={(event) => { void uploadAssets("reference", event.target.files); event.target.value = ""; }} /></label>}
              </div>
              <p className="cs-hint">ارفع صور شخصية تملك حق استخدامها. عند طلب التوليد فقط ستُرسل نسخ مصغّرة إلى Cloudflare؛ الملفات الأصلية تبقى على جهازك.</p>
              <div className="cs-divider" />
              <div className="cs-subhead"><div><strong>بنك الوضعيات المعتمدة</strong><small>PNG شفافة للطفلة نفسها؛ تُركّب كما هي بلا إعادة رسم.</small></div><span className="cs-counter">{poses.length}</span></div>
              <div className="cs-pose-grid">
                {poses.map((asset) => <div key={asset.id} className={`cs-pose ${selectedPose?.id === asset.id ? "selected" : ""}`}>
                  <button type="button" className="cs-pose-select" onClick={() => setSelectedPoseId(asset.id)} aria-pressed={selectedPose?.id === asset.id}>
                    <span className="cs-pose-image"><Image src={asset.url} alt="" fill unoptimized sizes="110px" style={{ objectFit: "contain" }} /></span><span title={asset.name}>{asset.name}</span>
                  </button>
                  <button type="button" className="cs-pose-delete" onClick={() => void removeAsset(asset)} aria-label={`حذف الوضعية ${asset.name}`} title="حذف الوضعية"><Trash2 size={14} /></button>
                </div>)}
                <label className="cs-add-asset cs-add-pose"><Plus size={22} /><span>رفع وضعية PNG</span><input type="file" accept="image/png" multiple disabled={assetBusy} onChange={(event) => { void uploadAssets("pose", event.target.files); event.target.value = ""; }} /></label>
              </div>
              {!poses.length && <p className="cs-hint">لثبات مضمون للشكل، ارفع PNG شفافة للشخصية بتعابير ووضعيات مختلفة. التوليد بالمراجع وحده قد يغيّر تفاصيل الوجه أو الملابس.</p>}
            </section>

            <section className="cs-card cs-info-card">
              <div className="cs-heading"><span className="cs-number">!</span><div><h2>متى يكون الشكل ثابتًا؟</h2><p>التركيب يحافظ على PNG نفسها تمامًا؛ التوليد بالمراجع يعطي تشابهًا تقريبيًا ويحتاج مراجعة بشرية.</p></div></div>
              <p>لا تنشر مشهدًا فيه وجه أو ملابس مختلفة. جرّب توليد خلفية فقط، واستخدم الوضعية المعتمدة فوقها عندما تكون الهوية أهم من تغيير حركة الطفلة.</p>
            </section>
          </div>

          <div className="cs-column cs-work-column">
            <section className="cs-card">
              <div className="cs-heading"><span className="cs-number">02</span><div><h2>جهّز المشهد</h2><p>اختر مشهدًا من الخطة الحالية، أو أنشئ صورة مستقلة لتنزيلها.</p></div></div>
              {plan?.scenes.length ? <label className="cs-field"><span>مشهد الحلقة</span><select value={sceneId} onChange={(event) => chooseScene(event.target.value)}>{plan.scenes.map((item, index) => <option key={item.id} value={item.id}>المشهد {index + 1}: {item.title}</option>)}</select></label>
                : <div className="cs-empty-plan">ما في خطة حلقة محفوظة بهذا المتصفح. يمكنك تجهيز صورة وتنزيلها، أو <Link href="/">إنشاء خطة أولًا</Link> لتُنقل الصورة مباشرة للمشهد.</div>}

              <div className="cs-mode-tabs" role="group" aria-label="طريقة تثبيت الشخصية">
                <button type="button" className={mode === "fixed" ? "active" : ""} aria-pressed={mode === "fixed"} onClick={() => { setMode("fixed"); setError(""); }}><LockKeyhole size={17} /> شخصية ثابتة على خلفية</button>
                <button type="button" className={mode === "referenced" ? "active" : ""} aria-pressed={mode === "referenced"} onClick={() => { setMode("referenced"); setError(""); }}><WandSparkles size={17} /> توليد مشهد بالمراجع</button>
              </div>

              {mode === "fixed" ? <div className="cs-mode-content">
                <p className="cs-mode-explain">المسار الأدق للشخصية: نستخدم PNG المعتمدة دون تغيير ملامحها. الخلفية يمكن توليدها ضمن الحصة المجانية أو رفعها من جهازك.</p>
                <label className="cs-field"><span>وصف الخلفية</span><textarea rows={4} value={bgPrompt} onChange={(event) => setBgPrompt(event.target.value)} placeholder="صف المكان والإضاءة والألوان من دون شخصيات أو نصوص" /></label>
                <div className="cs-actions"><button type="button" className="button button-primary" disabled={working || configured !== true} onClick={() => void generate("background")}>{working ? <LoaderCircle className="spin" size={16} /> : <WandSparkles size={16} />} توليد خلفية مجانية</button>
                  <label className="button button-soft"><UploadCloud size={16} /> رفع خلفية<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void uploadBackground(event.target.files?.[0]); event.target.value = ""; }} /></label></div>
                {background && selectedPose && <div className="cs-controls"><label>مكان الشخصية أفقيًا <input type="range" min="5" max="95" value={positionX} onChange={(event) => setPositionX(Number(event.target.value))} /><output>{positionX}%</output></label><label>مكان الشخصية عموديًا <input type="range" min="5" max="95" value={positionY} onChange={(event) => setPositionY(Number(event.target.value))} /><output>{positionY}%</output></label><label>حجم الشخصية <input type="range" min="15" max="85" value={characterSize} onChange={(event) => setCharacterSize(Number(event.target.value))} /><output>{characterSize}%</output></label></div>}
              </div> : <div className="cs-mode-content">
                <p className="cs-mode-explain cs-caution">النموذج يحاول الالتزام بالصور المرجعية، لكنه لا يضمن تطابق الوجه أو اللباس 100%. راجع الناتج قبل اعتماده.</p>
                <label className="cs-field"><span>وصف المشهد الكامل</span><textarea rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="صف المشهد والشخصية والبيئة" /></label>
                <button type="button" className="button button-primary" disabled={working || configured !== true || references.length === 0} onClick={() => void generate("scene")}>{working ? <LoaderCircle className="spin" size={16} /> : <WandSparkles size={16} />} توليد بالمراجع ({references.length})</button>
              </div>}

              <div className={`cs-service ${configured === true ? "ready" : ""}`}><span className="cs-service-dot" /><span>{configured === null ? "جارٍ فحص اتصال التوليد..." : configured ? "Cloudflare جاهز ضمن حصته المجانية. عند نفاد الحصة يتوقف التوليد حتى تتجدد." : "توليد Cloudflare غير مفعّل بعد. يمكنك استخدام رفع الخلفية والتركيب المحلي مجانًا."}</span></div>
              {configured && <label className="cs-field cs-password"><span>كلمة مرور استوديو الشخصية (مطلوبة للتوليد)</span><input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="تُستخدم لهذا الطلب فقط ولا تُحفظ" /><small>لا تُخزَّن في المتصفح أو في مشروع الحلقة.</small></label>}
            </section>

            <section className="cs-card cs-preview-card">
              <div className="cs-heading"><span className="cs-number">03</span><div><h2>المعاينة والاعتماد</h2><p>تنزّل PNG جاهزة للفيديو، أو تُنقل إلى مشهد الحلقة الحالية.</p></div></div>
              <div className={`cs-preview ${portrait ? "portrait" : "landscape"}`}>
                {mode === "fixed" && background ? <>
                  <Image src={background.url} alt="خلفية المشهد" fill unoptimized sizes="(max-width: 640px) 100vw, 720px" style={{ objectFit: "cover" }} />
                  {selectedPose && <Image src={selectedPose.url} alt="وضعية الشخصية الثابتة فوق الخلفية" unoptimized width={selectedPose.width} height={selectedPose.height} className="cs-preview-pose" style={{ width: `${characterSize}%`, height: "auto", left: `${positionX}%`, top: `${positionY}%`, transform: "translate(-50%, -50%)" }} />}
                </> : mode === "referenced" && result ? <Image src={result.url} alt="المشهد المولّد باستخدام صور مرجعية" fill unoptimized sizes="(max-width: 640px) 100vw, 720px" style={{ objectFit: "cover" }} />
                  : <div className="cs-preview-empty"><ImagePlus size={37} /><strong>مساحة المشهد</strong><span>{mode === "fixed" ? "ولّد خلفية أو ارفعها، ثم اختر وضعية PNG للشخصية." : "أضف مراجع للشخصية وولّد المشهد لمعاينته هنا."}</span></div>}
              </div>
              <div className="cs-output-note"><span>{portrait ? "عمودي 9:16" : "أفقي 16:9"}</span><span>الملف النهائي PNG · {finalWidth}×{finalHeight}</span></div>
              <div className="cs-actions cs-finish-actions">
                <button type="button" className="button button-primary" disabled={!canFinish || working || !scene} onClick={() => void transferToEpisode()}><Check size={16} /> اعتماد ونقل إلى الحلقة</button>
                <button type="button" className="button button-soft" disabled={!canFinish || working} onClick={() => void downloadImage()}><Download size={16} /> تنزيل PNG</button>
                {(mode === "fixed" ? background : result) && <button type="button" className="button button-ghost" disabled={working} onClick={() => { if (mode === "fixed") setBackground(null); else setResult(null); setNotice("تم رفض الصورة الحالية. يمكنك المحاولة مجددًا."); }}><RotateCcw size={16} /> رفض وإعادة</button>}
              </div>
              {!scene && <p className="cs-hint">زر النقل يحتاج خطة محفوظة. يمكنك تنزيل PNG حتى بدون خطة، ثم رفعها يدويًا في تبويب الحلقة.</p>}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

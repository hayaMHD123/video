"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Film,
  ImagePlus,
  Images,
  Link2,
  LoaderCircle,
  Mic2,
  Music2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
  TvMinimalPlay as Youtube,
} from "lucide-react";
import type { EpisodePlan, EpisodeScene, PlanRequest, PlanResponse, VideoFormat } from "@/lib/types";
import { parseSrt } from "@/lib/video/captions";
import { clearMedia, loadMedia, removeMedia, saveMedia } from "@/lib/projectStorage";

const VideoPreview = dynamic(() => import("@/components/video/VideoPreview").then((module) => module.VideoPreview), {
  ssr: false,
  loading: () => <div className="preview-loading">جارٍ تجهيز المعاينة...</div>,
});

type Stage = 0 | 1 | 2 | 3;
type YouTubePrivacy = "private" | "unlisted" | "public";
type YouTubeStatus = { connected: boolean; configured: boolean; channelTitle?: string; message?: string };

const DEFAULT_BRIEF: PlanRequest = {
  description: "",
  ageGroup: "4–6 سنوات",
  format: "16:9",
  durationSec: 90,
  artStyle: "رسوم قصص أطفال ثنائية الأبعاد بألوان دافئة",
  language: "العربية الفصحى المبسطة",
};

const STAGES = [
  { label: "الفكرة", hint: "وصف الحلقة", icon: Sparkles },
  { label: "الخطة", hint: "المشاهد والبرومبتات", icon: ClipboardList },
  { label: "الملفات", hint: "الصور والصوت والترجمة", icon: Images },
  { label: "الإنتاج", hint: "التصدير ويوتيوب", icon: Film },
] as const;

const MOTIONS: { value: EpisodeScene["motion"]; label: string }[] = [
  { value: "push-in", label: "تقريب هادئ" },
  { value: "pull-out", label: "إبعاد هادئ" },
  { value: "pan-left", label: "تحريك يساراً" },
  { value: "pan-right", label: "تحريك يميناً" },
  { value: "float", label: "حركة ناعمة" },
];

const TRANSITIONS: { value: EpisodeScene["transition"]; label: string }[] = [
  { value: "fade", label: "تلاشي" },
  { value: "slide", label: "انزلاق" },
  { value: "cut", label: "قطع مباشر" },
];

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60).toString().padStart(2, "0")}:${(safe % 60).toString().padStart(2, "0")}`;
}

function safeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60) || "حلقة تعليمية";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function audioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => reject(new Error("تعذر قراءة مدة الملف الصوتي."));
    audio.src = url;
  });
}

export default function StudioApp() {
  const [stage, setStage] = useState<Stage>(0);
  const [brief, setBrief] = useState<PlanRequest>(DEFAULT_BRIEF);
  const [plan, setPlan] = useState<EpisodePlan | null>(null);
  const [planSource, setPlanSource] = useState<PlanResponse["source"] | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [imageNames, setImageNames] = useState<Record<string, string>>({});
  const [audioUrl, setAudioUrl] = useState<string>();
  const [audioName, setAudioName] = useState("");
  const [audioLength, setAudioLength] = useState<number | null>(null);
  const [musicUrl, setMusicUrl] = useState<string>();
  const [musicName, setMusicName] = useState("");
  const [thumbnailFile, setThumbnailFile] = useState<Blob | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string>();
  const [thumbnailName, setThumbnailName] = useState("");
  const [subtitles, setSubtitles] = useState("");
  const [subtitleName, setSubtitleName] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderBlob, setRenderBlob] = useState<Blob | null>(null);
  const [autoUpload, setAutoUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [youtubePrivacy, setYoutubePrivacy] = useState<YouTubePrivacy>("private");
  const [madeForKids, setMadeForKids] = useState(true);
  const [containsSyntheticMedia, setContainsSyntheticMedia] = useState(false);
  const [youtubeStatus, setYoutubeStatus] = useState<YouTubeStatus>({ connected: false, configured: false });
  const [youtubeResult, setYoutubeResult] = useState<{ url: string; videoId: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const localUrls = useRef<Set<string>>(new Set());

  const makeUrl = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    localUrls.current.add(url);
    return url;
  }, []);

  const releaseUrl = useCallback((url?: string) => {
    if (url && localUrls.current.has(url)) {
      URL.revokeObjectURL(url);
      localUrls.current.delete(url);
    }
  }, []);

  const refreshYouTubeStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/youtube/status", { cache: "no-store" });
      const data = (await response.json()) as YouTubeStatus;
      setYoutubeStatus({ connected: Boolean(data.connected), configured: Boolean(data.configured), channelTitle: data.channelTitle, message: data.message });
    } catch {
      setYoutubeStatus({ connected: false, configured: false, message: "تعذر الاتصال بخدمة YouTube المحلية." });
    }
  }, []);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const storedBrief = localStorage.getItem("hikaya:brief");
        const storedPlan = localStorage.getItem("hikaya:plan");
        const storedMeta = localStorage.getItem("hikaya:meta");
        if (storedBrief) setBrief({ ...DEFAULT_BRIEF, ...JSON.parse(storedBrief) });
        if (storedPlan) {
          const parsed = JSON.parse(storedPlan) as EpisodePlan;
          if (Array.isArray(parsed.scenes)) {
            setPlan(parsed);
            setStage(1);
          }
        }
        if (storedMeta) {
          const meta = JSON.parse(storedMeta) as { imageNames?: Record<string, string>; audioName?: string; musicName?: string; thumbnailName?: string; subtitles?: string; subtitleName?: string; planSource?: PlanResponse["source"]; youtubePrivacy?: YouTubePrivacy; madeForKids?: boolean; containsSyntheticMedia?: boolean };
          setImageNames(meta.imageNames ?? {});
          setAudioName(meta.audioName ?? "");
          setMusicName(meta.musicName ?? "");
          setThumbnailName(meta.thumbnailName ?? "");
          setSubtitles(meta.subtitles ?? "");
          setSubtitleName(meta.subtitleName ?? "");
          setPlanSource(meta.planSource ?? null);
          setYoutubePrivacy(meta.youtubePrivacy ?? "private");
          setMadeForKids(meta.madeForKids ?? true);
          setContainsSyntheticMedia(meta.containsSyntheticMedia ?? false);
        }
        const files = await loadMedia();
        if (!active) return;
        const restoredImages: Record<string, string> = {};
        Object.entries(files).forEach(([key, blob]) => {
          if (key.startsWith("image:")) restoredImages[key.slice(6)] = makeUrl(blob);
        });
        setImages(restoredImages);
        if (files.audio) {
          const url = makeUrl(files.audio);
          setAudioUrl(url);
          audioDuration(url).then(setAudioLength).catch(() => setAudioLength(null));
        }
        if (files.music) setMusicUrl(makeUrl(files.music));
        if (files.thumbnail) {
          setThumbnailFile(files.thumbnail);
          setThumbnailUrl(makeUrl(files.thumbnail));
        }
      } catch {
        setNotice("تعذر استعادة بعض ملفات المشروع المحفوظة في المتصفح.");
      } finally {
        if (active) setHydrated(true);
      }
    };
    void restore();
    void refreshYouTubeStatus();
    const params = new URLSearchParams(window.location.search);
    if (params.get("youtube") === "connected") {
      setNotice("تم ربط حساب YouTube. يمكنك رفع الفيديو بعد تصديره.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.get("youtube") === "error") {
      setError(params.get("message") || "تعذر ربط حساب YouTube.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    return () => {
      active = false;
      localUrls.current.forEach((url) => URL.revokeObjectURL(url));
      localUrls.current.clear();
    };
  }, [makeUrl, refreshYouTubeStatus]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("hikaya:brief", JSON.stringify(brief));
    if (plan) localStorage.setItem("hikaya:plan", JSON.stringify(plan));
    else localStorage.removeItem("hikaya:plan");
    localStorage.setItem("hikaya:meta", JSON.stringify({ imageNames, audioName, musicName, thumbnailName, subtitles, subtitleName, planSource, youtubePrivacy, madeForKids, containsSyntheticMedia }));
  }, [hydrated, brief, plan, imageNames, audioName, musicName, thumbnailName, subtitles, subtitleName, planSource, youtubePrivacy, madeForKids, containsSyntheticMedia]);

  const totalDuration = useMemo(() => plan?.scenes.reduce((sum, scene) => sum + Number(scene.durationSec || 0), 0) ?? 0, [plan]);
  const uploadedCount = useMemo(() => plan?.scenes.filter((scene) => Boolean(images[scene.id])).length ?? 0, [plan, images]);
  const captionsCount = useMemo(() => parseSrt(subtitles).length, [subtitles]);
  const allImagesReady = Boolean(plan && plan.scenes.length && uploadedCount === plan.scenes.length);

  const resetMedia = useCallback(async () => {
    Object.values(images).forEach(releaseUrl);
    releaseUrl(audioUrl);
    releaseUrl(musicUrl);
    releaseUrl(thumbnailUrl);
    setImages({});
    setImageNames({});
    setAudioUrl(undefined);
    setAudioName("");
    setAudioLength(null);
    setMusicUrl(undefined);
    setMusicName("");
    setThumbnailFile(null);
    setThumbnailUrl(undefined);
    setThumbnailName("");
    setSubtitles("");
    setSubtitleName("");
    setRenderBlob(null);
    setYoutubeResult(null);
    await clearMedia();
  }, [images, audioUrl, musicUrl, thumbnailUrl, releaseUrl]);

  const createPlan = async () => {
    if (brief.description.trim().length < 15) {
      setError("اكتب وصفاً أوضح للحلقة، 15 حرفاً على الأقل.");
      return;
    }
    setGenerating(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(brief) });
      const data = (await response.json()) as PlanResponse & { error?: string };
      if (!response.ok || !data.plan) throw new Error(data.error || "تعذر إنشاء الخطة.");
      await resetMedia();
      setPlan(data.plan);
      setPlanSource(data.source);
      setStage(1);
      setNotice(data.notice || (data.source === "template" ? "هذه خطة أولية قابلة للتعديل. اربط Gemini أو Ollama لتوليد خطة مخصصة لوصفك." : "الخطة جاهزة. راجعها قبل توليد الصور."));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إنشاء الخطة.");
    } finally {
      setGenerating(false);
    }
  };

  const updatePlan = (field: keyof EpisodePlan, value: EpisodePlan[keyof EpisodePlan]) => {
    setPlan((current) => current ? { ...current, [field]: value } : current);
    setRenderBlob(null);
  };

  const updateScene = <K extends keyof EpisodeScene>(id: string, field: K, value: EpisodeScene[K]) => {
    setPlan((current) => current ? { ...current, scenes: current.scenes.map((scene) => scene.id === id ? { ...scene, [field]: value } : scene) } : current);
    setRenderBlob(null);
  };

  const moveScene = (index: number, direction: -1 | 1) => {
    setPlan((current) => {
      if (!current || index + direction < 0 || index + direction >= current.scenes.length) return current;
      const scenes = [...current.scenes];
      [scenes[index], scenes[index + direction]] = [scenes[index + direction], scenes[index]];
      return { ...current, scenes };
    });
    setRenderBlob(null);
  };

  const addScene = () => {
    setPlan((current) => !current ? current : {
      ...current,
      scenes: [...current.scenes, {
        id: `scene-${crypto.randomUUID()}`,
        title: "مشهد جديد",
        durationSec: 8,
        narration: "",
        onScreenText: "",
        imagePrompt: `${current.visualBible}. مشهد تعليمي جديد، مساحة خالية للنص العربي، بلا كتابة أو شعارات داخل الصورة.`,
        motion: "push-in",
        transition: "fade",
      }],
    });
    setRenderBlob(null);
  };

  const deleteScene = async (id: string) => {
    if (!plan || plan.scenes.length <= 1) return;
    setPlan({ ...plan, scenes: plan.scenes.filter((scene) => scene.id !== id) });
    releaseUrl(images[id]);
    setImages((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setImageNames((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setRenderBlob(null);
    await removeMedia(`image:${id}`).catch(() => undefined);
  };

  const copyText = async (value: string, success: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(success);
      setError("");
    } catch {
      setError("تعذر النسخ التلقائي. حدّد النص وانسخه يدوياً.");
    }
  };

  const uploadImage = async (sceneId: string, file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("اختر ملف صورة صالحاً."); return; }
    const url = makeUrl(file);
    releaseUrl(images[sceneId]);
    setImages((current) => ({ ...current, [sceneId]: url }));
    setImageNames((current) => ({ ...current, [sceneId]: file.name }));
    setRenderBlob(null);
    try { await saveMedia(`image:${sceneId}`, file); } catch { setNotice("الصورة جاهزة الآن، لكن المتصفح لم يتمكن من حفظها لاستعادة المشروع لاحقاً."); }
  };

  const uploadAudio = async (file?: File, kind: "audio" | "music" = "audio") => {
    if (!file) return;
    if (!file.type.startsWith("audio/")) { setError("اختر ملف صوت صالحاً."); return; }
    const url = makeUrl(file);
    if (kind === "audio") {
      releaseUrl(audioUrl);
      setAudioUrl(url);
      setAudioName(file.name);
      try { setAudioLength(await audioDuration(url)); } catch { setAudioLength(null); }
    } else {
      releaseUrl(musicUrl);
      setMusicUrl(url);
      setMusicName(file.name);
    }
    setRenderBlob(null);
    try { await saveMedia(kind, file); } catch { setNotice("الصوت جاهز الآن، لكن المتصفح لم يتمكن من حفظه لاستعادة المشروع لاحقاً."); }
  };

  const uploadSubtitles = async (file?: File) => {
    if (!file) return;
    const content = await file.text();
    if (parseSrt(content).length === 0) { setError("لم أجد توقيتاً صالحاً داخل ملف SRT."); return; }
    setSubtitles(content);
    setSubtitleName(file.name);
    setRenderBlob(null);
    setError("");
  };

  const uploadThumbnail = async (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError("اختر صورة مصغّرة بصيغة PNG أو JPG وبحجم لا يتجاوز 10 MB.");
      return;
    }
    releaseUrl(thumbnailUrl);
    setThumbnailFile(file);
    setThumbnailUrl(makeUrl(file));
    setThumbnailName(file.name);
    setError("");
    try { await saveMedia("thumbnail", file); } catch { setNotice("الصورة المصغّرة جاهزة، لكن تعذّر حفظها لاستعادة المشروع لاحقاً."); }
  };

  const matchAudioLength = () => {
    if (!plan || !audioLength || !totalDuration) return;
    const ratio = audioLength / totalDuration;
    setPlan({ ...plan, scenes: plan.scenes.map((scene) => ({ ...scene, durationSec: Math.max(2, Math.round(scene.durationSec * ratio * 10) / 10) })) });
    setRenderBlob(null);
    setNotice("تم توزيع مدة الصوت على المشاهد. راجع حدود المشاهد من المعاينة قبل التصدير.");
  };

  const uploadToYouTube = async (blob: Blob) => {
    if (!plan) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("video", new File([blob], `${safeFileName(plan.title)}.mp4`, { type: "video/mp4" }));
      form.append("title", plan.youtubeTitle || plan.title);
      form.append("description", plan.youtubeDescription || plan.description);
      form.append("tags", JSON.stringify(plan.youtubeTags));
      form.append("privacyStatus", youtubePrivacy);
      form.append("madeForKids", String(madeForKids));
      form.append("containsSyntheticMedia", String(containsSyntheticMedia));
      if (thumbnailFile) form.append("thumbnail", thumbnailFile, thumbnailName || "thumbnail.png");
      const response = await fetch("/api/youtube/upload", { method: "POST", body: form });
      const data = (await response.json()) as { videoId?: string; url?: string; error?: string; message?: string; privacyStatus?: YouTubePrivacy | null; requestedPrivacyStatus?: YouTubePrivacy; thumbnailWarning?: string | null };
      if (!response.ok || !data.videoId) throw new Error(data.message || data.error || "تعذر رفع الفيديو إلى YouTube.");
      setYoutubeResult({ videoId: data.videoId, url: data.url || `https://www.youtube.com/watch?v=${data.videoId}` });
      const uploadNotice = data.privacyStatus && data.privacyStatus !== data.requestedPrivacyStatus
        ? `اكتمل الرفع، لكن YouTube ضبط خصوصية الفيديو على ${data.privacyStatus === "private" ? "خاص" : data.privacyStatus === "unlisted" ? "غير مدرج" : "عام"}. راجع حالة النشر في YouTube Studio.`
        : "اكتمل رفع الفيديو إلى YouTube. راجع حالة النشر من الرابط.";
      setNotice(data.thumbnailWarning ? `${uploadNotice} ${data.thumbnailWarning}` : uploadNotice);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر رفع الفيديو إلى YouTube.");
    } finally {
      setUploading(false);
    }
  };

  const exportVideo = async () => {
    if (!plan || !allImagesReady) { setError("ارفع صورة لكل مشهد قبل التصدير."); return; }
    setRendering(true);
    setRenderProgress(0);
    setRenderBlob(null);
    setYoutubeResult(null);
    setError("");
    setNotice("");
    try {
      const { renderEpisode } = await import("@/lib/video/renderEpisode");
      const blob = await renderEpisode({ plan, images, audioUrl, musicUrl, subtitles, onProgress: setRenderProgress });
      setRenderBlob(blob);
      downloadBlob(blob, `${safeFileName(plan.title)}.mp4`);
      setNotice("تم تصدير الفيديو وتنزيله على جهازك.");
      if (autoUpload && youtubeStatus.connected) await uploadToYouTube(blob);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تصدير الفيديو.");
    } finally {
      setRendering(false);
    }
  };

  const newProject = async () => {
    if (!window.confirm("إنشاء مشروع جديد سيحذف الخطة والملفات المحفوظة لهذا المشروع من المتصفح. هل تتابع؟")) return;
    await resetMedia();
    setPlan(null);
    setPlanSource(null);
    setBrief(DEFAULT_BRIEF);
    setStage(0);
    setError("");
    setNotice("بدأنا مشروعاً جديداً.");
  };

  const exportPlanJson = () => {
    if (!plan) return;
    downloadBlob(new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }), `${safeFileName(plan.title)}-plan.json`);
  };

  const promptBundle = plan ? [
    `الدليل البصري:\n${plan.visualBible}`,
    ...plan.scenes.map((scene, index) => `المشهد ${index + 1} — ${scene.title}\n${scene.imagePrompt}`),
  ].join("\n\n━━━━━━━━━━━━━━━━\n\n") : "";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark"><Clapperboard size={25} strokeWidth={2.4} /></span>
            <div><strong>حكايا<span>ستوديو</span></strong><small>من فكرة إلى فيديو</small></div>
          </div>
          <div className="topbar-actions">
            <span className="local-badge"><span /> يعمل على جهازك</span>
            {plan && <button type="button" className="button button-ghost button-sm" onClick={newProject}><Plus size={16} /> مشروع جديد</button>}
          </div>
        </div>
      </header>

      <main className="studio-layout">
        <aside className="steps-panel">
          <div className="steps-intro"><span className="eyebrow">مساحة العمل</span><h2>رحلة الفيديو</h2><p>كل خطوة تقرّبك من حلقة جاهزة للنشر.</p></div>
          <nav className="steps-list" aria-label="مراحل العمل">
            {STAGES.map((item, index) => {
              const Icon = item.icon;
              const active = stage === index;
              const done = index < stage;
              const disabled = index > 0 && !plan;
              return <button key={item.label} type="button" className={`step-item ${active ? "active" : ""} ${done ? "done" : ""}`} disabled={disabled} onClick={() => setStage(index as Stage)}>
                <span className="step-icon">{done ? <Check size={18} /> : <Icon size={18} />}</span>
                <span className="step-copy"><strong>{item.label}</strong><small>{item.hint}</small></span>
                <span className="step-number">0{index + 1}</span>
              </button>;
            })}
          </nav>
          <div className="rail-tip"><Sparkles size={19} /><div><strong>نصيحة إنتاج</strong><p>ثبات أسلوب الصور والصوت أهم من كثرة المؤثرات.</p></div></div>
        </aside>

        <section className="work-panel">
          {notice && <div className="message message-success" role="status"><CheckCircle2 size={18} /><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="إغلاق">×</button></div>}
          {error && <div className="message message-error" role="alert"><AlertCircle size={18} /><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="إغلاق">×</button></div>}

          {stage === 0 && <>
            <div className="hero-card">
              <div className="hero-content"><span className="hero-chip"><WandSparkles size={15} /> استوديو صناعة الفيديو</span><h1>حوّل فكرتك إلى<br /><em>حكاية تُشاهد</em></h1><p>صف الحلقة التي تريدها. سنرتّب المشاهد ونكتب برومبتات الصور، ثم تتولى أنت إضافة صورك وصوتك.</p></div>
              <div className="hero-art" aria-hidden="true"><div className="art-orbit art-orbit-1" /><div className="art-orbit art-orbit-2" /><div className="art-play"><Film size={46} /></div><div className="art-spark art-spark-1">✦</div><div className="art-spark art-spark-2">✦</div><div className="art-card art-card-1" /><div className="art-card art-card-2" /></div>
            </div>
            <div className="panel-card brief-card">
              <div className="section-heading"><span className="section-icon coral"><FileText size={21} /></span><div><span className="eyebrow">الخطوة الأولى</span><h2>ما فكرة الحلقة؟</h2><p>كلما كان الوصف محدداً، جاءت الخطة والبرومبتات أقرب لما تتخيله.</p></div></div>
              <label className="field"><span>وصف الحلقة <b>*</b></span><textarea rows={5} value={brief.description} onChange={(event) => setBrief({ ...brief, description: event.target.value })} placeholder="مثال: طفلة كرتونية مرحة تعلّم حرف الباء لأطفال الروضة عبر قصة قصيرة مع بالون وبطة وباب، بأسلوب دافئ وبسيط..." /><small>اذكر الموضوع، الشخصية، وما الذي تريد أن يتعلمه الطفل في النهاية.</small></label>
              <div className="form-grid">
                <label className="field"><span>الفئة العمرية</span><select value={brief.ageGroup} onChange={(event) => setBrief({ ...brief, ageGroup: event.target.value })}><option>3–4 سنوات</option><option>4–6 سنوات</option><option>6–8 سنوات</option><option>8–10 سنوات</option></select></label>
                <label className="field"><span>مدة الحلقة</span><select value={brief.durationSec} onChange={(event) => setBrief({ ...brief, durationSec: Number(event.target.value) })}><option value={45}>45 ثانية</option><option value={60}>دقيقة</option><option value={90}>دقيقة ونصف</option><option value={120}>دقيقتان</option><option value={180}>3 دقائق</option></select></label>
                <label className="field"><span>نسبة الفيديو</span><select value={brief.format} onChange={(event) => setBrief({ ...brief, format: event.target.value as VideoFormat })}><option value="16:9">أفقي 16:9 — يوتيوب</option><option value="9:16">عمودي 9:16 — Shorts</option></select></label>
                <label className="field"><span>لغة التعليق</span><select value={brief.language} onChange={(event) => setBrief({ ...brief, language: event.target.value })}><option>العربية الفصحى المبسطة</option><option>اللهجة الشامية المبسطة</option><option>العربية المصرية المبسطة</option><option>الإنجليزية المبسطة</option></select></label>
              </div>
              <label className="field"><span>الأسلوب البصري</span><input value={brief.artStyle} onChange={(event) => setBrief({ ...brief, artStyle: event.target.value })} placeholder="مثال: رسوم أطفال ثنائية الأبعاد بألوان دافئة" /></label>
              <div className="form-footer"><span><CheckCircle2 size={16} /> يمكنك تعديل كل شيء بعد إنشاء الخطة</span><button type="button" className="button button-primary" disabled={generating} onClick={createPlan}>{generating ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}{generating ? "عم جهّز الخطة..." : "أنشئ الخطة والبرومبتات"}<ArrowLeft size={18} /></button></div>
            </div>
          </>}

          {stage === 1 && plan && <>
            <div className="page-heading"><div><span className="eyebrow">الخطوة 02 / 04</span><h1>خطة الحلقة</h1><p>راجع النصوص والبرومبتات قبل أن تبدأ بتوليد الصور.</p></div><span className="count-pill">{plan.scenes.length} مشاهد · {formatTime(totalDuration)}</span></div>
            <div className="panel-card plan-overview">
              <div className="card-title-row"><div className="section-heading compact"><span className="section-icon violet"><ClipboardList size={21} /></span><div><h2>بطاقة الحلقة</h2><p>هوية الفيديو ونصه العام</p></div></div><span className="source-badge">{planSource === "gemini" ? "خطة Gemini" : planSource === "ollama" ? "خطة محلية" : "قالب قابل للتعديل"}</span></div>
              <div className="form-grid"><label className="field"><span>عنوان الحلقة</span><input value={plan.title} onChange={(event) => updatePlan("title", event.target.value)} /></label><label className="field"><span>وصف مختصر</span><input value={plan.description} onChange={(event) => updatePlan("description", event.target.value)} /></label></div>
              <label className="field"><span>الدليل البصري الموحد للشخصية والأسلوب</span><textarea rows={3} value={plan.visualBible} onChange={(event) => updatePlan("visualBible", event.target.value)} /><small>استخدم هذا الوصف مع كل برومبت. إذا كانت أداة الصور تدعم صورة مرجعية، أرفق نفس صورة الشخصية بكل مشهد.</small></label>
              <div className="inline-actions"><button type="button" className="button button-soft" onClick={() => copyText(promptBundle, "تم نسخ جميع البرومبتات.")}><Copy size={16} /> نسخ كل البرومبتات</button><button type="button" className="button button-ghost" onClick={exportPlanJson}><Download size={16} /> تنزيل الخطة JSON</button></div>
            </div>
            <div className="scene-heading"><div><span className="eyebrow">لوحة المشاهد</span><h2>كل مشهد له صورة وبرومبت</h2></div><button type="button" className="button button-soft" onClick={addScene}><Plus size={16} /> أضف مشهداً</button></div>
            <div className="scene-list">{plan.scenes.map((scene, index) => <article key={scene.id} className="panel-card scene-card">
              <div className="scene-top"><span className="scene-index">{String(index + 1).padStart(2, "0")}</span><div className="scene-title-input"><span>المشهد {index + 1}</span><input value={scene.title} onChange={(event) => updateScene(scene.id, "title", event.target.value)} aria-label={`عنوان المشهد ${index + 1}`} /></div><div className="scene-tools"><button type="button" title="تحريك للأعلى" aria-label="تحريك للأعلى" disabled={index === 0} onClick={() => moveScene(index, -1)}><ChevronUp size={17} /></button><button type="button" title="تحريك للأسفل" aria-label="تحريك للأسفل" disabled={index === plan.scenes.length - 1} onClick={() => moveScene(index, 1)}><ChevronDown size={17} /></button><button type="button" title="حذف المشهد" aria-label="حذف المشهد" disabled={plan.scenes.length === 1} onClick={() => void deleteScene(scene.id)}><Trash2 size={17} /></button></div></div>
              <div className="scene-fields"><label className="field"><span>التعليق الصوتي</span><textarea rows={2} value={scene.narration} onChange={(event) => updateScene(scene.id, "narration", event.target.value)} /></label><label className="field"><span>النص الظاهر على الفيديو</span><input value={scene.onScreenText} onChange={(event) => updateScene(scene.id, "onScreenText", event.target.value)} /></label></div>
              <div className="prompt-box"><div className="prompt-head"><span><WandSparkles size={16} /> برومبت الصورة</span><button type="button" onClick={() => copyText(`${plan.visualBible}\n\n${scene.imagePrompt}`, `تم نسخ برومبت المشهد ${index + 1}.`)}><Copy size={15} /> نسخ</button></div><textarea rows={3} value={scene.imagePrompt} onChange={(event) => updateScene(scene.id, "imagePrompt", event.target.value)} /></div>
              <div className="scene-settings"><label><Clock3 size={15} /> <input type="number" min={2} max={60} step={0.5} value={scene.durationSec} onChange={(event) => updateScene(scene.id, "durationSec", Math.max(2, Number(event.target.value) || 2))} /> ثانية</label><label>الحركة <select value={scene.motion} onChange={(event) => updateScene(scene.id, "motion", event.target.value as EpisodeScene["motion"])}>{MOTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>الانتقال <select value={scene.transition} onChange={(event) => updateScene(scene.id, "transition", event.target.value as EpisodeScene["transition"])}>{TRANSITIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>
            </article>)}</div>
            <div className="bottom-navigation"><button type="button" className="button button-ghost" onClick={() => setStage(0)}><ArrowRight size={18} /> تعديل الفكرة</button><button type="button" className="button button-primary" onClick={() => setStage(2)}>انتقل إلى رفع الملفات <ArrowLeft size={18} /></button></div>
          </>}

          {stage === 2 && plan && <>
            <div className="page-heading"><div><span className="eyebrow">الخطوة 03 / 04</span><h1>صورك وصوتك</h1><p>ارفع الصورة المناسبة لكل مشهد، ثم أضف التعليق والترجمة إذا أردت.</p></div><span className="count-pill">{uploadedCount} / {plan.scenes.length} صور جاهزة</span></div>
            <div className="upload-progress"><div><Images size={18} /><strong>صور المشاهد</strong><span>{Math.round(uploadedCount / plan.scenes.length * 100)}%</span></div><div className="progress-track"><span style={{ width: `${uploadedCount / plan.scenes.length * 100}%` }} /></div></div>
            <div className="upload-grid">{plan.scenes.map((scene, index) => <div key={scene.id} className={`upload-card ${images[scene.id] ? "filled" : ""}`}>
              <div className="upload-visual">{images[scene.id] ? <img src={images[scene.id]} alt={`صورة ${scene.title}`} /> : <div className="upload-empty"><ImagePlus size={29} /><span>صورة المشهد {index + 1}</span></div>}<span className="upload-index">{String(index + 1).padStart(2, "0")}</span></div>
              <div className="upload-card-body"><strong>{scene.title}</strong><small>{imageNames[scene.id] || "PNG أو JPG أو WebP"}</small><label className="button button-soft button-block"><UploadCloud size={16} /> {images[scene.id] ? "تغيير الصورة" : "رفع الصورة"}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { void uploadImage(scene.id, event.target.files?.[0]); event.target.value = ""; }} /></label></div>
            </div>)}</div>
            <div className="panel-card audio-card"><div className="section-heading compact"><span className="section-icon coral"><Mic2 size={21} /></span><div><h2>التعليق الصوتي</h2><p>ملف صوت واحد للحلقة، ويمكنك تعديل مدد المشاهد ليلائمه.</p></div></div><label className="file-drop"><UploadCloud size={23} /><div><strong>{audioName || "ارفع صوت الحلقة"}</strong><span>{audioLength ? `المدة ${formatTime(audioLength)} · ` : ""}MP3 أو WAV أو M4A</span></div><input type="file" accept="audio/*" hidden onChange={(event) => { void uploadAudio(event.target.files?.[0], "audio"); event.target.value = ""; }} /></label>{audioUrl && <audio controls src={audioUrl} className="inline-audio" />}{audioLength && Math.abs(audioLength - totalDuration) > 2 ? <div className="sync-note"><AlertCircle size={17} /><span>طول الصوت {formatTime(audioLength)} وطول المشاهد {formatTime(totalDuration)}.</span><button type="button" onClick={matchAudioLength}>وزّع المدة تلقائياً</button></div> : null}</div>
            <div className="media-two-col"><div className="panel-card small-media-card"><div className="section-heading compact"><span className="section-icon violet"><FileText size={19} /></span><div><h2>الترجمة</h2><p>تظهر داخل الفيديو بتوقيت ملف SRT.</p></div></div><label className="file-drop compact-drop"><UploadCloud size={21} /><div><strong>{subtitleName || "ارفع ملف SRT"}</strong><span>{captionsCount ? `${captionsCount} مقطع ترجمة` : "اختياري، ويمكن تعديل النص أدناه"}</span></div><input type="file" accept=".srt,text/plain" hidden onChange={(event) => { void uploadSubtitles(event.target.files?.[0]); event.target.value = ""; }} /></label><textarea rows={4} className="subtitle-editor" value={subtitles} onChange={(event) => { setSubtitles(event.target.value); setRenderBlob(null); }} placeholder="1\n00:00:00,000 --> 00:00:03,000\nمرحباً يا أصدقاء!" /><small className="field-help">توقيت الترجمة يعتمد على ملف SRT؛ راجع المعاينة قبل التصدير.</small></div>
            <div className="panel-card small-media-card"><div className="section-heading compact"><span className="section-icon gold"><Music2 size={19} /></span><div><h2>موسيقى خلفية</h2><p>يمزجها الموقع بصوت منخفض تحت التعليق.</p></div></div><label className="file-drop compact-drop"><UploadCloud size={21} /><div><strong>{musicName || "ارفع مقطعاً موسيقياً"}</strong><span>اختياري — استخدم موسيقى تملك حق نشرها</span></div><input type="file" accept="audio/*" hidden onChange={(event) => { void uploadAudio(event.target.files?.[0], "music"); event.target.value = ""; }} /></label>{musicUrl && <audio controls src={musicUrl} className="inline-audio" />}</div></div>
            <div className="bottom-navigation"><button type="button" className="button button-ghost" onClick={() => setStage(1)}><ArrowRight size={18} /> تعديل المشاهد</button><button type="button" className="button button-primary" onClick={() => setStage(3)}>المعاينة والتصدير <ArrowLeft size={18} /></button></div>
          </>}

          {stage === 3 && plan && <>
            <div className="page-heading"><div><span className="eyebrow">الخطوة 04 / 04</span><h1>جاهز للعرض؟</h1><p>راجع الملفات والبيانات، ثم صدّر الفيديو وارفعه إلى قناتك.</p></div><span className="count-pill">{plan.format} · {formatTime(totalDuration)}</span></div>
            <div className="panel-card readiness-card"><div className="section-heading compact"><span className="section-icon gold"><CheckCircle2 size={21} /></span><div><h2>فحص ما قبل التصدير</h2><p>كل ما تحتاجه لحلقة واضحة ومتناسقة.</p></div></div><div className="readiness-list"><div className={allImagesReady ? "ready" : "pending"}>{allImagesReady ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}<span>صور جميع المشاهد</span><strong>{uploadedCount}/{plan.scenes.length}</strong></div><div className={audioUrl ? "ready" : "pending"}>{audioUrl ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}<span>التعليق الصوتي</span><strong>{audioUrl ? "جاهز" : "اختياري، لكن مهم للجودة"}</strong></div><div className={captionsCount ? "ready" : "pending"}>{captionsCount ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}<span>الترجمة الموقّتة</span><strong>{captionsCount ? `${captionsCount} مقطع` : "اختيارية"}</strong></div></div></div>
            <div className="panel-card export-card"><div className="section-heading compact"><span className="section-icon coral"><Clapperboard size={21} /></span><div><h2>تصدير الفيديو</h2><p>MP4 بجودة 1080p، يحفظ مباشرة على جهازك.</p></div></div>{rendering && <div className="render-progress"><div><span>جاري تركيب الفيديو...</span><strong>{Math.round(renderProgress * 100)}%</strong></div><div className="progress-track"><span style={{ width: `${renderProgress * 100}%` }} /></div></div>}<button type="button" className="button button-primary button-large button-block" disabled={rendering || uploading || !allImagesReady} onClick={exportVideo}>{rendering ? <LoaderCircle className="spin" size={21} /> : <Download size={21} />}{rendering ? "جاري التصدير..." : "صدّر ونزّل الفيديو"}</button>{renderBlob && <div className="export-success"><CheckCircle2 size={18} /> الفيديو جاهز ({(renderBlob.size / 1024 / 1024).toFixed(1)} MB). <button type="button" onClick={() => downloadBlob(renderBlob, `${safeFileName(plan.title)}.mp4`)}>نزّله مجدداً</button></div>}</div>
            <div className="panel-card youtube-card"><div className="card-title-row"><div className="section-heading compact"><span className="section-icon red"><Youtube size={21} /></span><div><h2>النشر على YouTube</h2><p>اربط قناتك وارفع الفيديو من هنا بعد التصدير.</p></div></div><span className={`connection-badge ${youtubeStatus.connected ? "connected" : ""}`}>{youtubeStatus.connected ? "القناة متصلة" : "غير متصل"}</span></div>
              {youtubeStatus.connected ? <div className="youtube-connected"><CheckCircle2 size={18} /><span>{youtubeStatus.channelTitle || "حساب YouTube متصل"}</span><button type="button" onClick={async () => { await fetch("/api/youtube/disconnect", { method: "POST" }); void refreshYouTubeStatus(); setNotice("تم فصل حساب YouTube."); }}>فصل الحساب</button></div> : <div className="youtube-connect"><div><strong>{youtubeStatus.configured ? "اربط قناتك للرفع المباشر" : "يلزم إعداد مفاتيح Google OAuth مرة واحدة"}</strong><small>{youtubeStatus.message || "الربط يتم على جهازك ولا يخزّن الموقع كلمة مرور Google."}</small></div>{youtubeStatus.configured ? <a className="button button-soft" href="/api/youtube/authorize"><Link2 size={16} /> ربط القناة</a> : <a className="button button-soft" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer"><ExternalLink size={16} /> إعداد Google</a>}</div>}
              <div className="youtube-fields"><label className="field"><span>عنوان الفيديو على YouTube</span><input maxLength={100} value={plan.youtubeTitle} onChange={(event) => updatePlan("youtubeTitle", event.target.value)} /></label><label className="field"><span>الوصف</span><textarea rows={4} value={plan.youtubeDescription} onChange={(event) => updatePlan("youtubeDescription", event.target.value)} /></label><label className="field"><span>الوسوم — افصل بينها بفاصلة</span><input value={plan.youtubeTags.join("، ")} onChange={(event) => updatePlan("youtubeTags", event.target.value.split(/[،,]/).map((tag) => tag.trim()).filter(Boolean))} /></label><div className="form-grid"><label className="field"><span>حالة النشر</span><select value={youtubePrivacy} onChange={(event) => setYoutubePrivacy(event.target.value as YouTubePrivacy)}><option value="private">خاص — راجعه أولاً</option><option value="unlisted">غير مدرج</option><option value="public">عام</option></select></label><label className="field"><span>الجمهور</span><select value={madeForKids ? "yes" : "no"} onChange={(event) => setMadeForKids(event.target.value === "yes")}><option value="yes">مخصص للأطفال</option><option value="no">غير مخصص للأطفال</option></select></label></div></div>
              <div className="thumbnail-picker">
                <div className="thumbnail-heading"><strong>الصورة المصغّرة للفيديو</strong><span>اختيارية · PNG أو JPG · يفضّل مقاس 16:9</span></div>
                <label className="file-drop compact-drop">
                  {thumbnailUrl ? <img className="thumbnail-preview" src={thumbnailUrl} alt="معاينة الصورة المصغّرة" /> : <ImagePlus size={22} />}
                  <div><strong>{thumbnailName || "ارفع غلاف الحلقة"}</strong><span>ستُرفع بعد نجاح رفع الفيديو</span></div>
                  <input type="file" accept="image/png,image/jpeg" hidden onChange={(event) => { void uploadThumbnail(event.target.files?.[0]); event.target.value = ""; }} />
                </label>
              </div>
              <label className="checkbox-row synthetic-row"><input type="checkbox" checked={containsSyntheticMedia} onChange={(event) => setContainsSyntheticMedia(event.target.checked)} /><span>أصرّح بوجود محتوى اصطناعي واقعي إذا كان ينطبق على الحلقة؛ الرسوم الكرتونية غير الواقعية لا تحتاج هذا الخيار عادةً.</span></label>
              <label className="checkbox-row"><input type="checkbox" checked={autoUpload} onChange={(event) => setAutoUpload(event.target.checked)} disabled={!youtubeStatus.connected} /><span>ارفع تلقائياً إلى YouTube بعد نجاح تصدير الفيديو</span></label>
              <button type="button" className="button button-youtube button-block" disabled={!renderBlob || !youtubeStatus.connected || uploading || rendering} onClick={() => renderBlob && void uploadToYouTube(renderBlob)}>{uploading ? <LoaderCircle className="spin" size={18} /> : <Youtube size={18} />}{uploading ? "جاري الرفع إلى YouTube..." : "ارفع الفيديو الجاهز الآن"}</button>
              {youtubeResult && <a className="youtube-result" href={youtubeResult.url} target="_blank" rel="noreferrer"><CheckCircle2 size={18} /> تم الرفع. افتح الفيديو على YouTube <ExternalLink size={15} /></a>}
              <p className="youtube-footnote">قد تفرض Google رفع الفيديوهات كخاصة إلى أن تُراجع مشروع API الخاص بك. راجع حالة الفيديو من YouTube Studio.</p>
            </div>
            <div className="bottom-navigation"><button type="button" className="button button-ghost" onClick={() => setStage(2)}><ArrowRight size={18} /> تعديل الملفات</button></div>
          </>}
        </section>

        <aside className="preview-panel"><div className="preview-sticky"><div className="preview-header"><div><span className="eyebrow">المعاينة المباشرة</span><h2>شاشة الحلقة</h2></div><span className="preview-live"><span /> LIVE</span></div>{plan ? <VideoPreview plan={plan} images={images} audioUrl={audioUrl} musicUrl={musicUrl} subtitles={subtitles} className="video-preview" /> : <div className={`empty-preview ${brief.format === "9:16" ? "portrait" : ""}`}><div className="empty-preview-art"><div className="empty-sun" /><div className="empty-hill one" /><div className="empty-hill two" /><span>✦</span></div><div className="empty-preview-label"><Film size={25} /><strong>هنا تبدأ الحكاية</strong><small>ستظهر معاينة الفيديو بعد إنشاء الخطة</small></div></div>}<div className="preview-meta"><div><span>المدة</span><strong>{plan ? formatTime(totalDuration) : formatTime(brief.durationSec)}</strong></div><div><span>المقاس</span><strong>{plan?.format || brief.format}</strong></div><div><span>المشاهد</span><strong>{plan?.scenes.length || "—"}</strong></div></div><div className="preview-note"><span className="note-icon"><Sparkles size={17} /></span><p>اسحب الصور على المشاهد، وشاهد التغييرات هنا قبل إخراج الملف النهائي.</p></div><div className="preview-footer"><span><RotateCcw size={14} /> حفظ تلقائي على هذا المتصفح</span></div></div></aside>
      </main>
    </div>
  );
}

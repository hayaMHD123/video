import type { EpisodePlan, EpisodeScene, PlanRequest } from "../types";

type SceneDraft = Pick<EpisodeScene, "title" | "narration" | "onScreenText"> & {
  visual: string;
};

const motionCycle: EpisodeScene["motion"][] = [
  "push-in", "pan-right", "float", "pan-left", "pull-out",
];

// Known subjects get concrete English image prompts. Other subjects stay
// verbatim so the creator can refine them before generating pictures.
const visualGlossary: Record<string, string> = {
  "بطة": "a cheerful yellow duck beside a small pond",
  "بالون": "a bright round balloon floating in the air",
  "باب": "a colorful front door slightly open",
  "بيت": "a cozy little house",
  "بقرة": "a friendly cow in a meadow",
  "تفاحة": "a shiny red apple",
  "قطة": "a playful kitten",
  "كلب": "a friendly puppy",
  "شمس": "a warm sun in a blue sky",
  "قمر": "a gentle moon in a night sky",
  "زهرة": "a colorful flower in a garden",
  "سيارة": "a small toy car",
  "سمكة": "a colorful fish swimming underwater",
  "فراشة": "a bright butterfly above flowers",
};

const letterNames: Record<string, string> = {
  "ألف": "ا", "الألف": "ا", "باء": "ب", "الباء": "ب", "تاء": "ت", "التاء": "ت",
  "ثاء": "ث", "الثاء": "ث", "جيم": "ج", "الجيم": "ج", "حاء": "ح", "الحاء": "ح",
  "خاء": "خ", "الخاء": "خ", "دال": "د", "الدال": "د", "ذال": "ذ", "الذال": "ذ",
  "راء": "ر", "الراء": "ر", "زاي": "ز", "الزاي": "ز", "سين": "س", "السين": "س",
  "شين": "ش", "الشين": "ش", "صاد": "ص", "الصاد": "ص", "ضاد": "ض", "الضاد": "ض",
  "طاء": "ط", "الطاء": "ط", "ظاء": "ظ", "الظاء": "ظ", "عين": "ع", "العين": "ع",
  "غين": "غ", "الغين": "غ", "فاء": "ف", "الفاء": "ف", "قاف": "ق", "القاف": "ق",
  "كاف": "ك", "الكاف": "ك", "لام": "ل", "اللام": "ل", "ميم": "م", "الميم": "م",
  "نون": "ن", "النون": "ن", "هاء": "ه", "الهاء": "ه", "واو": "و", "الواو": "و",
  "ياء": "ي", "الياء": "ي",
};

function shortPhrase(value: string, maxWords = 7): string {
  return value
    .split(/\s+(?:فيها|فيه|مع|حيث|ثم|ويتضمن|يتضمن|تشمل|يشمل|وتسأل|تسأل|تحتوي|ويظهر|تتعرف|يتعرف|باستخدام|للأطفال|that|where|then|including)\s+/iu)[0]
    .split(/[،,؛;.!؟?\n]/u)[0]
    .trim()
    .split(/\s+/u)
    .slice(0, maxWords)
    .join(" ")
    .replace(/[،,:؛;\s]+$/u, "");
}

function extractTopic(description: string, arabic: boolean): string {
  if (arabic) {
    const letter = description.match(/حرف\s+([\p{Script=Arabic}]{1,10})/u);
    if (letter) return `حرف ${letter[1]}`;
    const marked = description.match(/(?:عن|حول|موضوع|لتعليم|تعليم|تعلّم|تعلم)\s+(.+)/u)?.[1];
    const candidate = shortPhrase(marked ?? description, 6)
      .replace(/^(?:الأطفال|الطفل|طفلة|فيديو|حلقة|قصة)\s+/u, "");
    return candidate || "موضوع جديد";
  }
  const marked = description.match(/(?:about|on|teaching|learning|exploring)\s+(.+)/i)?.[1];
  const candidate = shortPhrase(marked ?? description, 6)
    .replace(/^(?:a|an|the|short|educational|video|episode|for kids)\s+/i, "");
  return candidate || "a new topic";
}

function extractExamples(description: string, topic: string, arabic: boolean): string[] {
  const match = arabic
    ? description.match(/(?:تتعرف\s+على|يتعرف\s+على|أمثلة(?:\s+مثل)?|كلمات(?:\s+مثل)?|مثل|تشمل|يتضمن|تضم)\s*[:：]?\s+(.+)/u)
    : description.match(/(?:such as|including|examples?\s*(?:of|:)?|with)\s+(.+)/i);
  if (!match) return [];
  const list = match[1]
    .split(/\s+(?:ثم|بعدها|وأخيراً|وفي النهاية|وتسأل|ويسأل|then|finally|before)\s+/iu)[0]
    .split(/[.!؟?؛;\n]/u)[0];
  const parts = arabic ? list.split(/[،,]|\s+و\s*/u) : list.split(/,|\s+and\s+/i);
  return [...new Set(parts
    .map((part) => part.trim().replace(/^[\s:：]+|[\s:：]+$/gu, ""))
    .filter((part) => part.length > 1 && part.length <= 32 && part.split(/\s+/u).length <= 3 && part !== topic),
  )].slice(0, 4);
}

function visualFor(example: string): string {
  const plain = example.normalize("NFKC").replace(/[\u064B-\u065F]/gu, "");
  return visualGlossary[plain] ?? visualGlossary[plain.replace(/^ال/u, "")] ?? `a clear, recognizable depiction of ${example}`;
}

function joinArabic(items: string[]): string {
  if (items.length < 2) return items[0] ?? "";
  return `${items.slice(0, -1).join("، ")} و${items[items.length - 1]}`;
}

function makeExample(example: string, index: number, arabic: boolean, topic: string, letter: string | undefined): SceneDraft {
  const beginsWithLetter = letter && example.normalize("NFKC").replace(/[\u064B-\u065F]/gu, "").startsWith(letter);
  return {
    title: arabic ? `مثال: ${example}` : `Example: ${example}`,
    narration: arabic
      ? beginsWithLetter
        ? `أمامنا ${example}. كلمة ${example} تبدأ بحرف ${topic.replace(/^حرف\s+/u, "")}. قلها معي: ${example}.`
        : `أمامنا ${example}. قل الكلمة معي، ولاحظ شكلها وصوتها.`
      : `Here is ${example}. Say the word with me, then look closely at it.`,
    onScreenText: example,
    visual: `${index % 2 === 0 ? "Medium shot" : "Close-up"} of ${visualFor(example)}; the same cartoon girl notices it with curiosity; uncluttered background and a clear focal point`,
  };
}

function makeConcept(topic: string, arabic: boolean, letter: string | undefined): SceneDraft {
  return {
    title: arabic ? "الفكرة الأساسية" : "The main idea",
    narration: arabic
      ? letter ? `هذا ${topic}. سنبحث عنه في كلمات نعرفها.` : `اليوم سنتعرف إلى ${topic} خطوة خطوة.`
      : `Let's look closely at ${topic} before we try some examples.`,
    onScreenText: topic,
    visual: "The cartoon girl points to one large empty learning card in the center; playful educational props around it; keep the card blank for an editor-added label",
  };
}

function makeObservation(topic: string, examples: string[], arabic: boolean, index: number): SceneDraft {
  const subjects = examples.length ? examples.map(visualFor).join(", ") : `a simple visual representation of ${topic}`;
  const prompts = [
    `Three separate picture cards featuring ${subjects}; the cartoon girl compares them with a thoughtful expression`,
    `A closer view of ${subjects}; the cartoon girl points to one interesting detail`,
    `A playful everyday setting featuring ${subjects}; the cartoon girl discovers something new`,
    `A clear visual arrangement of ${subjects}; the cartoon girl pauses to think`,
  ];
  const arabicNarration = [
    `انظر إلى ${topic} عن قرب. ماذا تلاحظ أولاً؟`,
    `هل تستطيع أن تجد ${topic} في هذا المشهد؟`,
    `لنقارن الصور. ما الشيء المشترك بينها؟`,
    `حاول أن تصف ${topic} بكلماتك أنت.`,
  ];
  const englishNarration = [
    `Look closely at ${topic}. What do you notice first?`,
    `Can you find ${topic} in this scene?`,
    "Compare the pictures. What do they have in common?",
    `Try to describe ${topic} in your own words.`,
  ];
  return {
    title: arabic ? ["لننظر عن قرب", "في حياتنا", "فكّر وقارن", "صف ما ترى"][index % 4] : ["Close look", "Find it", "Think and compare", "Describe it"][index % 4],
    narration: arabic ? arabicNarration[index % 4] : englishNarration[index % 4],
    onScreenText: arabic ? "انظر جيداً" : "Look closely",
    visual: `${prompts[index % prompts.length]}; no writing on the objects`,
  };
}

export function createTemplatePlan(request: PlanRequest): EpisodePlan {
  const arabic = /arab|عرب|^ar$/i.test(request.language);
  const description = request.description.replace(/\s+/g, " ").trim();
  const topic = extractTopic(description, arabic);
  const examples = extractExamples(description, topic, arabic);
  const letterName = arabic ? topic.match(/^حرف\s+(.+)$/u)?.[1] : undefined;
  const letter = letterName ? letterNames[letterName] ?? (letterName.length === 1 ? letterName : undefined) : undefined;
  const sceneCount = request.durationSec < 50 ? 4 : request.durationSec < 90 ? 6 : 8;
  const baseDuration = Math.floor(request.durationSec / sceneCount);
  const leftover = request.durationSec % sceneCount;
  const visualBible = arabic
    ? `شخصية طفلة كرتونية لطيفة بملابس وألوان ثابتة طوال الحلقة؛ أسلوب ${request.artStyle}؛ خلفيات بسيطة، ألوان مبهجة ومتوازنة، إضاءة ناعمة، ومساحة فارغة آمنة للعناوين والترجمة. تكوين ${request.format}.`
    : `A friendly cartoon child protagonist with the same outfit and colors in every scene; ${request.artStyle}; simple backgrounds, balanced cheerful palette, soft lighting, and safe negative space for titles and captions. ${request.format} composition.`;

  const intro: SceneDraft = {
    title: arabic ? "بداية مشوقة" : "Welcome",
    narration: arabic ? `أهلاً يا أصدقاء! اليوم سنتعلم ${topic}. هيا نبدأ!` : `Hello, friends! Today we will learn about ${topic}. Let's begin!`,
    onScreenText: topic,
    visual: "Wide opening shot; the same smiling cartoon girl waves beside a large colorful blank shape reserved for an editor-added title",
  };
  const middleSlots = sceneCount - 3;
  const middle: SceneDraft[] = [];
  const shownExamples: string[] = [];
  if (sceneCount === 4 && examples.length > 1) {
    const visible = examples.slice(0, 3);
    shownExamples.push(...visible);
    middle.push({
      title: arabic ? "أمثلة من حولنا" : "Examples around us",
      narration: arabic
        ? `شاهد معنا ${joinArabic(visible)}. هل تستطيع أن تقول أسماءها؟`
        : `Look at ${visible.join(", ")}. Can you say their names?`,
      onScreenText: arabic ? joinArabic(visible) : visible.join(" • "),
      visual: `Three clear, separate illustrations of ${visible.map(visualFor).join(", ")}; the cartoon girl points to each object; balanced picture-card composition`,
    });
  } else {
    if (examples.length < middleSlots) middle.push(makeConcept(topic, arabic, letter));
    for (const example of examples.slice(0, middleSlots - middle.length)) {
      shownExamples.push(example);
      middle.push(makeExample(example, middle.length, arabic, topic, letter));
    }
    while (middle.length < middleSlots) {
      middle.push(makeObservation(topic, shownExamples, arabic, middle.length));
    }
  }
  const practice: SceneDraft = {
    title: arabic ? "سؤال لك" : "Your turn",
    narration: arabic
      ? letter && shownExamples.some((example) => example.startsWith(letter))
        ? `هل تتذكر الكلمات التي تبدأ بحرف ${letterName}؟ قلها بصوت عالٍ، وسننتظر إجابتك.`
        : `حان دورك! ماذا تتذكر عن ${topic}؟ فكر قليلاً ثم أخبرنا.`
      : `Your turn! What do you remember about ${topic}? Take a moment to answer.`,
    onScreenText: arabic ? "دورك الآن!" : "Your turn!",
    visual: `The cartoon girl invites an answer with an open hand; ${shownExamples.length ? `small separate pictures of ${shownExamples.map(visualFor).join(", ")}` : `a simple visual of ${topic}`} around her; leave clear empty space for a countdown overlay`,
  };
  const recap: SceneDraft = {
    title: arabic ? "مراجعة وختام" : "Recap and goodbye",
    narration: arabic
      ? shownExamples.length
        ? `تعلمنا ${topic} مع ${joinArabic(shownExamples)}. أحسنتم! إلى اللقاء.`
        : `تعلمنا اليوم عن ${topic}. أحسنتم! إلى اللقاء.`
      : shownExamples.length
        ? `We learned about ${topic} with ${shownExamples.join(", ")}. Great job! See you next time.`
        : `We learned about ${topic} today. Great job! See you next time.`,
    onScreenText: arabic ? "أحسنتم!" : "Great job!",
    visual: `Warm closing shot; the cartoon girl waves goodbye beside small familiar picture cards of ${shownExamples.length ? shownExamples.map(visualFor).join(", ") : topic}`,
  };

  const scenes: EpisodeScene[] = [intro, ...middle, practice, recap].map((scene, index) => ({
    id: `scene-${index + 1}`,
    title: scene.title,
    durationSec: baseDuration + (index < leftover ? 1 : 0),
    narration: scene.narration,
    onScreenText: scene.onScreenText,
    imagePrompt: [
      `Consistent visual style and character: ${visualBible}`,
      `Scene composition: ${scene.visual}. Lesson focus: ${topic}.`,
      "No text, letters, captions, watermarks, or logos in the image. Leave clear space for an editor-added title and subtitles.",
    ].join("\n"),
    motion: motionCycle[index % motionCycle.length],
    transition: index === 0 ? "cut" : index % 3 === 0 ? "slide" : "fade",
  }));
  const title = shownExamples.length
    ? arabic ? `${topic}: ${joinArabic(shownExamples.slice(0, 3))}` : `${topic}: ${shownExamples.slice(0, 3).join(", ")}`
    : arabic ? `هيا نتعلم ${topic}` : `Let's Learn About ${topic}`;
  const summary = arabic
    ? `حلقة تعليمية مصورة عن ${topic}${shownExamples.length ? ` مع ${joinArabic(shownExamples)}` : ""}.`
    : `An illustrated learning episode about ${topic}${shownExamples.length ? ` with ${shownExamples.join(", ")}` : ""}.`;
  return {
    title,
    description: summary,
    visualBible,
    youtubeTitle: title.slice(0, 100),
    youtubeDescription: arabic
      ? `${summary}\n\nمحتوى تعليمي للأطفال بعمر ${request.ageGroup}.`
      : `${summary}\n\nEducational content for ages ${request.ageGroup}.`,
    youtubeTags: arabic
      ? ["تعليم الأطفال", topic, ...shownExamples].slice(0, 8)
      : ["kids learning", topic, ...shownExamples].slice(0, 8),
    format: request.format,
    ageGroup: request.ageGroup,
    language: request.language,
    artStyle: request.artStyle,
    scenes,
  };
}

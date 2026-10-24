/**
 * מרשם ההדרכות — מה מוצג בכניסה לכל טאב.
 *
 * הרעיון: כל טאב במערכת מקבל מסך פתיחה שמראה מה אפשר לעשות בו. מי
 * שנכנס בפעם הראשונה רואה את כל האפשרויות מסודרות, ולא צריך לנחש.
 *
 * שלוש החלטות שלא מובנות מאליהן:
 *
 *  1. **ההדרכה מוצגת פעם אחת בלבד לכל טאב.** לא בכל כניסה. מסך שחוזר
 *     על עצמו הופך מהר למטרד, והמשתמש לומד ללחוץ "סגור" בלי לקרוא —
 *     כלומר הוא מפסיק לעבוד בדיוק כשהוא הכי נחוץ.
 *
 *  2. **"דלג" ו"אל תציג שוב" אינם אותו דבר.** דילוג סוגר להפעם ומשאיר
 *     את ההדרכה לפעם הבאה; "אל תציג שוב" מבטל אותה לתמיד לטאב הזה.
 *     בלי ההפרדה, מי שסוגר במהירות מאבד את ההדרכה בלי כוונה.
 *
 *  3. **תמיד אפשר להחזיר.** לכל טאב יש כפתור קטן שפותח את ההדרכה
 *     מחדש. בלעדיו "אל תציג שוב" הוא מלכוד — והמשתמש יחשוש ללחוץ.
 */

import type { LucideIcon } from 'lucide-react';
import {
  AudioLines, Blocks, BrainCircuit, Check, Cpu, Download, Edit3, FileAudio,
  FileText, FolderOpen, Gauge, GraduationCap, Languages, LayoutGrid, Mic,
  Music, Scissors, ScrollText, Server, Settings2, ShieldCheck, Sparkles,
  SplitSquareHorizontal, Target, Timer, TrendingUp, Upload, UserPlus, Users,
  Video, Volume2, Wand2, Youtube, Zap,
} from 'lucide-react';

/** אפשרות אחת בטאב. */
export interface GuideItem {
  icon: LucideIcon;
  title: string;
  body: string;
  /** הערה קצרה — מתי זה שימושי, או מה שלא מובן מאליו. */
  tip?: string;
}

export interface TabGuide {
  /** מזהה ייחודי. משמש גם כמפתח הזיכרון, ולכן אסור לשנות אותו. */
  id: string;
  title: string;
  subtitle: string;
  items: GuideItem[];
  /** משפט סיום — מה כדאי לעשות קודם. */
  startHere?: string;
}

// ===================================================================
//  אולפן הקול
// ===================================================================

const VOICE_STUDIO: TabGuide[] = [
  {
    id: 'voice-studio/enhance',
    title: 'שיפור וטעינה',
    subtitle: 'מנקים את ההקלטה לפני התמלול. הקלטה נקייה מתומללת טוב יותר.',
    items: [
      {
        icon: Upload,
        title: 'טעינת קובץ',
        body: 'גוררים לכאן קובץ שמע או וידאו, או בוחרים מהמחשב.',
        tip: 'גם וידאו — השמע מחולץ ממנו לבד.',
      },
      {
        icon: Wand2,
        title: 'שיפור אוטומטי',
        body: 'הסרת רעש רקע, איזון עוצמה והדגשת הדיבור.',
        tip: 'הכי שימושי בהקלטות מחדר עם הד או ממיקרופון רחוק.',
      },
      {
        icon: Scissors,
        title: 'חיתוך',
        body: 'חותכים קטע מתוך ההקלטה במקום לעבוד על הכל.',
      },
      {
        icon: Check,
        title: 'השוואה לפני ואחרי',
        body: 'מאזינים לשני הגרסאות אחת אחרי השנייה.',
        tip: 'כדאי תמיד — שיפור אגרסיבי מדי מוחק גם דיבור.',
      },
    ],
    startHere: 'מתחילים בגרירת קובץ, ומאזינים להשוואה לפני שממשיכים.',
  },
  {
    id: 'voice-studio/compare',
    title: 'השוואת מנועים',
    subtitle: 'מריצים כמה מנועי תמלול על אותה הקלטה ורואים מי מדויק יותר.',
    items: [
      {
        icon: SplitSquareHorizontal,
        title: 'הרצה מקבילה',
        body: 'אותה הקלטה עוברת בכמה מנועים, והתוצאות מוצגות זו לצד זו.',
      },
      {
        icon: Target,
        title: 'מספרים ולא תחושה',
        body: 'כמה מילים כל מנוע קלע, ולא רק "נראה טוב יותר".',
        tip: 'הבדל קטן במדגם קטן הוא רעש. צריך מספיק מילים כדי להסיק.',
      },
      {
        icon: Gauge,
        title: 'זמן מול דיוק',
        body: 'מנוע מדויק יותר לרוב איטי יותר. כאן רואים את שתי המספרים.',
      },
    ],
    startHere: 'בוחרים שני מנועים, מריצים, ומסתכלים על ספירת המילים.',
  },
  {
    id: 'voice-studio/batch',
    title: 'קבצים ותיקיות',
    subtitle: 'עיבוד של הרבה קבצים בבת אחת, בלי לשבת ליד המחשב.',
    items: [
      {
        icon: FolderOpen,
        title: 'תיקייה שלמה',
        body: 'בוחרים תיקייה, וכל הקבצים שבה נכנסים לתור.',
      },
      {
        icon: Timer,
        title: 'תור עבודה',
        body: 'הקבצים מעובדים אחד אחרי השני, והתקדמות מוצגת לכל אחד.',
        tip: 'אפשר לסגור את הטאב — העבודה ממשיכה.',
      },
      {
        icon: Download,
        title: 'הורדה מרוכזת',
        body: 'כשהכל מוכן, מורידים את כל התוצאות יחד.',
      },
    ],
  },
  {
    id: 'voice-studio/read',
    title: 'הקראה והקלטה',
    subtitle: 'הופכים טקסט לקול, בהגייה אשכנזית או ישראלית — ומקליטים קול.',
    items: [
      {
        icon: Volume2,
        title: 'הקראה בהגייה אשכנזית',
        body: 'כותבים טקסט, והמערכת מקריאה אותו בהגייה ליטאית, פולנית או ישראלית.',
        tip: 'בליטאית צירה וחולם נשמעים אותו דבר: "תורה" היא teyre ולא toyre.',
      },
      {
        icon: Blocks,
        title: 'שלוש רמות לשון',
        body: 'קריאה בתורה, תפילה, או שיעור תלמוד. בכל אחת ההטעמה שונה.',
        tip: 'בשיעור ההטעמה מלעילית והתנועות אחרי ההטעמה נחלשות.',
      },
      {
        icon: Sparkles,
        title: 'ניקוד אוטומטי',
        body: 'לא צריך להדביק טקסט מנוקד. המערכת מנקדת לבד.',
        tip: 'הניקוד מוצג לבדיקה — הוא נכון ברוב המקרים אבל לא בכולם.',
      },
      {
        icon: Edit3,
        title: 'עריכת הצלילים',
        body: 'רואים בדיוק אילו צלילים יושמעו, ואפשר לתקן מילה אחת ביד.',
        tip: 'זאת הדרך לתקן הגייה של מילה בלי לשנות כלל שמשפיע על הכל.',
      },
      {
        icon: UserPlus,
        title: 'שכפול קול',
        body: 'מקליטים או מעלים קובץ, והמערכת מחלצת את זהות הקול ומקריאה בו.',
        tip: 'נשמרת זהות הקול בלבד, לא ההגייה. ההגייה נקבעת בבורר למעלה.',
      },
      {
        icon: Mic,
        title: 'הקלטה של עצמך',
        body: 'מקריאים טקסט שכתוב מולכם, ומקבלים שמע עם תמלול נכון במאה אחוז.',
        tip: 'זה חומר האימון: כשאתם קוראים טקסט ידוע, אין מה לנחש.',
      },
    ],
    startHere: 'כותבים טקסט בלי ניקוד ולוחצים "הקרא במנוע המקומי".',
  },
  {
    id: 'voice-studio/flows',
    title: 'זרימות עבודה',
    subtitle: 'קיצורי דרך לכלים המתקדמים שכבר קיימים במערכת.',
    items: [
      {
        icon: LayoutGrid,
        title: 'מעבר מהיר',
        body: 'כל כפתור מוביל לכלי אחר: המרה, חיתוך, בדיקת איכות, עריכה.',
      },
    ],
  },
];

// ===================================================================
//  תמלול
// ===================================================================

const TRANSCRIBE: TabGuide[] = [
  {
    id: 'index/transcribe',
    title: 'תמלול',
    subtitle: 'מעלים הקלטה או מקליטים, ומקבלים תמלול.',
    items: [
      {
        icon: FileAudio,
        title: 'טעינת הקלטה',
        body: 'גוררים קובץ שמע או וידאו, או בוחרים מהמחשב.',
        tip: 'גם וידאו — השמע מחולץ ממנו לבד.',
      },
      {
        icon: Mic,
        title: 'הקלטה ישירה',
        body: 'מקליטים מהמיקרופון ומתמללים מיד, בלי קובץ.',
      },
      {
        icon: Cpu,
        title: 'בחירת מנוע',
        body: 'מנוע מקומי שרץ על המחשב, או מנוע בענן.',
        tip: 'המקומי אינו שולח את ההקלטה לשום מקום.',
      },
      {
        icon: FileText,
        title: 'מילים מועדפות',
        body: 'רשימת מונחים שחוזרים בהקלטה, כדי שהמנוע יזהה אותם.',
        tip: 'הכי שימושי לשמות, מונחים תורניים וראשי תיבות.',
      },
    ],
    startHere: 'גוררים קובץ, בוחרים מנוע, ולוחצים תמלל.',
  },
  {
    id: 'index/edit',
    title: 'עריכה',
    subtitle: 'מעבר לעורך, לתיקון התמלול תוך כדי האזנה.',
    items: [
      {
        icon: Edit3,
        title: 'עורך מסונכרן',
        body: 'המילה שמושמעת מודגשת, ולחיצה על מילה קופצת לשם בהקלטה.',
      },
    ],
  },
];

// ===================================================================
//  עורך הטקסט
// ===================================================================

const TEXT_EDITOR: TabGuide[] = [
  {
    id: 'text-editor/player',
    title: 'עורך הטקסט',
    subtitle: 'מתקנים את התמלול תוך כדי האזנה להקלטה.',
    items: [
      {
        icon: AudioLines,
        title: 'סנכרון לשמע',
        body: 'המילה שמושמעת מודגשת. לחיצה על מילה קופצת לשם בהקלטה.',
      },
      {
        icon: Upload,
        title: 'ייבוא כתוביות',
        body: 'גוררים קובץ כתוביות וההקלטה מסתנכרנת אליו.',
        tip: 'הסנכרון מדויק ברמת המשפט ומשוער ברמת המילה הבודדת.',
      },
      {
        icon: Video,
        title: 'וידאו',
        body: 'אם המקור וידאו, הוא מוצג והתמלול רץ איתו.',
      },
      {
        icon: Edit3,
        title: 'תיקון שנלמד',
        body: 'תיקון שחוזר על עצמו נשמר, והמערכת מיישמת אותו בפעם הבאה.',
      },
    ],
    startHere: 'מפעילים את ההקלטה ומתקנים תוך כדי.',
  },
  {
    id: 'text-editor/loshon',
    title: 'לשון הקודש',
    subtitle: 'כללים ומילונים לטיפול במונחים תורניים.',
    items: [
      {
        icon: ScrollText,
        title: 'כללי כתיב',
        body: 'כללים שמתקנים כתיב של מונחים תורניים אוטומטית.',
      },
      {
        icon: FileText,
        title: 'מילון מונחים',
        body: 'רשימת מונחים שהמערכת מכירה ומתקנת.',
      },
    ],
  },
  {
    id: 'text-editor/speakers',
    title: 'זיהוי דוברים',
    subtitle: 'מחלקים את התמלול לפי מי מדבר.',
    items: [
      {
        icon: Users,
        title: 'הפרדה אוטומטית',
        body: 'המערכת מזהה מתי הדובר מתחלף ומסמנת זאת.',
        tip: 'אפשר לומר מראש כמה דוברים יש — זה משפר את ההפרדה.',
      },
      {
        icon: Edit3,
        title: 'שמות לדוברים',
        body: 'נותנים שם לכל דובר במקום "דובר 1".',
      },
    ],
  },
  {
    id: 'text-editor/vocab',
    title: 'בדיקת איות',
    subtitle: 'מסמנים מילים חשודות בתמלול.',
    items: [
      {
        icon: Target,
        title: 'סימון מילים חשודות',
        body: 'מילים שהמערכת אינה מכירה מסומנות לבדיקה.',
      },
      {
        icon: Check,
        title: 'אישור מילה',
        body: 'מילה שאושרה לא תסומן שוב.',
        tip: 'שימושי למונחים תורניים שאינם במילון הרגיל.',
      },
    ],
  },
  {
    id: 'text-editor/summary',
    title: 'סיכום',
    subtitle: 'מקבלים סיכום של התמלול.',
    items: [
      {
        icon: FileText,
        title: 'סיכום אוטומטי',
        body: 'המערכת מייצרת סיכום של מה שנאמר.',
      },
    ],
  },
  {
    id: 'text-editor/compare',
    title: 'השוואה',
    subtitle: 'משווים בין גרסאות של התמלול, או בין מנועים.',
    items: [
      {
        icon: SplitSquareHorizontal,
        title: 'השוואת גרסאות',
        body: 'רואים מה השתנה בין גרסה לגרסה של אותו תמלול.',
      },
      {
        icon: Zap,
        title: 'השוואת מנועים',
        body: 'אותה הקלטה בכמה מנועים, זה לצד זה.',
      },
    ],
  },
  {
    id: 'text-editor/history',
    title: 'היסטוריה',
    subtitle: 'כל הגרסאות שנשמרו, ואפשרות לחזור אחורה.',
    items: [
      {
        icon: TrendingUp,
        title: 'גרסאות שמורות',
        body: 'כל שמירה נרשמת, ואפשר לחזור לכל נקודה.',
        tip: 'שימושי כשעריכה יצאה לא טוב ורוצים לחזור.',
      },
    ],
  },
  {
    id: 'text-editor/ai',
    title: 'עריכה עם בינה מלאכותית',
    subtitle: 'נותנים הוראה בעברית, והמערכת עורכת את התמלול.',
    items: [
      {
        icon: Sparkles,
        title: 'הוראה חופשית',
        body: 'כותבים מה לתקן, והמערכת מבצעת על כל התמלול.',
        tip: 'כדאי לבדוק את התוצאה — עריכה רחבה יכולה לשנות יותר מהכוונה.',
      },
      {
        icon: Blocks,
        title: 'תבניות מוכנות',
        body: 'הוראות שמורות לעריכות שחוזרות.',
      },
    ],
  },
];

// ===================================================================
//  למידה אישית
// ===================================================================

const LEARNING: TabGuide[] = [
  {
    id: 'personal-learning/vocabulary',
    title: 'אוצר מילים',
    subtitle: 'מונחים שהמערכת לומדת ומזהה בהקלטות שלך.',
    items: [
      {
        icon: FileText,
        title: 'הוספת מונח',
        body: 'מוסיפים מילה או ביטוי שחוזר בהקלטות שלך.',
        tip: 'הכי שימושי לשמות, מונחים תורניים וראשי תיבות.',
      },
      {
        icon: Target,
        title: 'השפעה על התמלול',
        body: 'מונחים ברשימה נשלחים למנוע כדי שיזהה אותם.',
        tip: 'רשימה ארוכה מדי מחלישה את ההשפעה. עדיף מונחים שבאמת חוזרים.',
      },
    ],
  },
  {
    id: 'personal-learning/corrections',
    title: 'תיקונים נלמדים',
    subtitle: 'תיקונים שעשית, והמערכת זוכרת ומיישמת שוב.',
    items: [
      {
        icon: BrainCircuit,
        title: 'למידה מתיקון',
        body: 'כל תיקון בעורך נרשם, ותיקון שחוזר הופך לכלל.',
      },
      {
        icon: Gauge,
        title: 'רמת ביטחון',
        body: 'ככל שתיקון חזר יותר, המערכת בטוחה בו יותר.',
      },
      {
        icon: Settings2,
        title: 'מתג ראשי',
        body: 'אפשר לכבות את כל התיקונים הנלמדים ולקבל פלט גולמי.',
        tip: 'שימושי כשרוצים לראות מה המנוע באמת מוציא.',
      },
    ],
  },
  {
    id: 'personal-learning/definitive',
    title: 'תיקונים חד-משמעיים',
    subtitle: 'תיקונים שאתה מאשר במפורש, ותמיד מיושמים.',
    items: [
      {
        icon: ShieldCheck,
        title: 'אישור מפורש',
        body: 'תיקון שאושר מקבל ביטחון מלא ולא נמחק בניקוי.',
        tip: 'ההבדל מהתיקונים הנלמדים: כאן אתה החלטת, לא המערכת.',
      },
    ],
  },
  {
    id: 'personal-learning/profiles',
    title: 'פרופילי הגייה',
    subtitle: 'הגדרות נפרדות לכל דובר או סוג הקלטה.',
    items: [
      {
        icon: Users,
        title: 'פרופיל לכל דובר',
        body: 'לכל דובר הגדרות ומונחים משלו.',
        tip: 'שימושי כשמתמללים כמה רבנים עם הגייה שונה.',
      },
    ],
  },
  {
    id: 'personal-learning/loshon-kodesh',
    title: 'לשון הקודש',
    subtitle: 'כללים ומונחים לטיפול בהגייה אשכנזית ובמונחים תורניים.',
    items: [
      {
        icon: ScrollText,
        title: 'כללי הגייה',
        body: 'כללים שמתרגמים הגייה אשכנזית לכתיב תקני.',
        tip: 'למשל "שאבעס" שהופך ל"שבת".',
      },
      {
        icon: FileText,
        title: 'מילון מונחים',
        body: 'מונחים תורניים שהמערכת מכירה.',
      },
    ],
  },
];

// ===================================================================
//  לשון הקודש
// ===================================================================

const LOSHON: TabGuide[] = [
  {
    id: 'lashon-kodesh/transcribe',
    title: 'תמלול לשון הקודש',
    subtitle: 'תמלול מותאם להגייה אשכנזית ולמונחים תורניים.',
    items: [
      {
        icon: Mic,
        title: 'תמלול מותאם',
        body: 'המנוע מקבל את מילון המונחים ואת הכללים לפני התמלול.',
      },
      {
        icon: ScrollText,
        title: 'תיקון הגייה',
        body: 'מילים בהגייה אשכנזית מתורגמות לכתיב תקני.',
      },
    ],
  },
  {
    id: 'lashon-kodesh/settings',
    title: 'כללים ומילונים',
    subtitle: 'מנהלים את הכללים והמונחים שמופעלים על התמלול.',
    items: [
      {
        icon: Settings2,
        title: 'עריכת כללים',
        body: 'מוסיפים, משנים או מכבים כלל.',
      },
      {
        icon: FileText,
        title: 'מילון',
        body: 'רשימת המונחים התורניים שהמערכת מכירה.',
      },
    ],
  },
  {
    id: 'lashon-kodesh/training',
    title: 'אימון',
    subtitle: 'אוספים חומר ומאמנים את המערכת על ההגייה שלך.',
    items: [
      {
        icon: GraduationCap,
        title: 'זוגות אימון',
        body: 'כל פריט הוא הקלטה והתמלול הנאמן שלה.',
        tip: 'הדרך הנקייה: להקריא טקסט כתוב — אז התמלול נכון בוודאות.',
      },
    ],
  },
  {
    id: 'lashon-kodesh/benchmark',
    title: 'בדיקת איכות',
    subtitle: 'מודדים כמה המערכת מדויקת, במספרים ולא בתחושה.',
    items: [
      {
        icon: Target,
        title: 'ספירת מילים',
        body: 'כמה מילים נכונות מתוך כמה. לא אחוז מעורפל.',
        tip: 'מילה שהוחלפה ומילה שנשמטה הן שתי תקלות שונות.',
      },
      {
        icon: TrendingUp,
        title: 'היסטוריה',
        body: 'ההשוואה היא מול התוצאה הטובה ביותר אי פעם, ולא מול הקודמת.',
        tip: 'זה מונע את המלכודת של "התקדמנו" כשבעצם חזרנו אחורה.',
      },
    ],
  },
];

// ===================================================================
//  כלים נוספים
// ===================================================================

const TOOLS: TabGuide[] = [
  {
    id: 'youtube/new',
    title: 'משימה חדשה',
    subtitle: 'מורידים שמע מסרטון ומתמללים אותו.',
    items: [
      {
        icon: Youtube,
        title: 'הדבקת קישור',
        body: 'מדביקים קישור לסרטון, והשמע יורד לבד.',
      },
      {
        icon: FileText,
        title: 'כתוביות קיימות',
        body: 'אם לסרטון כבר יש כתוביות, אפשר לקחת אותן במקום לתמלל.',
        tip: 'מהיר בהרבה, אבל הכתוביות האוטומטיות פחות מדויקות.',
      },
    ],
  },
  {
    id: 'youtube/manager',
    title: 'ניהול משימות',
    subtitle: 'רואים את המשימות שרצות ואת אלה שהסתיימו.',
    items: [
      {
        icon: Timer,
        title: 'מעקב',
        body: 'התקדמות של כל משימה, ואפשרות לבטל.',
        tip: 'אפשר לסגור את הטאב — העבודה ממשיכה.',
      },
      {
        icon: Download,
        title: 'הורדת תוצאות',
        body: 'מורידים את השמע או את התמלול של משימה שהסתיימה.',
      },
    ],
  },
  {
    id: 'video-to-mp3/convert',
    title: 'המרה לשמע',
    subtitle: 'מחלצים את השמע מקובץ וידאו.',
    items: [
      {
        icon: Video,
        title: 'טעינת וידאו',
        body: 'גוררים קובץ וידאו, והשמע מופרד ממנו.',
      },
      {
        icon: Music,
        title: 'איכות',
        body: 'בוחרים את איכות השמע. גבוהה יותר — קובץ גדול יותר.',
        tip: 'לתמלול אין צורך באיכות הגבוהה ביותר.',
      },
    ],
  },
  {
    id: 'video-to-mp3/extract',
    title: 'חילוץ קטע',
    subtitle: 'לוקחים חלק מתוך הקובץ במקום את הכל.',
    items: [
      {
        icon: Scissors,
        title: 'בחירת טווח',
        body: 'מסמנים מאיפה עד איפה, ומחלצים רק את הקטע.',
        tip: 'חוסך זמן תמלול בהקלטה ארוכה.',
      },
    ],
  },
  {
    id: 'video-to-mp3/cut',
    title: 'חיתוך',
    subtitle: 'חותכים את הקובץ לכמה חלקים.',
    items: [
      {
        icon: Scissors,
        title: 'חלוקה',
        body: 'מחלקים הקלטה ארוכה לקטעים קצרים יותר.',
      },
      {
        icon: Download,
        title: 'הורדה מרוכזת',
        body: 'מורידים את כל הקטעים יחד.',
      },
    ],
  },
  {
    id: 'translation/library',
    title: 'מהתיקיות',
    subtitle: 'בוחרים תמלול שכבר קיים במערכת ומתרגמים אותו.',
    items: [
      {
        icon: FolderOpen,
        title: 'בחירה מהספרייה',
        body: 'כל התמלולים השמורים מוצגים לבחירה.',
      },
      {
        icon: Languages,
        title: 'שפת היעד',
        body: 'בוחרים לאיזו שפה לתרגם.',
      },
    ],
  },
  {
    id: 'translation/file',
    title: 'מהמחשב',
    subtitle: 'מעלים קובץ טקסט או כתוביות ומתרגמים.',
    items: [
      {
        icon: Upload,
        title: 'טעינת קובץ',
        body: 'גוררים קובץ טקסט או כתוביות.',
      },
      {
        icon: Timer,
        title: 'שמירת התזמונים',
        body: 'בקובץ כתוביות התזמונים נשמרים, כך שהסנכרון לשמע לא נשבר.',
      },
    ],
  },
  {
    id: 'translation/paste',
    title: 'הדבקת טקסט',
    subtitle: 'מדביקים טקסט ישירות ומתרגמים.',
    items: [
      {
        icon: FileText,
        title: 'הדבקה',
        body: 'מדביקים טקסט בתיבה ובוחרים שפה.',
        tip: 'מהיר כשרוצים לתרגם קטע קצר בלי קובץ.',
      },
    ],
  },
  {
    id: 'setup/scan',
    title: 'סריקת המחשב',
    subtitle: 'בודקים מה מותקן ומה חסר.',
    items: [
      {
        icon: Server,
        title: 'מה קיים',
        body: 'המערכת סורקת ומדווחת אילו רכיבים כבר מותקנים.',
      },
      {
        icon: Zap,
        title: 'כרטיס המסך',
        body: 'בודקים אם כרטיס המסך זמין. איתו התמלול מהיר פי כמה.',
      },
    ],
    startHere: 'מתחילים בסריקה, ורק אחר כך מתקינים מה שחסר.',
  },
  {
    id: 'setup/install',
    title: 'התקנה',
    subtitle: 'מתקינים את הרכיבים שחסרים.',
    items: [
      {
        icon: Download,
        title: 'התקנה אוטומטית',
        body: 'המערכת מורידה ומתקינה את מה שהסריקה מצאה כחסר.',
        tip: 'דורש חיבור לרשת, ולוקח זמן בפעם הראשונה.',
      },
    ],
  },
  {
    id: 'setup/model',
    title: 'מנועים',
    subtitle: 'בוחרים אילו מנועי תמלול להוריד למחשב.',
    items: [
      {
        icon: Cpu,
        title: 'בחירת מנוע',
        body: 'כל מנוע עם הגודל שלו ורמת הדיוק שנמדדה.',
        tip: 'כל מנוע תופס מקום. כדאי להוריד רק מה שבאמת בשימוש.',
      },
      {
        icon: Gauge,
        title: 'מהיר מול מדויק',
        body: 'מנוע גדול מדויק יותר ואיטי יותר.',
      },
    ],
  },
  {
    id: 'setup/verify',
    title: 'אימות',
    subtitle: 'בודקים שהכל באמת עובד.',
    items: [
      {
        icon: Check,
        title: 'בדיקה מקצה לקצה',
        body: 'המערכת מתמללת הקלטה קצרה ומוודאת שהתוצאה תקינה.',
        tip: 'כדאי להריץ אחרי כל התקנה — זה מגלה בעיות מוקדם.',
      },
    ],
  },
];

const ALL: TabGuide[] = [
  ...VOICE_STUDIO, ...TRANSCRIBE, ...TEXT_EDITOR,
  ...LEARNING, ...LOSHON, ...TOOLS,
];

const BY_ID = new Map(ALL.map((g) => [g.id, g]));

export function getTabGuide(id: string): TabGuide | undefined {
  return BY_ID.get(id);
}

export function allTabGuides(): TabGuide[] {
  return ALL;
}

// ===================================================================
//  זיכרון — מה כבר נראה ומה כובה
// ===================================================================

const SEEN_PREFIX = 'tabGuide.seen.';
const DISABLED_ALL = 'tabGuide.disabledAll';

/**
 * קריאה וכתיבה לזיכרון הדפדפן, עטופות בהגנה.
 *
 * בחלון פרטי ובדפדפן שחוסם אחסון הפעולות האלה זורקות שגיאה. הדרכה
 * היא נוחות, ואסור שהיא תפיל את המסך. כשהזיכרון אינו זמין ההדרכה
 * פשוט תוצג בכל כניסה — מטריד, אבל לא שבור.
 */
function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    if (value) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {
    // אין אחסון. ההדרכה תוצג שוב, וזה מקובל.
  }
}

export function isGuideDisabledEverywhere(): boolean {
  return readFlag(DISABLED_ALL);
}

export function setGuidesDisabledEverywhere(disabled: boolean): void {
  writeFlag(DISABLED_ALL, disabled);
}

export function wasGuideSeen(id: string): boolean {
  return readFlag(SEEN_PREFIX + id);
}

export function markGuideSeen(id: string): void {
  writeFlag(SEEN_PREFIX + id, true);
}

/** האם להציג את ההדרכה עכשיו. */
export function shouldShowGuide(id: string): boolean {
  if (!getTabGuide(id)) return false;
  if (isGuideDisabledEverywhere()) return false;
  return !wasGuideSeen(id);
}

/** מאפס הכל — כל ההדרכות יוצגו שוב. */
export function resetAllGuides(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(SEEN_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
    window.localStorage.removeItem(DISABLED_ALL);
  } catch {
    // אין אחסון, ואין מה לאפס.
  }
}

/** כמה הדרכות כבר נראו — להצגה במסך ההגדרות. */
export function countSeenGuides(): number {
  return ALL.filter((g) => wasGuideSeen(g.id)).length;
}

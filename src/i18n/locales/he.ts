import type { I18nKey } from "./en";

/** Hebrew UI strings. Must define every key in en.ts — a missing key is a compile error. */
export const he: Record<I18nKey, string> = {
	"plugin.name": "Overpowered Canvas",

	"settings.language.name": "שפת הממשק",
	"settings.language.desc": "השפה של התפריטים, הפקודות וההגדרות של התוסף.",
	"settings.language.auto": "כמו ב־Obsidian",
	"settings.language.en": "אנגלית (English)",
	"settings.language.he": "עברית",
	"settings.language.reload": "כדי שגם שמות הפקודות יתעדכנו לשפה החדשה, צריך לטעון מחדש את התוסף (או את Obsidian).",
	"settings.module.reset": "איפוס לברירת המחדל",
	"settings.module.reset.done": "{module}: ההגדרות אופסו לברירת המחדל.",
	"settings.module.desktopOnly": "לא זמין במובייל.",
	"settings.module.failed": "ההפעלה נכשלה. הפרטים בקונסולת המפתחים.",
	"settings.module.requires": "דורש: {modules}.",
	"settings.coexistence.name": "הודעת חפיפה",
	"settings.coexistence.desc": "להציג שוב, בהפעלה הבאה, את ההודעה על תוספים חופפים (Advanced Canvas, ‏Canvas Mindmap).",
	"settings.coexistence.button": "להציג שוב",
	"settings.coexistence.reset.done": "ההודעה על חפיפה תוצג בהפעלה הבאה.",

	"group.core": "ליבה",
	"group.nodes": "צמתים",
	"group.edges": "קשתות",
	"group.vault": "שילוב בכספת",
	"group.interaction": "אינטראקציה",
	"group.mindmap": "מפת חשיבה",
	"group.drawing": "ציור וצורות",
	"group.navigation": "ניווט",
	"group.data": "נתונים",
	"group.developer": "מפתחים",

	"module.enable.failed": "Overpowered Canvas: הפעלת המודול „{module}” נכשלה, והוא כובה.",
	"module.enable.missingDependency": "Overpowered Canvas: צריך להפעיל קודם את „{dependency}”, כי „{module}” תלוי בו.",
	"module.disable.cascade": "Overpowered Canvas: כובו גם {modules}, שתלויים ב־„{module}”.",

	"coexistence.title": "נמצאו תוספי קנבס חופפים",
	"coexistence.intro": "התוספים האלה פעילים ועושים חלק מהדברים ש־Overpowered Canvas עושה. הפעלה של שניהם יחד עלולה לגרום להתנגשויות.",
	"coexistence.row": "{plugin} חופף ל: {modules}",
	"coexistence.disableOurs": "לכבות את המודולים החופפים שלנו",
	"coexistence.keepBoth": "להשאיר את שניהם",
	"coexistence.disabled": "Overpowered Canvas: כובו {count} מודולים חופפים.",

	"data.newerSchema": "Overpowered Canvas: הקובץ „{file}” נשמר בגרסה חדשה יותר של התוסף (גרסת נתונים {found}, והגרסה הזו תומכת ב־{supported}). הנתונים הנוספים שלו יהיו לקריאה בלבד עד שתעדכן את התוסף.",

	"diagnostics.name": "אבחון",
	"diagnostics.desc": "כלי מפתחים: העתקת דוח על המבנה הפנימי של הקנבס, רשימת הפאצ'ים הפעילים ומדידת ביצועים של הזזה וזום.",
	"diagnostics.frames.name": "אורך המדידה (פריימים)",
	"diagnostics.frames.desc": "כמה פריימים של אנימציה נמשכת מדידת ההזזה והזום.",
	"diagnostics.cmd.report": "העתקת דוח על המבנה הפנימי של הקנבס",
	"diagnostics.cmd.benchmark": "מדידת ביצועים של הזזה וזום",
	"diagnostics.cmd.listPatches": "העתקת רשימת הפאצ'ים הפעילים",
	"diagnostics.noCanvas": "קודם צריך לפתוח קנבס.",
	"diagnostics.report.copied": "הדוח על המבנה הפנימי של הקנבס הועתק ללוח.",
	"diagnostics.patches.copied": "{count} פאצ'ים פעילים. הרשימה הועתקה ללוח.",
	"diagnostics.benchmark.running": "המדידה רצה. לא לגעת בקנבס…",
	"diagnostics.benchmark.done": "תוצאות: ממוצע של {fps} fps, פריים p95 של {p95} ms, {slow} פריימים איטיים. התוצאות הועתקו ללוח.",
};

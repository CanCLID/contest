// Original everyday Cantonese sentences; readings are chosen for this context.
function question(id, text, reading) {
  const characters = [...text].filter(character => /\p{Script=Han}/u.test(character));
  const syllables = reading.split(" ");
  if (characters.length !== syllables.length) {
    throw new Error(`Question ${id} has mismatched characters and syllables.`);
  }
  return {
    id,
    text,
    tokens: characters.map((hanzi, index) => ({ hanzi, answers: [syllables[index]] })),
  };
}

export const QUESTIONS = [
  question(
    "morning-walk",
    "今日天氣好好，我哋食完早餐，一齊去公園散步。",
    "gam jat tin hei hou hou ngo dei sik jyun zou caan jat cai heoi gung jyun saan bou",
  ),
  question(
    "reading-at-home",
    "我鍾意喺屋企睇書，有時會聽音樂，放鬆一下。",
    "ngo zung ji hai uk kei tai syu jau si wui teng jam ngok fong sung jat haa",
  ),
  question(
    "sunday-market",
    "星期日朝早，阿媽去街市買菜，返屋企煮午餐。",
    "sing kei jat ziu zou aa maa heoi gaai si maai coi faan uk kei zyu ng caan",
  ),
  question(
    "evening-chat",
    "夜晚食完飯，大家坐低傾偈，分享今日嘅趣事。",
    "je maan sik jyun faan daai gaa co dai king gai fan hoeng gam jat ge ceoi si",
  ),
  question(
    "seaside-trip",
    "我哋約好星期六，一齊搭車去海邊，影相同睇日落。",
    "ngo dei joek hou sing kei luk jat cai daap ce heoi hoi bin jing soeng tung tai jat lok",
  ),
  question(
    "milk-tea",
    "呢間茶餐廳嘅奶茶好香，我每次都會叫一杯。",
    "ni gaan ca caan teng ge naai ca hou hoeng ngo mui ci dou wui giu jat bui",
  ),
  question(
    "before-going-out",
    "出門口之前，記得帶鎖匙同電話，落雨就帶遮。",
    "ceot mun hau zi cin gei dak daai so si tung din waa lok jyu zau daai ze",
  ),
  question(
    "after-work",
    "放工之後，我會去河邊跑步，再返屋企沖涼。",
    "fong gung zi hau ngo wui heoi ho bin paau bou zoi faan uk kei cung loeng",
  ),
  question(
    "drawing",
    "小朋友坐喺窗邊畫畫，畫咗一隻貓同兩隻雀仔。",
    "siu pang jau co hai coeng bin waa waa waa zo jat zek maau tung loeng zek zoek zai",
  ),
  question(
    "birthday",
    "聽日係朋友生日，我準備咗蛋糕，希望佢開心。",
    "ting jat hai pang jau saang jat ngo zeon bei zo daan gou hei mong keoi hoi sam",
  ),
];

export function flattenQuestions() {
  return QUESTIONS.flatMap((item, sentenceIndex) =>
    item.tokens.map(token => ({ ...token, sentenceIndex })),
  );
}

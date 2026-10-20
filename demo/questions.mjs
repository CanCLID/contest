// Original demo article; the organizer will supply the competition article later.
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
    "park-birds",
    "公園入面有好多樹，仲有幾隻雀仔喺度唱歌。",
    "gung jyun jap min jau hou do syu zung jau gei zek zoek zai hai dou coeng go",
  ),
  question(
    "meeting-friends",
    "我哋沿住小路慢慢行，見到朋友，就停低傾偈。",
    "ngo dei jyun zyu siu lou maan maan haang gin dou pang jau zau ting dai king gai",
  ),
  question(
    "tea-break",
    "太陽慢慢升高，我哋買咗兩杯茶，坐喺樹下休息。",
    "taai joeng maan maan sing gou ngo dei maai zo loeng bui caa co hai syu haa jau sik",
  ),
];

export const ARTICLE = {
  id: "park-morning-demo-v2",
  title: "公園嘅早晨",
  text: QUESTIONS.map(item => item.text).join(""),
};

export function flattenQuestions() {
  return QUESTIONS.flatMap((item, sentenceIndex) =>
    item.tokens.map(token => ({ ...token, sentenceIndex })),
  );
}

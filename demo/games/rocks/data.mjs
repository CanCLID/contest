// 粵拼落石題庫：常用、讀音無爭議嘅粵語單字。
// 未經人手校對，正式賽前須校對。
// 格式：{ hanzi, answers }，answers 係小階、無聲調粵拼；有多個通行讀法先放多過一個。

export const ROCK_QUESTIONS = [
  // 自然
  { hanzi: "天", answers: ["tin"] },
  { hanzi: "地", answers: ["dei"] },
  { hanzi: "山", answers: ["saan"] },
  { hanzi: "水", answers: ["seoi"] },
  { hanzi: "火", answers: ["fo"] },
  { hanzi: "風", answers: ["fung"] },
  { hanzi: "雨", answers: ["jyu"] },
  { hanzi: "雲", answers: ["wan"] },
  { hanzi: "星", answers: ["sing"] },
  { hanzi: "月", answers: ["jyut"] },
  { hanzi: "日", answers: ["jat"] },
  { hanzi: "光", answers: ["gwong"] },
  { hanzi: "雪", answers: ["syut"] },
  { hanzi: "海", answers: ["hoi"] },
  { hanzi: "河", answers: ["ho"] },
  { hanzi: "石", answers: ["sek"] },
  { hanzi: "花", answers: ["faa"] },
  { hanzi: "樹", answers: ["syu"] },

  // 動物
  { hanzi: "貓", answers: ["maau"] },
  { hanzi: "狗", answers: ["gau"] },
  { hanzi: "牛", answers: ["ngau"] },
  { hanzi: "馬", answers: ["maa"] },
  { hanzi: "羊", answers: ["joeng"] },
  { hanzi: "豬", answers: ["zyu"] },
  { hanzi: "雞", answers: ["gai"] },
  { hanzi: "魚", answers: ["jyu"] },

  // 身體
  { hanzi: "手", answers: ["sau"] },
  { hanzi: "腳", answers: ["goek"] },
  { hanzi: "眼", answers: ["ngaan"] },
  { hanzi: "耳", answers: ["ji"] },
  { hanzi: "口", answers: ["hau"] },
  { hanzi: "心", answers: ["sam"] },
  { hanzi: "頭", answers: ["tau"] },
  { hanzi: "鼻", answers: ["bei"] },

  // 飲食
  { hanzi: "飯", answers: ["faan"] },
  { hanzi: "茶", answers: ["caa"] },
  { hanzi: "菜", answers: ["coi"] },
  { hanzi: "肉", answers: ["juk"] },
  { hanzi: "蛋", answers: ["daan"] },
  { hanzi: "糖", answers: ["tong"] },
  { hanzi: "米", answers: ["mai"] },
  { hanzi: "湯", answers: ["tong"] },

  // 生活
  { hanzi: "車", answers: ["ce"] },
  { hanzi: "船", answers: ["syun"] },
  { hanzi: "門", answers: ["mun"] },
  { hanzi: "窗", answers: ["coeng"] },
  { hanzi: "街", answers: ["gaai"] },
  { hanzi: "書", answers: ["syu"] },
  { hanzi: "筆", answers: ["bat"] },
  { hanzi: "字", answers: ["zi"] },
  { hanzi: "家", answers: ["gaa"] },
  { hanzi: "燈", answers: ["dang"] },

  // 動作
  { hanzi: "走", answers: ["zau"] },
  { hanzi: "坐", answers: ["co"] },
  { hanzi: "食", answers: ["sik"] },
  { hanzi: "飲", answers: ["jam"] },
  { hanzi: "睇", answers: ["tai"] },
  { hanzi: "聽", answers: ["ting"] },
  { hanzi: "講", answers: ["gong"] },
  { hanzi: "寫", answers: ["se"] },

  // 形容
  { hanzi: "好", answers: ["hou"] },
  { hanzi: "大", answers: ["daai"] },
  { hanzi: "高", answers: ["gou"] },
  { hanzi: "低", answers: ["dai"] },
  { hanzi: "新", answers: ["san"] },
  { hanzi: "快", answers: ["faai"] },

  // 數字
  { hanzi: "三", answers: ["saam"] },
  { hanzi: "四", answers: ["sei"] },
  { hanzi: "五", answers: ["ng"] },
  { hanzi: "六", answers: ["luk"] },
  { hanzi: "七", answers: ["cat"] },
  { hanzi: "八", answers: ["baat"] },
];

const HANZI = /^\p{Script=Han}$/u;
const SYLLABLE = /^[a-z]+$/;

export function validateBank(bank) {
  if (!Array.isArray(bank) || bank.length === 0) {
    throw new TypeError("題庫要係非空陣列。");
  }
  const seen = new Set();
  for (const [index, token] of bank.entries()) {
    if (!token || typeof token.hanzi !== "string" || !HANZI.test(token.hanzi)) {
      throw new TypeError(`題庫第 ${index} 項嘅 hanzi 要係單一漢字。`);
    }
    if (seen.has(token.hanzi)) {
      throw new TypeError(`題庫有重複漢字：${token.hanzi}`);
    }
    seen.add(token.hanzi);
    if (!Array.isArray(token.answers) || token.answers.length === 0 ||
        token.answers.some(answer => typeof answer !== "string" || !SYLLABLE.test(answer))) {
      throw new TypeError(`題庫「${token.hanzi}」嘅 answers 要係非空、小階、無聲調粵拼。`);
    }
  }
  return bank;
}

validateBank(ROCK_QUESTIONS);

(function () {
  "use strict";

  // Curated baseline derived from readme-SVG/Banned-words (Apache-2.0).
  // Exact words and explicit stems only: the upstream full lists contain
  // context-dependent terms and are intentionally not enforced wholesale.
  let RULES = {
    ES: [
      "cabron*","gilipollas*","hijoputa*","hijo de puta","mierda*","maricon*",
      "pendejo*","puta*","zorra*","comepollas*","chupapollas*","soplapollas*",
      "imbecil*","idiota*","vete a la mierda","te voy a matar","voy a matarte",
      "muerete","ojala mueras","nazi*","racista*"
    ],
    EN: [
      "asshole*","bastard*","bitch*","bullshit*","cocksucker*","dumbass*",
      "fuck*","motherfucker*","piece of shit","shit*","slut*","whore*",
      "kill yourself","i will kill you","go die","drop dead","nazi*","neo nazi*"
    ],
    RU: [
      "бляд*","блят*","гандон*","долбоеб*","долбоёб*","ебан*","ебат*",
      "идиот*","мудак*","пидор*","пизд*","сука*","хуй*","хуе*","хуё*",
      "я тебя убью","убей себя","сдохни","чтоб ты сдох","нацист*"
    ]
  };

  const LEET = new Map([["0","o"],["1","i"],["3","e"],["4","a"],["5","s"],["7","t"],["@","a"],["$","s"]]);

  function normalize(value, lang) {
    let text=String(value || "").normalize("NFKC").toLocaleLowerCase(lang === "RU" ? "ru" : lang === "ES" ? "es" : "en");
    if (lang !== "RU") text=text.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    text=[...text].map(char=>LEET.get(char)||char).join("");
    text=text.replace(/(.)\1{2,}/gu,"$1$1").replace(/[^\p{L}\p{N}]+/gu," ").trim().replace(/\s+/g," ");
    return text.replace(/\b(?:\p{L}\s+){2,}\p{L}\b/gu,match=>match.replace(/\s/g,""));
  }

  function check(value, lang) {
    const normalized=normalize(value,lang), words=normalized.split(" ").filter(Boolean), rules=RULES[lang]||RULES.EN;
    for (const rawRule of rules) {
      const rule=normalize(rawRule.replace(/\*$/, ""),lang), stem=rawRule.endsWith("*");
      const matched=rule.includes(" ") ? (` ${normalized} `).includes(` ${rule} `) : words.some(word=>stem?word.startsWith(rule):word===rule);
      if (matched) return {blocked:true,rule,category:rule.includes("matar")||rule.includes("kill")||rule.includes("уб")||rule.includes("сдох")?"threat":"abuse"};
    }
    return {blocked:false};
  }

  // El servidor de red local puede sustituir la lista (panel de administración).
  function setRules(rules) {
    if (!rules || typeof rules !== "object") return;
    const next = {...RULES};
    ["ES","EN","RU"].forEach(lang => { if (Array.isArray(rules[lang])) next[lang] = rules[lang].map(String).filter(Boolean); });
    RULES = next;
  }

  window.MorseModeration={check,normalize,setRules,source:"https://github.com/readme-SVG/Banned-words",license:"Apache-2.0"};
})();

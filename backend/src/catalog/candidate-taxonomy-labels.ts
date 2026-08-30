import type { CandidateAppDisplayLocale } from './candidate-locales.constant';

type CandidateLabels = Readonly<Record<CandidateAppDisplayLocale, string>>;

export const CANDIDATE_CATEGORY_LABELS: Readonly<Record<string, CandidateLabels>> = {
  animals: { en: 'Animals', tr: 'Hayvanlar', es: 'Animales', de: 'Tiere', fr: 'Animaux', 'pt-BR': 'Animais', it: 'Animali', ar: 'حيوانات', ja: '動物', ko: '동물', nl: 'Dieren', pl: 'Zwierzęta' },
  'nature-flowers': { en: 'Nature & Flowers', tr: 'Doğa ve Çiçekler', es: 'Naturaleza y flores', de: 'Natur & Blumen', fr: 'Nature et fleurs', 'pt-BR': 'Natureza e Flores', it: 'Natura e Fiori', ar: 'الطبيعة والزهور', ja: '自然と花', ko: '자연과 꽃', nl: 'Natuur & Bloemen', pl: 'Natura i kwiaty' },
  people: { en: 'People', tr: 'İnsanlar', es: 'Personas', de: 'Menschen', fr: 'Personnes', 'pt-BR': 'Pessoas', it: 'Persone', ar: 'الناس', ja: '人物', ko: '사람', nl: 'Mensen', pl: 'Ludzie' },
  'places-architecture': { en: 'Places & Architecture', tr: 'Yerler ve Mimari', es: 'Lugares y arquitectura', de: 'Orte & Architektur', fr: 'Lieux et architecture', 'pt-BR': 'Lugares e Arquitetura', it: 'Luoghi e Architettura', ar: 'الأماكن والعمارة', ja: '場所と建築', ko: '장소와 건축', nl: 'Plekken & Architectuur', pl: 'Miejsca i architektura' },
  'food-drink': { en: 'Food & Drink', tr: 'Yiyecek ve İçecek', es: 'Comida y bebida', de: 'Essen & Trinken', fr: 'Cuisine et boissons', 'pt-BR': 'Comidas e Bebidas', it: 'Cibo e Bevande', ar: 'طعام وشراب', ja: '食べ物と飲み物', ko: '음식과 음료', nl: 'Eten & Drinken', pl: 'Jedzenie i picie' },
  'holidays-seasons': { en: 'Holidays & Seasons', tr: 'Tatiller ve Mevsimler', es: 'Festividades y estaciones', de: 'Feiertage & Jahreszeiten', fr: 'Fêtes et saisons', 'pt-BR': 'Datas Comemorativas e Estações', it: 'Festività e Stagioni', ar: 'العطلات والفصول', ja: '祝日と季節', ko: '기념일과 계절', nl: 'Feestdagen & Seizoenen', pl: 'Święta i pory roku' },
  fantasy: { en: 'Fantasy', tr: 'Fantastik', es: 'Fantasía', de: 'Fantasy', fr: 'Fantaisie', 'pt-BR': 'Fantasia', it: 'Fantasy', ar: 'خيال', ja: 'ファンタジー', ko: '판타지', nl: 'Fantasie', pl: 'Fantasy' },
  'geometric-abstract': { en: 'Geometric & Abstract', tr: 'Geometrik ve Soyut', es: 'Geométrico y abstracto', de: 'Geometrisch & Abstrakt', fr: 'Géométrique et abstrait', 'pt-BR': 'Geométrico e Abstrato', it: 'Geometrico e Astratto', ar: 'هندسي وتجريدي', ja: '幾何学・抽象', ko: '기하학 및 추상', nl: 'Geometrisch & Abstract', pl: 'Geometryczne i abstrakcyjne' },
  'words-symbols': { en: 'Words & Symbols', tr: 'Kelimeler ve Semboller', es: 'Palabras y símbolos', de: 'Worte & Symbole', fr: 'Mots et symboles', 'pt-BR': 'Palavras e Símbolos', it: 'Scritte e Simboli', ar: 'كلمات ورموز', ja: '言葉とシンボル', ko: '문구와 심볼', nl: 'Woorden & Symbolen', pl: 'Słowa i symbole' },
  other: { en: 'Other', tr: 'Diğer', es: 'Otros', de: 'Sonstiges', fr: 'Autres', 'pt-BR': 'Outros', it: 'Altro', ar: 'أخرى', ja: 'その他', ko: '기타', nl: 'Overig', pl: 'Inne' },
};

export const CANDIDATE_TAG_LABELS: Readonly<Record<string, CandidateLabels>> = {
  retro: { en: 'Retro', tr: 'Retro', es: 'Retro', de: 'Retro', fr: 'Rétro', 'pt-BR': 'Retrô', it: 'Retrò', ar: 'ريترو', ja: 'レトロ', ko: '레트로', nl: 'Retro', pl: 'Retro' },
  dinosaur: { en: 'Dinosaur', tr: 'Dinozor', es: 'Dinosaurio', de: 'Dinosaurier', fr: 'Dinosaure', 'pt-BR': 'Dinossauro', it: 'Dinosauro', ar: 'ديناصور', ja: '恐竜', ko: '공룡', nl: 'Dinosaurus', pl: 'Dinozaur' },
  kid: { en: 'Kids', tr: 'Çocuklar', es: 'Infantil', de: 'Kinder', fr: 'Enfants', 'pt-BR': 'Infantil', it: 'Bambini', ar: 'أطفال', ja: '子ども向け', ko: '어린이', nl: 'Kinderen', pl: 'Dzieci' },
  flower: { en: 'Flower', tr: 'Çiçek', es: 'Flor', de: 'Blume', fr: 'Fleur', 'pt-BR': 'Flor', it: 'Fiore', ar: 'زهرة', ja: '花', ko: '꽃', nl: 'Bloem', pl: 'Kwiat' },
  spring: { en: 'Spring', tr: 'İlkbahar', es: 'Primavera', de: 'Frühling', fr: 'Printemps', 'pt-BR': 'Primavera', it: 'Primavera', ar: 'ربيع', ja: '春', ko: '봄', nl: 'Lente', pl: 'Wiosna' },
  cute: { en: 'Cute', tr: 'Sevimli', es: 'Tierno', de: 'Niedlich', fr: 'Mignon', 'pt-BR': 'Fofo', it: 'Carino', ar: 'لطيف', ja: 'かわいい', ko: '귀여움', nl: 'Schattig', pl: 'Uroczy' },
  cat: { en: 'Cat', tr: 'Kedi', es: 'Gato', de: 'Katze', fr: 'Chat', 'pt-BR': 'Gato', it: 'Gatto', ar: 'قطة', ja: '猫', ko: '고양이', nl: 'Kat', pl: 'Kot' },
  funny: { en: 'Funny', tr: 'Komik', es: 'Divertido', de: 'Lustig', fr: 'Drôle', 'pt-BR': 'Engraçado', it: 'Divertente', ar: 'مضحك', ja: 'ユーモラス', ko: '재미있음', nl: 'Grappig', pl: 'Zabawny' },
  coffee: { en: 'Coffee', tr: 'Kahve', es: 'Café', de: 'Kaffee', fr: 'Café', 'pt-BR': 'Café', it: 'Caffè', ar: 'قهوة', ja: 'コーヒー', ko: '커피', nl: 'Koffie', pl: 'Kawa' },
  warm: { en: 'Warm', tr: 'Sıcak', es: 'Cálido', de: 'Warm', fr: 'Chaleureux', 'pt-BR': 'Aconchegante', it: 'Caldo', ar: 'دافئ', ja: '暖かい', ko: '따뜻함', nl: 'Warm', pl: 'Ciepły' },
  cozy: { en: 'Cozy', tr: 'Rahat', es: 'Acogedor', de: 'Gemütlich', fr: 'Douillet', 'pt-BR': 'Aconchegante', it: 'Accogliente', ar: 'مريح', ja: '心地よい', ko: '아늑함', nl: 'Gezellig', pl: 'Przytulny' },
  love: { en: 'Love', tr: 'Aşk', es: 'Amor', de: 'Liebe', fr: 'Amour', 'pt-BR': 'Amor', it: 'Amore', ar: 'حب', ja: '愛', ko: '사랑', nl: 'Liefde', pl: 'Miłość' },
  heart: { en: 'Heart', tr: 'Kalp', es: 'Corazón', de: 'Herz', fr: 'Cœur', 'pt-BR': 'Coração', it: 'Cuore', ar: 'قلب', ja: 'ハート', ko: '하트', nl: 'Hart', pl: 'Serce' },
  autumn: { en: 'Autumn', tr: 'Sonbahar', es: 'Otoño', de: 'Herbst', fr: 'Automne', 'pt-BR': 'Outono', it: 'Autunno', ar: 'خريف', ja: '秋', ko: '가을', nl: 'Herfst', pl: 'Jesień' },
  leaf: { en: 'Leaf', tr: 'Yaprak', es: 'Hoja', de: 'Blatt', fr: 'Feuille', 'pt-BR': 'Folha', it: 'Foglia', ar: 'ورقة شجر', ja: '葉', ko: '잎', nl: 'Blad', pl: 'Liść' },
  orange: { en: 'Orange', tr: 'Turuncu', es: 'Naranja', de: 'Orange', fr: 'Orange', 'pt-BR': 'Laranja', it: 'Arancione', ar: 'برتقالي', ja: 'オレンジ', ko: '주황색', nl: 'Oranje', pl: 'Pomarańczowy' },
  star: { en: 'Star', tr: 'Yıldız', es: 'Estrella', de: 'Stern', fr: 'Étoile', 'pt-BR': 'Estrela', it: 'Stella', ar: 'نجمة', ja: '星', ko: '별', nl: 'Ster', pl: 'Gwiazda' },
  magic: { en: 'Magic', tr: 'Sihir', es: 'Magia', de: 'Magie', fr: 'Magie', 'pt-BR': 'Magia', it: 'Magia', ar: 'سحر', ja: '魔法', ko: '마법', nl: 'Magie', pl: 'Magia' },
  purple: { en: 'Purple', tr: 'Mor', es: 'Morado', de: 'Lila', fr: 'Violet', 'pt-BR': 'Roxo', it: 'Viola', ar: 'بنفسجي', ja: '紫', ko: '보라색', nl: 'Paars', pl: 'Fioletowy' },
  pattern: { en: 'Pattern', tr: 'Desen', es: 'Patrón', de: 'Muster', fr: 'Motif', 'pt-BR': 'Padrão', it: 'Motivo', ar: 'نمط', ja: '模様', ko: '패턴', nl: 'Patroon', pl: 'Wzór' },
  peace: { en: 'Peace', tr: 'Barış', es: 'Paz', de: 'Frieden', fr: 'Paix', 'pt-BR': 'Paz', it: 'Pace', ar: 'سلام', ja: '平和', ko: '평화', nl: 'Vrede', pl: 'Pokój' },
  symbol: { en: 'Symbol', tr: 'Sembol', es: 'Símbolo', de: 'Symbol', fr: 'Symbole', 'pt-BR': 'Símbolo', it: 'Simbolo', ar: 'رمز', ja: 'シンボル', ko: '심볼', nl: 'Symbool', pl: 'Symbol' },
  desert: { en: 'Desert', tr: 'Çöl', es: 'Desierto', de: 'Wüste', fr: 'Désert', 'pt-BR': 'Deserto', it: 'Deserto', ar: 'صحراء', ja: '砂漠', ko: '사막', nl: 'Woestijn', pl: 'Pustynia' },
  plant: { en: 'Plant', tr: 'Bitki', es: 'Planta', de: 'Pflanze', fr: 'Plante', 'pt-BR': 'Planta', it: 'Pianta', ar: 'نبات', ja: '植物', ko: '식물', nl: 'Plant', pl: 'Roślina' },
  food: { en: 'Food', tr: 'Yiyecek', es: 'Comida', de: 'Essen', fr: 'Cuisine', 'pt-BR': 'Comida', it: 'Cibo', ar: 'طعام', ja: '食べ物', ko: '음식', nl: 'Eten', pl: 'Jedzenie' },
  pizza: { en: 'Pizza', tr: 'Pizza', es: 'Pizza', de: 'Pizza', fr: 'Pizza', 'pt-BR': 'Pizza', it: 'Pizza', ar: 'بيتزا', ja: 'ピザ', ko: '피자', nl: 'Pizza', pl: 'Pizza' },
  yummy: { en: 'Yummy', tr: 'Lezzetli', es: 'Delicioso', de: 'Lecker', fr: 'Délicieux', 'pt-BR': 'Delicioso', it: 'Delizioso', ar: 'لذيذ', ja: 'おいしい', ko: '맛있음', nl: 'Lekker', pl: 'Pyszne' },
  castle: { en: 'Castle', tr: 'Kale', es: 'Castillo', de: 'Schloss', fr: 'Château', 'pt-BR': 'Castelo', it: 'Castello', ar: 'قلعة', ja: '城', ko: '성', nl: 'Kasteel', pl: 'Zamek' },
  stone: { en: 'Stone', tr: 'Taş', es: 'Piedra', de: 'Stein', fr: 'Pierre', 'pt-BR': 'Pedra', it: 'Pietra', ar: 'حجر', ja: '石', ko: '돌', nl: 'Steen', pl: 'Kamień' },
};

export const CANDIDATE_TAXONOMY_COVERAGE = Object.fromEntries(
  (['en', 'tr', 'es', 'de', 'fr', 'pt-BR', 'it', 'ar', 'ja', 'ko', 'nl', 'pl'] as const).map((locale) => [locale, {
    categories: Object.values(CANDIDATE_CATEGORY_LABELS).filter((labels) => labels[locale]).length,
    tags: Object.values(CANDIDATE_TAG_LABELS).filter((labels) => labels[locale]).length,
  }]),
);

import type { CandidateAppDisplayLocale } from './candidate-locales.constant';

type CandidateLabels = Readonly<Record<CandidateAppDisplayLocale, string>>;

export const CANDIDATE_CATEGORY_LABELS: Readonly<Record<string, CandidateLabels>> = {
  animals: { en: 'Animals', tr: 'Hayvanlar', es: 'Animales', de: 'Tiere', fr: 'Animaux', 'pt-BR': 'Animais', it: 'Animali', ar: 'حيوانات' },
  'nature-flowers': { en: 'Nature & Flowers', tr: 'Doğa ve Çiçekler', es: 'Naturaleza y flores', de: 'Natur & Blumen', fr: 'Nature et fleurs', 'pt-BR': 'Natureza e Flores', it: 'Natura e Fiori', ar: 'الطبيعة والزهور' },
  people: { en: 'People', tr: 'İnsanlar', es: 'Personas', de: 'Menschen', fr: 'Personnes', 'pt-BR': 'Pessoas', it: 'Persone', ar: 'الناس' },
  'places-architecture': { en: 'Places & Architecture', tr: 'Yerler ve Mimari', es: 'Lugares y arquitectura', de: 'Orte & Architektur', fr: 'Lieux et architecture', 'pt-BR': 'Lugares e Arquitetura', it: 'Luoghi e Architettura', ar: 'الأماكن والعمارة' },
  'food-drink': { en: 'Food & Drink', tr: 'Yiyecek ve İçecek', es: 'Comida y bebida', de: 'Essen & Trinken', fr: 'Cuisine et boissons', 'pt-BR': 'Comidas e Bebidas', it: 'Cibo e Bevande', ar: 'طعام وشراب' },
  'holidays-seasons': { en: 'Holidays & Seasons', tr: 'Tatiller ve Mevsimler', es: 'Festividades y estaciones', de: 'Feiertage & Jahreszeiten', fr: 'Fêtes et saisons', 'pt-BR': 'Datas Comemorativas e Estações', it: 'Festività e Stagioni', ar: 'العطلات والفصول' },
  fantasy: { en: 'Fantasy', tr: 'Fantastik', es: 'Fantasía', de: 'Fantasy', fr: 'Fantaisie', 'pt-BR': 'Fantasia', it: 'Fantasy', ar: 'خيال' },
  'geometric-abstract': { en: 'Geometric & Abstract', tr: 'Geometrik ve Soyut', es: 'Geométrico y abstracto', de: 'Geometrisch & Abstrakt', fr: 'Géométrique et abstrait', 'pt-BR': 'Geométrico e Abstrato', it: 'Geometrico e Astratto', ar: 'هندسي وتجريدي' },
  'words-symbols': { en: 'Words & Symbols', tr: 'Kelimeler ve Semboller', es: 'Palabras y símbolos', de: 'Worte & Symbole', fr: 'Mots et symboles', 'pt-BR': 'Palavras e Símbolos', it: 'Scritte e Simboli', ar: 'كلمات ورموز' },
  other: { en: 'Other', tr: 'Diğer', es: 'Otros', de: 'Sonstiges', fr: 'Autres', 'pt-BR': 'Outros', it: 'Altro', ar: 'أخرى' },
};

export const CANDIDATE_TAG_LABELS: Readonly<Record<string, CandidateLabels>> = {
  retro: { en: 'Retro', tr: 'Retro', es: 'Retro', de: 'Retro', fr: 'Rétro', 'pt-BR': 'Retrô', it: 'Retrò', ar: 'ريترو' },
  dinosaur: { en: 'Dinosaur', tr: 'Dinozor', es: 'Dinosaurio', de: 'Dinosaurier', fr: 'Dinosaure', 'pt-BR': 'Dinossauro', it: 'Dinosauro', ar: 'ديناصور' },
  kid: { en: 'Kids', tr: 'Çocuklar', es: 'Infantil', de: 'Kinder', fr: 'Enfants', 'pt-BR': 'Infantil', it: 'Bambini', ar: 'أطفال' },
  flower: { en: 'Flower', tr: 'Çiçek', es: 'Flor', de: 'Blume', fr: 'Fleur', 'pt-BR': 'Flor', it: 'Fiore', ar: 'زهرة' },
  spring: { en: 'Spring', tr: 'İlkbahar', es: 'Primavera', de: 'Frühling', fr: 'Printemps', 'pt-BR': 'Primavera', it: 'Primavera', ar: 'ربيع' },
  cute: { en: 'Cute', tr: 'Sevimli', es: 'Tierno', de: 'Niedlich', fr: 'Mignon', 'pt-BR': 'Fofo', it: 'Carino', ar: 'لطيف' },
  cat: { en: 'Cat', tr: 'Kedi', es: 'Gato', de: 'Katze', fr: 'Chat', 'pt-BR': 'Gato', it: 'Gatto', ar: 'قطة' },
  funny: { en: 'Funny', tr: 'Komik', es: 'Divertido', de: 'Lustig', fr: 'Drôle', 'pt-BR': 'Engraçado', it: 'Divertente', ar: 'مضحك' },
  coffee: { en: 'Coffee', tr: 'Kahve', es: 'Café', de: 'Kaffee', fr: 'Café', 'pt-BR': 'Café', it: 'Caffè', ar: 'قهوة' },
  warm: { en: 'Warm', tr: 'Sıcak', es: 'Cálido', de: 'Warm', fr: 'Chaleureux', 'pt-BR': 'Aconchegante', it: 'Caldo', ar: 'دافئ' },
  cozy: { en: 'Cozy', tr: 'Rahat', es: 'Acogedor', de: 'Gemütlich', fr: 'Douillet', 'pt-BR': 'Aconchegante', it: 'Accogliente', ar: 'مريح' },
  love: { en: 'Love', tr: 'Aşk', es: 'Amor', de: 'Liebe', fr: 'Amour', 'pt-BR': 'Amor', it: 'Amore', ar: 'حب' },
  heart: { en: 'Heart', tr: 'Kalp', es: 'Corazón', de: 'Herz', fr: 'Cœur', 'pt-BR': 'Coração', it: 'Cuore', ar: 'قلب' },
  autumn: { en: 'Autumn', tr: 'Sonbahar', es: 'Otoño', de: 'Herbst', fr: 'Automne', 'pt-BR': 'Outono', it: 'Autunno', ar: 'خريف' },
  leaf: { en: 'Leaf', tr: 'Yaprak', es: 'Hoja', de: 'Blatt', fr: 'Feuille', 'pt-BR': 'Folha', it: 'Foglia', ar: 'ورقة شجر' },
  orange: { en: 'Orange', tr: 'Turuncu', es: 'Naranja', de: 'Orange', fr: 'Orange', 'pt-BR': 'Laranja', it: 'Arancione', ar: 'برتقالي' },
  star: { en: 'Star', tr: 'Yıldız', es: 'Estrella', de: 'Stern', fr: 'Étoile', 'pt-BR': 'Estrela', it: 'Stella', ar: 'نجمة' },
  magic: { en: 'Magic', tr: 'Sihir', es: 'Magia', de: 'Magie', fr: 'Magie', 'pt-BR': 'Magia', it: 'Magia', ar: 'سحر' },
  purple: { en: 'Purple', tr: 'Mor', es: 'Morado', de: 'Lila', fr: 'Violet', 'pt-BR': 'Roxo', it: 'Viola', ar: 'بنفسجي' },
  pattern: { en: 'Pattern', tr: 'Desen', es: 'Patrón', de: 'Muster', fr: 'Motif', 'pt-BR': 'Padrão', it: 'Motivo', ar: 'نمط' },
  peace: { en: 'Peace', tr: 'Barış', es: 'Paz', de: 'Frieden', fr: 'Paix', 'pt-BR': 'Paz', it: 'Pace', ar: 'سلام' },
  symbol: { en: 'Symbol', tr: 'Sembol', es: 'Símbolo', de: 'Symbol', fr: 'Symbole', 'pt-BR': 'Símbolo', it: 'Simbolo', ar: 'رمز' },
  desert: { en: 'Desert', tr: 'Çöl', es: 'Desierto', de: 'Wüste', fr: 'Désert', 'pt-BR': 'Deserto', it: 'Deserto', ar: 'صحراء' },
  plant: { en: 'Plant', tr: 'Bitki', es: 'Planta', de: 'Pflanze', fr: 'Plante', 'pt-BR': 'Planta', it: 'Pianta', ar: 'نبات' },
  food: { en: 'Food', tr: 'Yiyecek', es: 'Comida', de: 'Essen', fr: 'Cuisine', 'pt-BR': 'Comida', it: 'Cibo', ar: 'طعام' },
  pizza: { en: 'Pizza', tr: 'Pizza', es: 'Pizza', de: 'Pizza', fr: 'Pizza', 'pt-BR': 'Pizza', it: 'Pizza', ar: 'بيتزا' },
  yummy: { en: 'Yummy', tr: 'Lezzetli', es: 'Delicioso', de: 'Lecker', fr: 'Délicieux', 'pt-BR': 'Delicioso', it: 'Delizioso', ar: 'لذيذ' },
  castle: { en: 'Castle', tr: 'Kale', es: 'Castillo', de: 'Schloss', fr: 'Château', 'pt-BR': 'Castelo', it: 'Castello', ar: 'قلعة' },
  stone: { en: 'Stone', tr: 'Taş', es: 'Piedra', de: 'Stein', fr: 'Pierre', 'pt-BR': 'Pedra', it: 'Pietra', ar: 'حجر' },
};

export const CANDIDATE_TAXONOMY_COVERAGE = Object.fromEntries(
  (['en', 'tr', 'es', 'de', 'fr', 'pt-BR', 'it', 'ar'] as const).map((locale) => [locale, {
    categories: Object.values(CANDIDATE_CATEGORY_LABELS).filter((labels) => labels[locale]).length,
    tags: Object.values(CANDIDATE_TAG_LABELS).filter((labels) => labels[locale]).length,
  }]),
);

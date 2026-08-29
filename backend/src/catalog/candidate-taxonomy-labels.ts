import type { CandidateAppDisplayLocale } from './candidate-locales.constant';

type CandidateLabels = Readonly<Record<CandidateAppDisplayLocale, string>>;

export const CANDIDATE_CATEGORY_LABELS: Readonly<Record<string, CandidateLabels>> = {
  animals: { en: 'Animals', tr: 'Hayvanlar', es: 'Animales', de: 'Tiere', fr: 'Animaux', 'pt-BR': 'Animais', it: 'Animali' },
  'nature-flowers': { en: 'Nature & Flowers', tr: 'Doğa ve Çiçekler', es: 'Naturaleza y flores', de: 'Natur & Blumen', fr: 'Nature et fleurs', 'pt-BR': 'Natureza e Flores', it: 'Natura e Fiori' },
  people: { en: 'People', tr: 'İnsanlar', es: 'Personas', de: 'Menschen', fr: 'Personnes', 'pt-BR': 'Pessoas', it: 'Persone' },
  'places-architecture': { en: 'Places & Architecture', tr: 'Yerler ve Mimari', es: 'Lugares y arquitectura', de: 'Orte & Architektur', fr: 'Lieux et architecture', 'pt-BR': 'Lugares e Arquitetura', it: 'Luoghi e Architettura' },
  'food-drink': { en: 'Food & Drink', tr: 'Yiyecek ve İçecek', es: 'Comida y bebida', de: 'Essen & Trinken', fr: 'Cuisine et boissons', 'pt-BR': 'Comidas e Bebidas', it: 'Cibo e Bevande' },
  'holidays-seasons': { en: 'Holidays & Seasons', tr: 'Tatiller ve Mevsimler', es: 'Festividades y estaciones', de: 'Feiertage & Jahreszeiten', fr: 'Fêtes et saisons', 'pt-BR': 'Datas Comemorativas e Estações', it: 'Festività e Stagioni' },
  fantasy: { en: 'Fantasy', tr: 'Fantastik', es: 'Fantasía', de: 'Fantasy', fr: 'Fantaisie', 'pt-BR': 'Fantasia', it: 'Fantasy' },
  'geometric-abstract': { en: 'Geometric & Abstract', tr: 'Geometrik ve Soyut', es: 'Geométrico y abstracto', de: 'Geometrisch & Abstrakt', fr: 'Géométrique et abstrait', 'pt-BR': 'Geométrico e Abstrato', it: 'Geometrico e Astratto' },
  'words-symbols': { en: 'Words & Symbols', tr: 'Kelimeler ve Semboller', es: 'Palabras y símbolos', de: 'Worte & Symbole', fr: 'Mots et symboles', 'pt-BR': 'Palavras e Símbolos', it: 'Scritte e Simboli' },
  other: { en: 'Other', tr: 'Diğer', es: 'Otros', de: 'Sonstiges', fr: 'Autres', 'pt-BR': 'Outros', it: 'Altro' },
};

export const CANDIDATE_TAG_LABELS: Readonly<Record<string, CandidateLabels>> = {
  retro: { en: 'Retro', tr: 'Retro', es: 'Retro', de: 'Retro', fr: 'Rétro', 'pt-BR': 'Retrô', it: 'Retrò' },
  dinosaur: { en: 'Dinosaur', tr: 'Dinozor', es: 'Dinosaurio', de: 'Dinosaurier', fr: 'Dinosaure', 'pt-BR': 'Dinossauro', it: 'Dinosauro' },
  kid: { en: 'Kids', tr: 'Çocuklar', es: 'Infantil', de: 'Kinder', fr: 'Enfants', 'pt-BR': 'Infantil', it: 'Bambini' },
  flower: { en: 'Flower', tr: 'Çiçek', es: 'Flor', de: 'Blume', fr: 'Fleur', 'pt-BR': 'Flor', it: 'Fiore' },
  spring: { en: 'Spring', tr: 'İlkbahar', es: 'Primavera', de: 'Frühling', fr: 'Printemps', 'pt-BR': 'Primavera', it: 'Primavera' },
  cute: { en: 'Cute', tr: 'Sevimli', es: 'Tierno', de: 'Niedlich', fr: 'Mignon', 'pt-BR': 'Fofo', it: 'Carino' },
  cat: { en: 'Cat', tr: 'Kedi', es: 'Gato', de: 'Katze', fr: 'Chat', 'pt-BR': 'Gato', it: 'Gatto' },
  funny: { en: 'Funny', tr: 'Komik', es: 'Divertido', de: 'Lustig', fr: 'Drôle', 'pt-BR': 'Engraçado', it: 'Divertente' },
  coffee: { en: 'Coffee', tr: 'Kahve', es: 'Café', de: 'Kaffee', fr: 'Café', 'pt-BR': 'Café', it: 'Caffè' },
  warm: { en: 'Warm', tr: 'Sıcak', es: 'Cálido', de: 'Warm', fr: 'Chaleureux', 'pt-BR': 'Aconchegante', it: 'Caldo' },
  cozy: { en: 'Cozy', tr: 'Rahat', es: 'Acogedor', de: 'Gemütlich', fr: 'Douillet', 'pt-BR': 'Aconchegante', it: 'Accogliente' },
  love: { en: 'Love', tr: 'Aşk', es: 'Amor', de: 'Liebe', fr: 'Amour', 'pt-BR': 'Amor', it: 'Amore' },
  heart: { en: 'Heart', tr: 'Kalp', es: 'Corazón', de: 'Herz', fr: 'Cœur', 'pt-BR': 'Coração', it: 'Cuore' },
  autumn: { en: 'Autumn', tr: 'Sonbahar', es: 'Otoño', de: 'Herbst', fr: 'Automne', 'pt-BR': 'Outono', it: 'Autunno' },
  leaf: { en: 'Leaf', tr: 'Yaprak', es: 'Hoja', de: 'Blatt', fr: 'Feuille', 'pt-BR': 'Folha', it: 'Foglia' },
  orange: { en: 'Orange', tr: 'Turuncu', es: 'Naranja', de: 'Orange', fr: 'Orange', 'pt-BR': 'Laranja', it: 'Arancione' },
  star: { en: 'Star', tr: 'Yıldız', es: 'Estrella', de: 'Stern', fr: 'Étoile', 'pt-BR': 'Estrela', it: 'Stella' },
  magic: { en: 'Magic', tr: 'Sihir', es: 'Magia', de: 'Magie', fr: 'Magie', 'pt-BR': 'Magia', it: 'Magia' },
  purple: { en: 'Purple', tr: 'Mor', es: 'Morado', de: 'Lila', fr: 'Violet', 'pt-BR': 'Roxo', it: 'Viola' },
  pattern: { en: 'Pattern', tr: 'Desen', es: 'Patrón', de: 'Muster', fr: 'Motif', 'pt-BR': 'Padrão', it: 'Motivo' },
  peace: { en: 'Peace', tr: 'Barış', es: 'Paz', de: 'Frieden', fr: 'Paix', 'pt-BR': 'Paz', it: 'Pace' },
  symbol: { en: 'Symbol', tr: 'Sembol', es: 'Símbolo', de: 'Symbol', fr: 'Symbole', 'pt-BR': 'Símbolo', it: 'Simbolo' },
  desert: { en: 'Desert', tr: 'Çöl', es: 'Desierto', de: 'Wüste', fr: 'Désert', 'pt-BR': 'Deserto', it: 'Deserto' },
  plant: { en: 'Plant', tr: 'Bitki', es: 'Planta', de: 'Pflanze', fr: 'Plante', 'pt-BR': 'Planta', it: 'Pianta' },
  food: { en: 'Food', tr: 'Yiyecek', es: 'Comida', de: 'Essen', fr: 'Cuisine', 'pt-BR': 'Comida', it: 'Cibo' },
  pizza: { en: 'Pizza', tr: 'Pizza', es: 'Pizza', de: 'Pizza', fr: 'Pizza', 'pt-BR': 'Pizza', it: 'Pizza' },
  yummy: { en: 'Yummy', tr: 'Lezzetli', es: 'Delicioso', de: 'Lecker', fr: 'Délicieux', 'pt-BR': 'Delicioso', it: 'Delizioso' },
  castle: { en: 'Castle', tr: 'Kale', es: 'Castillo', de: 'Schloss', fr: 'Château', 'pt-BR': 'Castelo', it: 'Castello' },
  stone: { en: 'Stone', tr: 'Taş', es: 'Piedra', de: 'Stein', fr: 'Pierre', 'pt-BR': 'Pedra', it: 'Pietra' },
};

export const CANDIDATE_TAXONOMY_COVERAGE = Object.fromEntries(
  (['en', 'tr', 'es', 'de', 'fr', 'pt-BR', 'it'] as const).map((locale) => [locale, {
    categories: Object.values(CANDIDATE_CATEGORY_LABELS).filter((labels) => labels[locale]).length,
    tags: Object.values(CANDIDATE_TAG_LABELS).filter((labels) => labels[locale]).length,
  }]),
);

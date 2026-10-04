import { surfacePoint } from './shellPieces.js';

/**
 * Виды заданий на фольге — по кругу, от яйца к яйцу (см. game.js):
 * цвета (участок просто закрашен), цифры и буквы (на участке ещё и нарисован знак).
 */
export const FOIL_MODES = ['colors', 'digits', 'letters'];

// Для каждого знака три формы названия (см. описание участка в foil.js):
//   askSpoken — что говорит диктор в «Обери ...!» (винительный падеж),
//   askShown  — то же для надписи на экране,
//   saySpoken — в «Це ...» (именительный падеж).
// Говорим словами, а не самим знаком: одиночную букву или цифру украинский
// голос браузера читает по-разному (а то и вовсе пропускает).
const DIGITS = [
  { glyph: '1', word: 'один' },
  { glyph: '2', word: 'два' },
  { glyph: '3', word: 'три' },
  { glyph: '4', word: 'чотири' },
  { glyph: '5', word: "п'ять" },
  { glyph: '6', word: 'шість' },
  { glyph: '7', word: 'сім' },
  { glyph: '8', word: 'вісім' },
  { glyph: '9', word: "дев'ять" },
];

// Только чёткие, непохожие друг на друга буквы и названия, которые голос
// не спутает: без Ь/Ъ (не называются), Й/И/І/Ы/Ї (путаются на слух и на вид),
// Ґ/Щ/Ю/Є (редкие, похожи на Г/Ш/Я/Е) и без рифмующихся «пе/те/де» с «бе».
// name — как буква называется вслух («М» — «ем»).
const LETTERS = [
  { glyph: 'А', name: 'а' },
  { glyph: 'Б', name: 'бе' },
  { glyph: 'В', name: 'ве' },
  { glyph: 'Г', name: 'ге' },
  { glyph: 'Ж', name: 'же' },
  { glyph: 'З', name: 'зе' },
  { glyph: 'К', name: 'ка' },
  { glyph: 'Л', name: 'ел' },
  { glyph: 'М', name: 'ем' },
  { glyph: 'О', name: 'о' },
  { glyph: 'Р', name: 'ер' },
  { glyph: 'У', name: 'у' },
  { glyph: 'Х', name: 'ха' },
  { glyph: 'Ч', name: 'че' },
  { glyph: 'Ш', name: 'ша' },
  { glyph: 'Я', name: 'я' },
];

function shuffled(list) {
  return [...list].sort(() => Math.random() - 0.5);
}

/**
 * Случайные знаки для яйца — count штук, все РАЗНЫЕ, чтобы вопрос
 * «Обери цифру 5!» имел ровно один верный ответ. Для режима цветов — null
 * (знаков нет, участки различаются только цветом).
 */
export function pickGlyphs(mode, count) {
  if (mode === 'digits') {
    return shuffled(DIGITS)
      .slice(0, count)
      .map((d) => ({
        glyph: d.glyph,
        askSpoken: `цифру ${d.word}`,
        askShown: `цифру ${d.glyph}`,
        saySpoken: `цифра ${d.word}`,
      }));
  }
  if (mode === 'letters') {
    return shuffled(LETTERS)
      .slice(0, count)
      .map((l) => ({
        glyph: l.glyph,
        askSpoken: `літеру ${l.name}`,
        askShown: `літеру ${l.glyph}`,
        saySpoken: `літера ${l.name}`,
      }));
  }
  return null;
}

/** Режим из ?mode=colors|digits|letters (null — не задан или не тот). */
export function pinnedMode() {
  const forced = new URLSearchParams(location.search).get('mode');
  return FOIL_MODES.includes(forced) ? forced : null;
}

const GLYPH_FILL = '#ffffff';
const GLYPH_OUTLINE = '#14143c';
const GLYPH_FONT = "900 100px Nunito, 'Arial Rounded MT Bold', system-ui, sans-serif";
const GLYPH_ASPECT = 0.9;    // ширина знака к его высоте (с запасом на широкие буквы вроде Ж и обводку)
const GLYPH_MAX_HEIGHT = 190; // выше не растим, даже если участок огромный (пикселей текстуры)

/**
 * Во сколько раз пиксель текстуры на строке y «уже», чем высокий: окружность
 * яйца на этой высоте короче, чем растянутая на ширину текстуры. Чтобы знак
 * выглядел на яйце неискажённым, рисуем его в текстуре шире в столько раз.
 */
function stretchPerRow(width, height) {
  const rows = new Float32Array(height);
  const eps = 1e-3;
  for (let y = 0; y < height; y++) {
    const t = Math.min(Math.PI - 2 * eps, Math.max(2 * eps, ((y + 0.5) / height) * Math.PI));
    const here = surfacePoint(0, t, 1);
    const a = surfacePoint(0, t - eps, 1);
    const b = surfacePoint(0, t + eps, 1);
    const radius = Math.max(here.z, 1e-3);
    const arcPerT = a.distanceTo(b) / (2 * eps);
    rows[y] = Math.min(3, arcPerT / radius);
  }
  return rows;
}

/**
 * Для каждого пикселя — расстояние до ближайшей границы своего участка
 * (двухпроходное приближённое преобразование расстояний, с круговым швом
 * по горизонтали). Максимум этого поля — центр самого «просторного» места
 * участка, там знак поместится крупнее всего.
 */
function distanceToBorder(regionMap, width, height) {
  const dist = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const label = regionMap[idx];
      const border =
        regionMap[y * width + ((x + 1) % width)] !== label ||
        regionMap[y * width + ((x - 1 + width) % width)] !== label ||
        (y > 0 && regionMap[idx - width] !== label) ||
        (y < height - 1 && regionMap[idx + width] !== label);
      dist[idx] = border ? 0 : 1e9;
    }
  }
  const SQRT2 = Math.SQRT2;
  const relax = (idx, x, y, dx, dy, cost) => {
    const ny = y + dy;
    if (ny < 0 || ny >= height) return;
    const n = ny * width + ((x + dx + width) % width);
    if (dist[n] + cost < dist[idx]) dist[idx] = dist[n] + cost;
  };
  for (let pass = 0; pass < 2; pass++) { // второй круг дотягивает расстояния через шов
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        relax(idx, x, y, -1, 0, 1);
        relax(idx, x, y, 0, -1, 1);
        relax(idx, x, y, -1, -1, SQRT2);
        relax(idx, x, y, 1, -1, SQRT2);
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const idx = y * width + x;
        relax(idx, x, y, 1, 0, 1);
        relax(idx, x, y, 0, 1, 1);
        relax(idx, x, y, 1, 1, SQRT2);
        relax(idx, x, y, -1, 1, SQRT2);
      }
    }
  }
  return dist;
}

/** Высота знака, вписанного в круг радиуса d: прямоугольник знака (с учётом растяжения) целиком внутри. */
function fitHeight(d, stretch) {
  const h = (1.6 * d) / Math.sqrt(1 + (GLYPH_ASPECT * stretch) ** 2);
  return Math.min(GLYPH_MAX_HEIGHT, h);
}

/**
 * Рисует на каждом участке с glyph его знак — крупно, белым с тёмной
 * обводкой, чтобы читался на любом из ярких фонов (и на жёлтом, и на синем).
 * Знак ставится в самое просторное место участка и подрезается по границе
 * участка: ни одного пикселя на соседнем куске, поэтому при срывании знак
 * уходит вместе со своей фольгой. image — ImageData, уже залитая цветами.
 */
export function paintGlyphs(image, regionMap, patches, width, height) {
  if (!patches.some((p) => p.glyph)) return;
  const dist = distanceToBorder(regionMap, width, height);
  const stretchRows = stretchPerRow(width, height);

  // У макушки и донышка поверхность круто загибается и знак выглядит
  // искажённым — при прочих равных выбираем место поближе к «экватору».
  const rowBias = new Float32Array(height);
  for (let y = 0; y < height; y++) rowBias[y] = Math.max(0.03, 1 - 0.9 * (((2 * y) / height - 1) ** 2));

  // Лучшее место для знака каждого участка: где вписанный знак получается крупнее всего
  // (с поправкой на искажение у полюсов и по краям — см. rowBias и colBias).
  const best = patches.map(() => ({ h: 0, x: 0, y: 0 }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const b = best[regionMap[idx]];
      const patch = patches[regionMap[idx]];
      // Чем дальше от середины участка по кругу яйца, тем сильнее знак заваливается к краю.
      const colBias = Math.max(0.15, 0.5 + 0.5 * Math.cos((x / width) * Math.PI * 2 - patch.midAngle));
      const h = fitHeight(dist[idx], stretchRows[y]) * rowBias[y] * colBias;
      if (h > b.h) {
        b.h = h;
        b.x = x;
        b.y = y;
      }
    }
  }

  for (const patch of patches) {
    if (!patch.glyph) continue;
    const { x: cx, y: cy } = best[patch.index];
    const stretch = stretchRows[cy];
    const reach = dist[cy * width + cx];
    const size = Math.ceil(reach * 2) + 48; // с запасом на толщину обводки

    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = size;
    const g = tmp.getContext('2d', { willReadFrequently: true });
    g.translate(size / 2, size / 2);
    g.scale(stretch, 1);
    g.font = GLYPH_FONT;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.lineJoin = 'round';

    // Кегль подбираем по реально измеренному знаку вместе с обводкой: его
    // габарит (с учётом растяжения) должен целиком лежать в круге участка.
    const OUTLINE = 0.12; // толщина обводки в долях кегля
    const probe = g.measureText(patch.glyph); // замер при 100px, дальше всё пропорционально
    const asc = probe.actualBoundingBoxAscent;
    const desc = probe.actualBoundingBoxDescent;
    const left = probe.actualBoundingBoxLeft;
    const right = probe.actualBoundingBoxRight;
    const pad = (OUTLINE / 2) * 100;
    const halfW = ((left + right) / 2 + pad) * stretch;
    const halfH = (asc + desc) / 2 + pad;
    const fontSize = Math.min(100 * (0.92 * reach) / Math.hypot(halfW, halfH), (100 * GLYPH_MAX_HEIGHT) / (asc + desc));
    g.font = GLYPH_FONT.replace('100px', `${fontSize}px`);
    const k = fontSize / 100;
    const dx = -((right - left) / 2) * k;
    const dy = ((asc - desc) / 2) * k;
    g.lineWidth = fontSize * OUTLINE;
    g.strokeStyle = GLYPH_OUTLINE;
    g.strokeText(patch.glyph, dx, dy);
    g.fillStyle = GLYPH_FILL;
    g.fillText(patch.glyph, dx, dy);

    const src = g.getImageData(0, 0, size, size).data;
    const half = size / 2;
    for (let j = 0; j < size; j++) {
      const ty = Math.round(cy - half + j);
      if (ty < 0 || ty >= height) continue;
      for (let i = 0; i < size; i++) {
        const a = src[(j * size + i) * 4 + 3];
        if (!a) continue;
        const tx = (((Math.round(cx - half + i)) % width) + width) % width; // круговой шов
        const idx = ty * width + tx;
        if (regionMap[idx] !== patch.index) continue; // не выходим за границу своего участка
        const o = idx * 4;
        const k = a / 255;
        const s = (j * size + i) * 4;
        image.data[o] = src[s] * k + image.data[o] * (1 - k);
        image.data[o + 1] = src[s + 1] * k + image.data[o + 1] * (1 - k);
        image.data[o + 2] = src[s + 2] * k + image.data[o + 2] * (1 - k);
      }
    }
  }
}

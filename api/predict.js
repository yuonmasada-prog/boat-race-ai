const VENUES = {
  '01':'桐生','02':'戸田','03':'江戸川','04':'平和島','05':'多摩川','06':'浜名湖',
  '07':'蒲郡','08':'常滑','09':'津','10':'三国','11':'びわこ','12':'住之江',
  '13':'尼崎','14':'鳴門','15':'丸亀','16':'児島','17':'宮島','18':'徳山',
  '19':'下関','20':'若松','21':'芦屋','22':'福岡','23':'唐津','24':'大村'
};

const ORDER = [
  123,213,312,412,512,612,124,214,314,413,513,613,125,215,315,415,514,614,
  126,216,316,416,516,615,132,231,321,421,521,621,134,234,324,423,523,623,
  135,235,325,425,524,624,136,236,326,426,526,625,142,241,341,431,531,631,
  143,243,342,432,532,632,145,245,345,435,534,634,146,246,346,436,536,635,
  152,251,351,451,541,641,153,253,352,452,542,642,154,254,354,453,543,643,
  156,256,356,456,546,645,162,261,361,461,561,651,163,263,362,462,562,652,
  164,264,364,463,563,653,165,265,365,465,564,654
];

const COURSE_PRIOR = {
  1:0.56,
  2:0.14,
  3:0.12,
  4:0.10,
  5:0.05,
  6:0.03
};

const strip = s =>
  String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/\s+/g,' ')
    .trim();

async function fetchText(url) {
  const response = await fetch(url, {
    cache: 'no-store'
  });

  const html = await response.text();

  if (!response.ok) {
    throw new Error(
      `公式ページ取得失敗 HTTP ${response.status}`
    );
  }

  return html;
}

function parseOdds(html) {
  const values = [];

  const re =
    /<td[^>]*class=["'][^"']*\boddsPoint\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi;

  let match;

  while ((match = re.exec(html))) {
    const n = Number(
      strip(match[1]).replace(/,/g,'')
    );

    values.push(
      Number.isFinite(n) && n >= 1
        ? n
        : null
    );
  }

  const odds = {};

  for (
    let i = 0;
    i < Math.min(values.length,120);
    i++
  ) {
    if (values[i] == null) continue;

    const k = String(ORDER[i]);

    odds[
      `${k[0]}-${k[1]}-${k[2]}`
    ] = values[i];
  }

  return odds;
}

function parseBeforeInfo(html) {
  const text = strip(html);

  const boats = {};

  for (let lane=1; lane<=6; lane++) {
    boats[lane] = {
      lane,
      exTime:null,
      exSt:null,
      flying:false
    };
  }

  const times =
    [...text.matchAll(/\b6\.(\d{2})\b/g)]
      .map(m => Number(`6.${m[1]}`))
      .filter(x => x >= 6.3 && x <= 7.2);

  if (times.length >= 6) {
    const latest = times.slice(-6);

    for (let i=0; i<6; i++) {
      boats[i+1].exTime = latest[i];
    }
  }

  const stTokens =
    [...text.matchAll(
      /(?:^|\s)(F)?\.?([0-9]{2})(?=\s|$)/g
    )].map(m => ({
      flying: !!m[1],
      value: Number(`0.${m[2]}`)
    }));

  if (stTokens.length >= 6) {
    const latest = stTokens.slice(-6);

    for (let i=0; i<6; i++) {
      boats[i+1].exSt = latest[i].value;
      boats[i+1].flying =
        latest[i].flying;
    }
  }

  const wind =
    (text.match(
      /風速\s*([0-9.]+)\s*m/
    ) || [])[1];

  const wave =
    (text.match(
      /波高\s*([0-9.]+)\s*cm/
    ) || [])[1];

  const air =
    (text.match(
      /気温\s*([0-9.]+)\s*℃/
    ) || [])[1];

  const water =
    (text.match(
      /水温\s*([0-9.]+)\s*℃/
    ) || [])[1];

  return {
    boats,
    weather:{
      wind: wind ? Number(wind) : null,
      wave: wave ? Number(wave) : null,
      air: air ? Number(air) : null,
      water: water ? Number(water) : null
    }
  };
}

function parseRaceList(html) {
  const text = strip(html);

  const boats = {};

  for (let lane=1; lane<=6; lane++) {
    boats[lane] = {
      lane,
      grade:null
    };
  }

  const grades =
    [...text.matchAll(
      /\b(A1|A2|B1|B2)\b/g
    )].map(m => m[1]);

  if (grades.length >= 6) {
    for (let i=0; i<6; i++) {
      boats[i+1].grade =
        grades[i];
    }
  }

  return { boats };
}

function laneStrength(
  lane,
  racer,
  before
) {
  let score =
    Math.log(
      COURSE_PRIOR[lane]
    );

  const gradeBonus = {
    A1:0.50,
    A2:0.24,
    B1:0.02,
    B2:-0.18
  };

  score +=
    gradeBonus[racer?.grade] || 0;

  if (before?.exTime) {
    score +=
      (6.85 - before.exTime)
      * 1.8;
  }

  if (before?.exSt != null) {
    score +=
      (0.16 - before.exSt)
      * 1.4;

    if (before.flying) {
      score += 0.03;
    }
  }

  return score;
}

function trifectaProb(
  combo,
  strengths
) {
  const [a,b,c] =
    combo.split('-').map(Number);

  const weight = {};

  for (let i=1; i<=6; i++) {
    weight[i] =
      Math.exp(strengths[i]);
  }

  const sum1 =
    Object.values(weight)
      .reduce(
        (a,b) => a+b,
        0
      );

  const p1 =
    weight[a] / sum1;

  const sum2 =
    sum1 - weight[a];

  const p2 =
    weight[b] / sum2;

  const sum3 =
    sum2 - weight[b];

  const p3 =
    weight[c] / sum3;

  return p1 * p2 * p3;
}

function chooseBets(
  odds,
  strengths,
  budget
) {
  const units =
    Math.floor(
      Math.max(0,budget) / 100
    );

  if (units < 1) return [];

  const rows =
    Object.entries(odds)
      .map(([combo,odd]) => {
        const p =
          trifectaProb(
            combo,
            strengths
          );

        return {
          combo,
          odds:odd,
          p,
          ev:p * odd
        };
      })
      .filter(x =>
        Number.isFinite(x.odds) &&
        x.odds >= 1
      );

  rows.sort(
    (a,b) =>
      (b.ev - a.ev) ||
      (b.p - a.p)
  );

  let candidates =
    rows
      .filter(x =>
        x.ev >= 0.85 &&
        x.p >= 0.012
      )
      .slice(
        0,
        Math.min(3,units)
      );

  if (!candidates.length) {
    candidates =
      [...rows]
        .sort(
          (a,b) => b.p - a.p
        )
        .slice(
          0,
          Math.min(2,units)
        );
  }

  // 200円など少額の場合は
  // 大穴より的中確率を優先
  if (units <= 2) {
    candidates =
      [...rows]
        .sort(
          (a,b) => b.p - a.p
        )
        .slice(0,units);
  }

  const picks = [];

  let left = units;

  for (
    let i=0;
    i<candidates.length;
    i++
  ) {
    const remaining =
      candidates.length - i;

    const allocation =
      i === 0
        ? Math.max(
            1,
            left - (remaining - 1)
          )
        : 1;

    const use =
      Math.min(
        allocation,
        left - (remaining - 1)
      );

    picks.push({
      ...candidates[i],
      amount:use * 100
    });

    left -= use;
  }

  return picks;
}

module.exports =
async function handler(
  req,
  res
) {
  try {

    const date =
      String(
        req.query.date || ''
      ).replace(/[-/]/g,'');

    const venue =
      String(
        req.query.venue || ''
      ).padStart(2,'0');

    const race =
      Number(
        req.query.race || 1
      );

    const budget =
      Number(
        req.query.budget || 1000
      );

    if (
      !/^\d{8}$/.test(date) ||
      !VENUES[venue] ||
      !Number.isInteger(race) ||
      race < 1 ||
      race > 12 ||
      !Number.isFinite(budget) ||
      budget < 100
    ) {
      return res
        .status(400)
        .json({
          error:
            '入力値が不正です'
        });
    }

    const base =
      'https://www.boatrace.jp/owpc/pc/race';

    const q =
      `?rno=${race}` +
      `&jcd=${venue}` +
      `&hd=${date}`;

    const [
      oddsHtml,
      raceHtml,
      beforeHtml
    ] =
      await Promise.all([
        fetchText(
          `${base}/odds3t${q}`
        ),
        fetchText(
          `${base}/racelist${q}`
        ),
        fetchText(
          `${base}/beforeinfo${q}`
        )
      ]);

    const odds =
      parseOdds(oddsHtml);

    const oddsCount =
      Object.keys(odds).length;

    if (oddsCount < 100) {
      return res
        .status(200)
        .json({
          skip:true,
          venueName:
            VENUES[venue],
          race,
          oddsCount,
          picks:[],
          reason:
            `公式3連単オッズを${oddsCount}通りしか取得できないため見送り。`
        });
    }

    const raceInfo =
      parseRaceList(raceHtml);

    const before =
      parseBeforeInfo(
        beforeHtml
      );

    const strengths = {};

    for (
      let lane=1;
      lane<=6;
      lane++
    ) {
      strengths[lane] =
        laneStrength(
          lane,
          raceInfo.boats[lane],
          before.boats[lane]
        );
    }

    const picks =
      chooseBets(
        odds,
        strengths,
        budget
      );

    const maxProb =
      picks.length
        ? Math.max(
            ...picks.map(
              x => x.p
            )
          )
        : 0;

    const skip =
      !picks.length ||
      (
        maxProb < 0.02 &&
        budget <= 500
      );

    const outputPicks =
      skip
        ? []
        : picks.map(x => ({
            combo:x.combo,
            amount:x.amount,
            odds:x.odds,
            ev:x.ev,
            prob:x.p
          }));

    const exSummary =
      Object.values(
        before.boats
      )
        .filter(
          x =>
            x.exTime ||
            x.exSt != null
        )
        .map(
          x =>
            `${x.lane}号艇 ` +
            `展示${x.exTime ?? '-'} ` +
            `ST${x.flying ? 'F' : ''}` +
            `${x.exSt != null
              ? x.exSt.toFixed(2)
              : '-'}`
        )
        .join(' / ');

    const reason =
      skip
        ? '少額資金で無理に買う優位性が弱いため見送り。'
        :
          'コース基礎率・級別・展示情報・3連単オッズを統合した暫定ヒューリスティック。' +
          (
            exSummary
              ? ` ${exSummary}`
              : ''
          );

    return res
      .status(200)
      .json({
        skip,
        venueName:
          VENUES[venue],
        race,
        oddsCount,
        picks:
          outputPicks,
        reason,
        meta:{
          model:
            'heuristic-v2',
          weather:
            before.weather,
          gradeDetected:
            Object.values(
              raceInfo.boats
            ).map(
              x => x.grade
            )
        }
      });

  } catch (error) {

    return res
      .status(500)
      .json({
        error:
          error.message ||
          String(error)
      });

  }
};

const V = {
  '01':'桐生','02':'戸田','03':'江戸川','04':'平和島','05':'多摩川','06':'浜名湖',
  '07':'蒲郡','08':'常滑','09':'津','10':'三国','11':'びわこ','12':'住之江',
  '13':'尼崎','14':'鳴門','15':'丸亀','16':'児島','17':'宮島','18':'徳山',
  '19':'下関','20':'若松','21':'芦屋','22':'福岡','23':'唐津','24':'大村'
};

const ORDER = [
  123,213,312,412,512,612,
  124,214,314,413,513,613,
  125,215,315,415,514,614,
  126,216,316,416,516,615,
  132,231,321,421,521,621,
  134,234,324,423,523,623,
  135,235,325,425,524,624,
  136,236,326,426,526,625,
  142,241,341,431,531,631,
  143,243,342,432,532,632,
  145,245,345,435,534,634,
  146,246,346,436,536,635,
  152,251,351,451,541,641,
  153,253,352,452,542,642,
  154,254,354,453,543,643,
  156,256,356,456,546,645,
  162,261,361,461,561,651,
  163,263,362,462,562,652,
  164,264,364,463,563,653,
  165,265,365,465,564,654
];

const strip = s => String(s || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

function parseOdds(html) {
  const vals = [];
  const re = /<td[^>]*class=["'][^"']*\boddsPoint\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi;

  let m;

  while ((m = re.exec(html))) {
    const s = strip(m[1]).replace(/,/g, '');
    const n = Number(s);

    vals.push(Number.isFinite(n) && n >= 1 ? n : null);
  }

  const out = {};

  if (vals.length >= 120) {
    for (let i = 0; i < 120; i++) {
      if (vals[i] != null) {
        const k = String(ORDER[i]);
        out[`${k[0]}-${k[1]}-${k[2]}`] = vals[i];
      }
    }
  }

  return {
    cellCount: vals.length,
    odds: out
  };
}

async function fetchOfficial(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
      },
      cache: 'no-store',
      signal: controller.signal
    });

    const html = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type'),
      length: html.length,
      html
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  try {
    const date = String(req.query.date || '').replace(/-/g, '');
    const venue = String(req.query.venue || '04').padStart(2, '0');
    const race = Number(req.query.race || 1);

    if (!/^\d{8}$/.test(date) || !V[venue] || race < 1 || race > 12) {
      return res.status(400).json({
        error: '入力値が不正です'
      });
    }

    const url =
      `https://www.boatrace.jp/owpc/pc/race/odds3t` +
      `?rno=${race}&jcd=${venue}&hd=${date}`;

    const result = await fetchOfficial(url);
    const parsed = parseOdds(result.html);

    return res.status(200).json({
      diagnostic: true,
      venueName: V[venue],
      race,
      officialUrl: url,

      fetch: {
        ok: result.ok,
        status: result.status,
        contentType: result.contentType,
        htmlLength: result.length
      },

      parse: {
        oddsPointCells: parsed.cellCount,
        parsedOdds: Object.keys(parsed.odds).length,
        sample: Object.entries(parsed.odds).slice(0, 5)
      },

      htmlPreview: strip(result.html).slice(0, 500)
    });

  } catch (e) {
    return res.status(500).json({
      diagnostic: true,
      error: e.name,
      message: e.message
    });
  }
};

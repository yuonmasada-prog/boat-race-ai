const https = require("node:https");
const dns = require("node:dns");
const core = require('../lib/boat-race-core');

const BASE =
  "https://boatracecsv.github.io/data";

const VENUES = {
  "01": "桐生",
  "02": "戸田",
  "03": "江戸川",
  "04": "平和島",
  "05": "多摩川",
  "06": "浜名湖",
  "07": "蒲郡",
  "08": "常滑",
  "09": "津",
  "10": "三国",
  "11": "びわこ",
  "12": "住之江",
  "13": "尼崎",
  "14": "鳴門",
  "15": "丸亀",
  "16": "児島",
  "17": "宮島",
  "18": "徳山",
  "19": "下関",
  "20": "若松",
  "21": "芦屋",
  "22": "福岡",
  "23": "唐津",
  "24": "大村"
};


function lookupIPv4(
  hostname,
  options,
  callback
) {
  dns.lookup(
    hostname,
    {
      family: 4,
      all: false
    },
    callback
  );
}


function fetchText(
  url,
  timeoutMs = 18000
) {
  return new Promise(
    (resolve, reject) => {

      const target =
        new URL(url);

      let settled = false;


      function fail(error) {
        if (settled) {
          return;
        }

        settled = true;
        reject(error);
      }


      const req =
        https.request(
          {
            protocol: "https:",

            hostname:
              target.hostname,

            port: 443,

            path:
              target.pathname +
              target.search,

            method: "GET",

            family: 4,

            lookup:
              lookupIPv4,

            servername:
              target.hostname,

            agent: false,

            headers: {
              "User-Agent":
                "boat-race-ai-v8.3-entry-scanner",

              "Accept":
                "text/csv,text/plain,*/*",

              "Accept-Encoding":
                "identity",

              "Cache-Control":
                "no-cache",

              "Connection":
                "close"
            }
          },

          response => {

            const chunks = [];

            response.on(
              "data",
              chunk => {
                chunks.push(
                  chunk
                );
              }
            );

            response.on(
              "end",
              () => {

                if (settled) {
                  return;
                }

                settled = true;

                const body =
                  Buffer.concat(
                    chunks
                  ).toString(
                    "utf8"
                  );

                if (
                  response.statusCode <
                    200 ||
                  response.statusCode >=
                    300
                ) {

                  const error =
                    new Error(
                      `HTTP ${response.statusCode}`
                    );

                  error.statusCode =
                    response.statusCode;

                  reject(error);

                  return;
                }

                resolve(body);
              }
            );
          }
        );


      req.setTimeout(
        timeoutMs,
        () => {

          req.destroy(
            new Error(
              "request-timeout"
            )
          );

        }
      );


      req.on(
        "error",
        fail
      );


      req.end();
    }
  );
}


function parseCsvLine(line) {

  const output = [];

  let current = "";
  let quoted = false;


  for (
    let i = 0;
    i < line.length;
    i++
  ) {

    const char =
      line[i];


    if (char === '"') {

      if (
        quoted &&
        line[i + 1] === '"'
      ) {

        current += '"';
        i++;

      } else {

        quoted =
          !quoted;

      }

      continue;
    }


    if (
      char === "," &&
      !quoted
    ) {

      output.push(
        current
      );

      current = "";

      continue;
    }


    current += char;
  }


  output.push(
    current
  );


  return output;
}


function parseCsv(text) {

  const normalized =
    String(
      text || ""
    )
      .replace(
        /^\uFEFF/,
        ""
      )
      .trim();


  if (!normalized) {
    return [];
  }


  const lines =
    normalized.split(
      /\r?\n/
    );


  const headers =
    parseCsvLine(
      lines[0]
    );


  return lines
    .slice(1)
    .filter(
      line =>
        line.trim()
    )
    .map(
      line => {

        const values =
          parseCsvLine(
            line
          );

        const row = {};


        headers.forEach(
          (
            header,
            index
          ) => {

            row[header] =
              values[index] ??
              "";

          }
        );


        return row;
      }
    );
}


function number(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }


  const normalized =
    String(value)
      .replace(
        /,/g,
        ""
      )
      .replace(
        /%/g,
        ""
      )
      .trim();


  if (!normalized) {
    return null;
  }


  const n =
    Number(
      normalized
    );


  return Number.isFinite(n)
    ? n
    : null;
}


function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );
}


function parseRaceCode(
  value
) {

  const code =
    String(
      value || ""
    )
      .replace(
        /\D/g,
        ""
      );


  if (
    code.length !== 12
  ) {
    return null;
  }


  return {
    code,

    date:
      `${code.slice(0, 4)}-` +
      `${code.slice(4, 6)}-` +
      `${code.slice(6, 8)}`,

    venue:
      code.slice(
        8,
        10
      ),

    race:
      Number(
        code.slice(
          10,
          12
        )
      )
  };
}


function normalizeVenue(
  value
) {

  const digits =
    String(
      value || ""
    )
      .replace(
        /\D/g,
        ""
      );


  if (!digits) {
    return null;
  }


  return digits.padStart(
    2,
    "0"
  );
}


function normalizeRace(
  value
) {

  const n =
    Number(value);


  if (
    !Number.isFinite(n) ||
    n < 1 ||
    n > 12
  ) {
    return null;
  }


  return Math.round(n);
}


function dateParts(
  date
) {

  const match =
    String(
      date || ""
    )
      .match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );


  if (!match) {
    return null;
  }


  return {
    yyyy:
      match[1],

    mm:
      match[2],

    dd:
      match[3]
  };
}


function todayJst() {

  return new Intl
    .DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Tokyo",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit"
      }
    )
    .format(
      new Date()
    );
}


function currentJstMinutes() {

  const formatter =
    new Intl
      .DateTimeFormat(
        "ja-JP",
        {
          timeZone:
            "Asia/Tokyo",

          hour:
            "2-digit",

          minute:
            "2-digit",

          hour12:
            false
        }
      );


  const parts =
    formatter
      .formatToParts(
        new Date()
      );


  const map = {};


  parts.forEach(
    part => {

      map[
        part.type
      ] =
        part.value;

    }
  );


  return (
    Number(
      map.hour
    ) *
      60 +
    Number(
      map.minute
    )
  );
}


function timeMinutes(
  value
) {

  const match =
    String(
      value || ""
    )
      .match(
        /(\d{1,2}):(\d{2})/
      );


  if (!match) {
    return null;
  }


  return (
    Number(
      match[1]
    ) *
      60 +
    Number(
      match[2]
    )
  );
}


function findColumn(
  row,
  candidates
) {

  for (
    const key
    of candidates
  ) {

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          row,
          key
        )
    ) {

      return row[key];

    }

  }


  return null;
}


function laneData(
  row,
  lane
) {

  const prefix =
    `艇${lane}_`;


  const name =
    findColumn(
      row,
      [
        `${prefix}選手名`
      ]
    ) || "";


  const grade =
    findColumn(
      row,
      [
        `${prefix}級別`
      ]
    ) || "";


  const avgSt =
    number(
      findColumn(
        row,
        [
          `${prefix}全国平均ST`,
          `${prefix}平均ST`
        ]
      )
    );


  const nationalWin =
    number(
      findColumn(
        row,
        [
          `${prefix}全国勝率`
        ]
      )
    );


  const national2 =
    number(
      findColumn(
        row,
        [
          `${prefix}全国2連対率`,
          `${prefix}全国２連対率`
        ]
      )
    );


  const localWin =
    number(
      findColumn(
        row,
        [
          `${prefix}当地勝率`
        ]
      )
    );


  const local2 =
    number(
      findColumn(
        row,
        [
          `${prefix}当地2連対率`,
          `${prefix}当地２連対率`
        ]
      )
    );


  const motor2 =
    number(
      findColumn(
        row,
        [
          `${prefix}モーター2連対率`,
          `${prefix}モーター２連対率`
        ]
      )
    );


  const boat2 =
    number(
      findColumn(
        row,
        [
          `${prefix}ボート2連対率`,
          `${prefix}ボート２連対率`
        ]
      )
    );


  const fCount =
    number(
      findColumn(
        row,
        [
          `${prefix}F本数`
        ]
      )
    ) ?? 0;


  return {
    lane,
    name,
    grade,
    avgSt,
    nationalWin,
    national2,
    localWin,
    local2,
    motor2,
    boat2,
    fCount
  };
}


function gradeBonus(
  grade
) {

  switch (
    String(
      grade || ""
    ).toUpperCase()
  ) {

    case "A1":
      return 1.0;

    case "A2":
      return 0.45;

    case "B1":
      return 0;

    case "B2":
      return -0.35;

    default:
      return 0;
  }
}


function laneAdvantage(
  lane
) {

  const table = {
    1: 1.55,
    2: 0.55,
    3: 0.25,
    4: 0.05,
    5: -0.20,
    6: -0.35
  };


  return table[
    lane
  ] ?? 0;
}


function racerStrength(
  racer
) {

  let score = 0;


  if (
    racer.nationalWin !== null
  ) {

    score +=
      racer.nationalWin *
      1.15;

  }


  if (
    racer.localWin !== null
  ) {

    score +=
      racer.localWin *
      0.50;

  }


  if (
    racer.national2 !== null
  ) {

    score +=
      racer.national2 *
      0.025;

  }


  if (
    racer.local2 !== null
  ) {

    score +=
      racer.local2 *
      0.012;

  }


  if (
    racer.avgSt !== null
  ) {

    score +=
      clamp(
        0.23 -
          racer.avgSt,
        -0.05,
        0.13
      ) *
      13;

  }


  if (
    racer.motor2 !== null
  ) {

    score +=
      (
        racer.motor2 -
        30
      ) *
      0.035;

  }


  if (
    racer.boat2 !== null
  ) {

    score +=
      (
        racer.boat2 -
        30
      ) *
      0.018;

  }


  score +=
    gradeBonus(
      racer.grade
    );


  score +=
    laneAdvantage(
      racer.lane
    );


  score -=
    Math.min(
      racer.fCount *
        0.45,
      0.9
    );


  return score;
}


function oddsStats(
  row
) {

  const odds = [];

  const map = {};


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      row || {}
    )
  ) {

    const match =
      key.match(
        /^3連単_([1-6])-([1-6])-([1-6])$/
      );


    if (!match) {
      continue;
    }


    const odd =
      number(
        value
      );


    if (
      odd === null ||
      odd <= 0
    ) {
      continue;
    }


    const combo =
      `${match[1]}-${match[2]}-${match[3]}`;


    map[
      combo
    ] =
      odd;


    odds.push(
      {
        combo,
        odd
      }
    );
  }


  odds.sort(
    (
      a,
      b
    ) =>
      a.odd -
      b.odd
  );


  const values =
    odds.map(
      item =>
        item.odd
    );


  const valid =
    values.length;


  const favorite =
    odds[0] ||
    null;


  const second =
    odds[1] ||
    null;


  const median =
    valid
      ? values[
          Math.floor(
            valid / 2
          )
        ]
      : null;


  return {
    valid,

    favoriteCombo:
      favorite?.combo ||
      null,

    favoriteOdds:
      favorite?.odd ??
      null,

    secondFavoriteOdds:
      second?.odd ??
      null,

    medianOdds:
      median,

    minOdds:
      favorite?.odd ??
      null,

    maxOdds:
      valid
        ? values[
            values.length - 1
          ]
        : null,

    map
  };
}


function marketQuality(
  stats
) {

  const oddsQuality =
    core.validateTrifectaOdds(
      stats.map,
      { rawCount: stats.valid }
    );


  if (!oddsQuality.usable) {
    return {
      pass: false,
      score: 0,
      reason:
        "3連単オッズ品質不足",
      oddsQuality
    };
  }


  const favorite =
    stats.favoriteOdds;


  if (
    favorite === null
  ) {
    return {
      pass: false,
      score: 0,
      reason:
        "人気オッズ取得失敗",
      oddsQuality
    };
  }


  /*
    低すぎるオッズ =
    リターンが小さすぎる可能性。

    高すぎるオッズ =
    市場が拮抗しすぎて
    予測難度が高い可能性。
  */

  if (
    favorite <
    3.0
  ) {
    return {
      pass: false,
      score: 0,
      reason:
        "人気集中が強すぎる",
      oddsQuality
    };
  }


  if (
    favorite >
    22
  ) {
    return {
      pass: false,
      score: 0,
      reason:
        "市場が拮抗しすぎ",
      oddsQuality
    };
  }


  let score = 0;


  /*
    4.5〜12倍程度を
    スクリーニング上は
    扱いやすい領域とする。
  */

  if (
    favorite >= 4.5 &&
    favorite <= 12
  ) {

    score += 10;

  } else if (
    favorite >= 3.5 &&
    favorite <= 16
  ) {

    score += 7;

  } else {

    score += 4;

  }


  if (
    stats.secondFavoriteOdds !==
      null
  ) {

    const spread =
      stats.secondFavoriteOdds -
      favorite;


    if (
      spread >= 1.0
    ) {
      score += 2;
    }

  }


  return {
    pass: true,
    score,
    reason: null,
    oddsQuality
  };
}


function raceStrength(
  row,
  oddsRow
) {

  const racers = [];


  for (
    let lane = 1;
    lane <= 6;
    lane++
  ) {

    racers.push(
      laneData(
        row,
        lane
      )
    );

  }


  const complete =
    racers.filter(
      racer =>
        racer.name &&
        racer.nationalWin !==
          null
    ).length;


  if (
    complete < 6
  ) {

    return {
      pass: false,
      reason:
        "選手データ不足"
    };

  }


  const ranked =
    racers
      .map(
        racer => ({
          ...racer,

          strength:
            racerStrength(
              racer
            )
        })
      )
      .sort(
        (
          a,
          b
        ) =>
          b.strength -
          a.strength
      );


  const top =
    ranked[0];

  const second =
    ranked[1];

  const third =
    ranked[2];


  const gap =
    top.strength -
    second.strength;


  const top3Gap =
    top.strength -
    third.strength;


  const odds =
    oddsStats(
      oddsRow
    );


  const market =
    marketQuality(
      odds
    );


  if (
    !market.pass
  ) {

    return {
      pass: false,
      reason:
        market.reason
    };

  }


  /*
    レースの「読みやすさ」を評価。

    gapが小さい =
    上位艇の能力差が小さく、
    この段階では見送りやすい。
  */

  const clarityScore =
    clamp(
      gap *
        8 +
      top3Gap *
        3,
      0,
      35
    );


  const topStrengthScore =
    clamp(
      (
        top.strength -
        6
      ) *
        4,
      0,
      25
    );


  let stScore = 0;


  if (
    top.avgSt !== null
  ) {

    stScore =
      clamp(
        (
          0.20 -
          top.avgSt
        ) *
          100,
        0,
        8
      );

  }


  let laneScore = 0;


  if (
    top.lane === 1
  ) {
    laneScore = 10;
  } else if (
    top.lane === 2
  ) {
    laneScore = 6;
  } else if (
    top.lane === 3
  ) {
    laneScore = 4;
  } else {
    laneScore = 2;
  }


  let motorScore = 0;


  if (
    top.motor2 !== null
  ) {

    motorScore =
      clamp(
        (
          top.motor2 -
          30
        ) *
          0.25,
        0,
        7
      );

  }


  const rawScore =
    clarityScore +
    topStrengthScore +
    stScore +
    laneScore +
    motorScore +
    market.score;


  const score =
    clamp(
      rawScore,
      0,
      100
    );


  /*
    スキャナー通過基準。

    ここは最終買い目判断ではない。
    この後 index.html の
    本MLで正式分析する。
  */

  if (
    score < 50
  ) {

    return {
      pass: false,
      reason:
        "事前評価が基準未満",
      score
    };

  }


  if (
    gap < 0.40
  ) {

    return {
      pass: false,
      reason:
        "上位艇の能力差が小さい",
      score
    };

  }


  let grade =
    "B";


  if (
    score >= 72
  ) {
    grade = "A";
  } else if (
    score >= 62
  ) {
    grade = "B+";
  }


  return {
    pass: true,

    score:
      Number(
        score.toFixed(1)
      ),

    grade,

    topLane:
      top.lane,

    topRacer:
      top,

    secondLane:
      second.lane,

    gap:
      Number(
        gap.toFixed(2)
      ),

    racers:
      ranked,

    odds,

    oddsQuality:
      market.oddsQuality
  };
}


module.exports =
  async function handler(
    req,
    res
  ) {

    res.setHeader(
      "Cache-Control",
      "no-store"
    );


    const requestedDate =
      String(
        req.query?.date ||
        todayJst()
      );


    const parts =
      dateParts(
        requestedDate
      );


    if (!parts) {

      return res
        .status(400)
        .json({
          ok: false,
          error:
            "invalid-date"
        });

    }


    const limit =
      Math.min(
        10,
        Math.max(
          1,
          Number(
            req.query?.limit ||
            5
          )
        )
      );


    const minLeadMinutes =
      Math.max(
        3,
        Number(
          req.query
            ?.minLeadMinutes ||
          5
        )
      );


    const maxLeadMinutes =
      Math.min(
        180,
        Math.max(
          20,
          Number(
            req.query
              ?.maxLeadMinutes ||
            90
          )
        )
      );


    const excludeVenue =
      normalizeVenue(
        req.query
          ?.excludeVenue
      );


    const excludeRace =
      normalizeRace(
        req.query
          ?.excludeRace
      );


    const basePath =
      `${parts.yyyy}/` +
      `${parts.mm}/` +
      `${parts.dd}.csv`;


    const cardsUrl =
      `${BASE}/programs/` +
      `race_cards/` +
      basePath;


    const oddsUrl =
      `${BASE}/previews/` +
      `od3/` +
      basePath;


    const [
      cardsResult,
      oddsResult
    ] =
      await Promise
        .allSettled(
          [
            core.withRetry(
              ()=>fetchText(
                cardsUrl,
                8000
              ),
              { attempts:2, retryDelayMs:100 }
            ),

            core.withRetry(
              ()=>fetchText(
                oddsUrl,
                8000
              ),
              { attempts:2, retryDelayMs:100 }
            )
          ]
        );


    if (
      cardsResult.status !==
      "fulfilled"
    ) {

      return res
        .status(502)
        .json({
          ok: false,

          error:
            "race-cards-unavailable"
        });

    }


    if (
      oddsResult.status !==
      "fulfilled"
    ) {

      return res
        .status(502)
        .json({
          ok: false,

          error:
            "odds-unavailable"
        });

    }


    const cards =
      parseCsv(
        cardsResult.value
      );


    const oddsRows =
      parseCsv(
        oddsResult.value
      );


    const oddsByCode =
      new Map();


    oddsRows.forEach(
      row => {

        const parsed =
          parseRaceCode(
            row[
              "レースコード"
            ]
          );


        if (!parsed) {
          return;
        }


        oddsByCode.set(
          parsed.code,
          row
        );

      }
    );


    const isToday =
      requestedDate ===
      todayJst();


    const nowMinutes =
      currentJstMinutes();


    const candidates = [];

    const rejected = {
      closed: 0,
      tooSoon: 0,
      tooFar: 0,
      noOdds: 0,
      weak: 0,
      excluded: 0
    };


    for (
      const row
      of cards
    ) {

      const parsed =
        parseRaceCode(
          row[
            "レースコード"
          ]
        );


      if (!parsed) {
        continue;
      }


      if (
        parsed.date !==
        requestedDate
      ) {
        continue;
      }


      if (
        excludeVenue &&
        excludeRace &&
        parsed.venue ===
          excludeVenue &&
        parsed.race ===
          excludeRace
      ) {

        rejected.excluded++;
        continue;
      }


      const oddsRow =
        oddsByCode.get(
          parsed.code
        );


      /*
        「今エントリー可能」
        を優先するため
        オッズ未公開レースは
        最終候補にしない。
      */

      if (!oddsRow) {

        rejected.noOdds++;
        continue;

      }


      const cutoff =
        oddsRow[
          "締切時刻"
        ] ||
        row[
          "締切時刻"
        ] ||
        null;


      const cutoffMinutes =
        timeMinutes(
          cutoff
        );


      let minutesToClose =
        null;


      if (
        isToday
      ) {

        if (
          cutoffMinutes ===
          null
        ) {

          rejected.noOdds++;
          continue;

        }


        minutesToClose =
          cutoffMinutes -
          nowMinutes;


        if (
          minutesToClose <= 0
        ) {

          rejected.closed++;
          continue;

        }


        if (
          minutesToClose <
          minLeadMinutes
        ) {

          rejected.tooSoon++;
          continue;

        }


        if (
          minutesToClose >
          maxLeadMinutes
        ) {

          rejected.tooFar++;
          continue;

        }

      }


      const evaluation =
        raceStrength(
          row,
          oddsRow
        );


      if (
        !evaluation.pass
      ) {

        rejected.weak++;
        continue;

      }


      const top =
        evaluation.topRacer;


      /*
        締切が近いほど
        現在のおすすめとして
        少しだけ優先。

        ただしスコア本体を
        大きく歪めない。
      */

      let timingBonus = 0;


      if (
        minutesToClose !==
        null
      ) {

        if (
          minutesToClose <= 20
        ) {

          timingBonus = 4;

        } else if (
          minutesToClose <= 40
        ) {

          timingBonus = 2.5;

        } else if (
          minutesToClose <= 60
        ) {

          timingBonus = 1;

        }

      }


      const finalScore =
        clamp(
          evaluation.score +
          timingBonus,
          0,
          100
        );


      let recommendation =
        evaluation.grade;


      if (
        finalScore >= 75
      ) {
        recommendation = "A";
      } else if (
        finalScore >= 64
      ) {
        recommendation = "B+";
      } else {
        recommendation = "B";
      }


      candidates.push({
        raceCode:
          parsed.code,

        date:
          parsed.date,

        venue:
          parsed.venue,

        venueName:
          VENUES[
            parsed.venue
          ] ||
          parsed.venue,

        race:
          parsed.race,

        cutoff,

        minutesToClose,

        score:
          Number(
            finalScore
              .toFixed(1)
          ),

        recommendation,

        topLane:
          evaluation.topLane,

        secondLane:
          evaluation.secondLane,

        strengthGap:
          evaluation.gap,

        lane1: {
          name:
            laneData(
              row,
              1
            ).name,

          nationalWin:
            laneData(
              row,
              1
            ).nationalWin,

          localWin:
            laneData(
              row,
              1
            ).localWin
        },

        topRacer: {
          lane:
            top.lane,

          name:
            top.name,

          grade:
            top.grade,

          avgSt:
            top.avgSt,

          nationalWin:
            top.nationalWin,

          localWin:
            top.localWin,

          motor2:
            top.motor2
        },

        oddsAvailable:
          true,

        oddsCount:
          evaluation
            .odds
            .valid,

        dataQuality:
          evaluation
            .oddsQuality,

        favoriteCombo:
          evaluation
            .odds
            .favoriteCombo,

        favoriteOdds:
          evaluation
            .odds
            .favoriteOdds,

        scannerPassed:
          true,

        scannerVersion:
          "v8.4-ev-quality"
      });
    }


    candidates.sort(
      (
        a,
        b
      ) => {

        /*
          基本は評価順。

          同程度なら
          締切が近い方を優先。
        */

        const scoreDiff =
          b.score -
          a.score;


        if (
          Math.abs(
            scoreDiff
          ) >
          1.0
        ) {

          return scoreDiff;

        }


        if (
          a.minutesToClose !==
            null &&
          b.minutesToClose !==
            null
        ) {

          return (
            a.minutesToClose -
            b.minutesToClose
          );

        }


        return 0;
      }
    );


    const selected =
      candidates.slice(
        0,
        limit
      );


    return res
      .status(200)
      .json({
        ok: true,

        version:
          "v8.4-ev-quality",

        evaluationPolicyVersion:
          "ev-quality-v1",

        source:
          'boatracecsv-race-cards+od3',

        fetchedAt:
          new Date().toISOString(),

        dataQuality:{
          score:
            cards.length && oddsRows.length ? 100 : 0,
          status:
            cards.length && oddsRows.length ? 'good' : 'poor',
          raceCardRows:
            cards.length,
          oddsRows:
            oddsRows.length
        },

        warnings:[],

        errors:[],

        date:
          requestedDate,

        generatedAt:
          new Date()
            .toISOString(),

        currentTimeJstMinutes:
          isToday
            ? nowMinutes
            : null,

        conditions: {
          minimumLeadMinutes:
            minLeadMinutes,

          maximumLeadMinutes:
            maxLeadMinutes,

          oddsRequired:
            true,

          minimumScannerScore:
            50
        },

        totalRaceCards:
          cards.length,

        totalOddsRows:
          oddsRows.length,

        qualifiedCount:
          candidates.length,

        returnedCount:
          selected.length,

        candidates:
          selected,

        rejected,

        message:
          selected.length
            ? "entry-candidates-found"
            : "no-entry-candidates"
      });
  };


module.exports._internals = {
  oddsStats,
  marketQuality
};

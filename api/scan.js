const https = require("node:https");
const dns = require("node:dns");

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
  timeoutMs = 15000
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
                "boat-race-ai-v8.2-scan",

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

                  return reject(
                    error
                  );
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

  output.push(current);

  return output;
}


function parseCsv(text) {
  const normalized =
    String(text || "")
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
    .map(line => {
      const values =
        parseCsvLine(
          line
        );

      const row = {};

      headers.forEach(
        (header, index) => {
          row[header] =
            values[index] ??
            "";
        }
      );

      return row;
    });
}


function number(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n =
    Number(
      String(value)
        .replace(
          /,/g,
          ""
        )
    );

  return Number.isFinite(n)
    ? n
    : null;
}


function normalizeVenue(value) {
  const digits =
    String(value || "")
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


function normalizeRace(value) {
  const match =
    String(value || "")
      .match(
        /(\d{1,2})/
      );

  if (!match) {
    return null;
  }

  const race =
    Number(
      match[1]
    );

  if (
    race < 1 ||
    race > 12
  ) {
    return null;
  }

  return race;
}


function parseRaceCode(
  value
) {
  const code =
    String(value || "")
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
      `${code.slice(0,4)}-` +
      `${code.slice(4,6)}-` +
      `${code.slice(6,8)}`,

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


function timeMinutes(
  value
) {
  const match =
    String(value || "")
      .match(
        /(\d{1,2}):(\d{2})/
      );

  if (!match) {
    return null;
  }

  return (
    Number(match[1]) *
      60 +
    Number(match[2])
  );
}


function currentJstMinutes() {
  const formatter =
    new Intl.DateTimeFormat(
      "ja-JP",
      {
        timeZone:
          "Asia/Tokyo",

        hour: "2-digit",
        minute: "2-digit",
        hour12: false
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
      map[part.type] =
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


function strengthFromCard(
  row
) {
  /*
    これは最終予測ではなく
    「詳細分析するレースを絞る」
    ための軽量スコア。

    本番の買い目判定は
    index.html側で既存MLを
    使って再分析する。
  */

  const lane1Win =
    number(
      row[
        "艇1_全国勝率"
      ]
    ) ?? 0;

  const lane1Local =
    number(
      row[
        "艇1_当地勝率"
      ]
    ) ?? 0;

  const lane1St =
    number(
      row[
        "艇1_全国平均ST"
      ]
    );

  const lane1Motor =
    number(
      row[
        "艇1_モーター2連対率"
      ] ??
      row[
        "艇1_モーター２連対率"
      ]
    );

  let score = 0;

  score +=
    lane1Win *
    1.5;

  score +=
    lane1Local *
    0.8;

  if (
    lane1St !== null
  ) {
    score +=
      Math.max(
        0,
        0.25 -
          lane1St
      ) *
      20;
  }

  if (
    lane1Motor !== null
  ) {
    score +=
      lane1Motor /
      20;
  }

  return score;
}


function oddsStats(row) {
  let valid = 0;
  let min = Infinity;
  let max = 0;

  for (
    const [
      key,
      value
    ] of Object.entries(
      row || {}
    )
  ) {
    if (
      !/^3連単_[1-6]-[1-6]-[1-6]$/
        .test(key)
    ) {
      continue;
    }

    const odd =
      number(value);

    if (
      odd === null ||
      odd <= 0
    ) {
      continue;
    }

    valid++;

    min =
      Math.min(
        min,
        odd
      );

    max =
      Math.max(
        max,
        odd
      );
  }

  return {
    valid,
    min:
      Number.isFinite(min)
        ? min
        : null,

    max:
      max || null
  };
}


function dateParts(
  date
) {
  const match =
    String(date || "")
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
        ""
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

    const limit =
      Math.min(
        12,
        Math.max(
          1,
          Number(
            req.query
              ?.limit ||
            6
          )
        )
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
      await Promise.allSettled(
        [
          fetchText(
            cardsUrl
          ),

          fetchText(
            oddsUrl
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

    const cards =
      parseCsv(
        cardsResult.value
      );

    const oddsRows =
      oddsResult.status ===
      "fulfilled"
        ? parseCsv(
            oddsResult.value
          )
        : [];

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

    const nowMinutes =
      currentJstMinutes();

    const today =
      new Intl.DateTimeFormat(
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
      ).format(
        new Date()
      );

    const candidates = [];

    cards.forEach(
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

        if (
          parsed.date !==
          requestedDate
        ) {
          return;
        }

        if (
          excludeVenue &&
          excludeRace &&
          parsed.venue ===
            excludeVenue &&
          parsed.race ===
            excludeRace
        ) {
          return;
        }

        const oddsRow =
          oddsByCode.get(
            parsed.code
          );

        const cutoff =
          oddsRow?.[
            "締切時刻"
          ] ||
          null;

        const cutoffMinutes =
          timeMinutes(
            cutoff
          );

        /*
          当日で締切が分かっていて
          既に締切済みなら除外。
        */
        if (
          requestedDate ===
            today &&
          cutoffMinutes !==
            null &&
          cutoffMinutes <=
            nowMinutes
        ) {
          return;
        }

        const stats =
          oddsStats(
            oddsRow
          );

        const score =
          strengthFromCard(
            row
          );

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

          oddsAvailable:
            stats.valid >=
            100,

          oddsCount:
            stats.valid,

          score,

          lane1: {
            name:
              row[
                "艇1_選手名"
              ] ||
              null,

            grade:
              row[
                "艇1_級別"
              ] ||
              null,

            nationalWin:
              number(
                row[
                  "艇1_全国勝率"
                ]
              ),

            localWin:
              number(
                row[
                  "艇1_当地勝率"
                ]
              ),

            avgSt:
              number(
                row[
                  "艇1_全国平均ST"
                ]
              )
          }
        });
      }
    );

    /*
      直前オッズ有りを優先。
      その中で軽量スコア順。

      オッズ未公開レースも
      下位候補として残す。
    */
    candidates.sort(
      (a, b) => {
        if (
          a.oddsAvailable !==
          b.oddsAvailable
        ) {
          return a
            .oddsAvailable
            ? -1
            : 1;
        }

        return (
          b.score -
          a.score
        );
      }
    );

    return res
      .status(200)
      .json({
        ok: true,

        date:
          requestedDate,

        generatedAt:
          new Date()
            .toISOString(),

        source: {
          raceCards:
            cardsUrl,

          odds:
            oddsUrl,

          oddsSnapshot:
            "approximately 5 minutes before cutoff"
        },

        totalCandidates:
          candidates.length,

        candidates:
          candidates.slice(
            0,
            limit
          )
      });
  };

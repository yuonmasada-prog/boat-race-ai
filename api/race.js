const https = require('node:https');
const dns = require('node:dns');
const core = require('../lib/boat-race-core');

const VENUES = {
  '01':'桐生','02':'戸田','03':'江戸川','04':'平和島',
  '05':'多摩川','06':'浜名湖','07':'蒲郡','08':'常滑',
  '09':'津','10':'三国','11':'びわこ','12':'住之江',
  '13':'尼崎','14':'鳴門','15':'丸亀','16':'児島',
  '17':'宮島','18':'徳山','19':'下関','20':'若松',
  '21':'芦屋','22':'福岡','23':'唐津','24':'大村'
};

function clean(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|li|span|td|tr|a|tbody)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function compact(value) {
  return clean(value).replace(/\s+/g, ' ').trim();
}

function numberFrom(value) {
  if (value == null) return null;

  const match = String(value)
    .replace(/,/g, '')
    .match(/-?\d+(?:\.\d+)?/);

  if (!match) return null;

  const n = Number(match[0]);

  return Number.isFinite(n) ? n : null;
}

function normalizeFullWidth(value) {
  return String(value || '')
    .replace(/[０-９]/g, c =>
      String.fromCharCode(
        c.charCodeAt(0) - 0xFEE0
      )
    );
}

function tagBlocks(html, tag) {
  const blocks = [];

  const regex = new RegExp(
    `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`,
    'gi'
  );

  let match;

  while ((match = regex.exec(html))) {
    blocks.push(match[0]);
  }

  return blocks;
}

function table1Sections(html) {
  const starts = [];

  const regex =
    /<div\b[^>]*class=["'][^"']*\btable1\b[^"']*["'][^>]*>/gi;

  let match;

  while ((match = regex.exec(html))) {
    starts.push(match.index);
  }

  return starts.map((start, index) => {
    const end =
      index + 1 < starts.length
        ? starts[index + 1]
        : html.length;

    return html.slice(start, end);
  });
}

function textLines(html) {
  return clean(html)
    .split(/\n+/)
    .map(v => v.trim())
    .filter(Boolean);
}

function numericLines(html) {
  return textLines(html)
    .map(numberFrom)
    .filter(Number.isFinite);
}

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
  timeoutMs = 22000
) {
  return new Promise(
    (resolve, reject) => {
      const target =
        new URL(url);

      let settled = false;

      const fail = error => {
        if (settled) return;

        settled = true;
        reject(error);
      };

      const req = https.request(
        {
          protocol: 'https:',
          hostname:
            target.hostname,
          port: 443,
          path:
            target.pathname
            + target.search,
          method: 'GET',
          family: 4,
          lookup: lookupIPv4,
          servername:
            target.hostname,
          agent: false,

          headers: {
            'User-Agent':
              'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1',

            'Accept':
              'text/html,text/plain,text/csv,application/xhtml+xml,*/*;q=0.8',

            'Accept-Language':
              'ja-JP,ja;q=0.9',

            'Accept-Encoding':
              'identity',

            'Cache-Control':
              'no-cache',

            'Pragma':
              'no-cache',

            'Connection':
              'close',

            'Referer':
              'https://www.boatrace.jp/'
          }
        },

        response => {
          const chunks = [];

          response.on(
            'data',
            chunk => {
              chunks.push(chunk);
            }
          );

          response.on(
            'end',
            () => {
              if (settled) return;

              settled = true;

              const body =
                Buffer.concat(chunks)
                  .toString('utf8');

              if (
                response.statusCode < 200 ||
                response.statusCode >= 300
              ) {
                const error =
                  new Error(
                    `HTTP ${response.statusCode}`
                  );

                return reject(error);
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
              'request-timeout'
            )
          );
        }
      );

      req.on(
        'error',
        fail
      );

      req.end();
    }
  );
}

function emptyRacer(lane) {
  return {
    lane,

    racerId: null,
    name: null,
    grade: null,

    fCount: null,
    lCount: null,
    avgSt: null,

    nationalWin: null,
    national2: null,
    national3: null,

    localWin: null,
    local2: null,
    local3: null,

    motorNo: null,
    motor2: null,
    motor3: null,

    boatNo: null,
    boat2: null,
    boat3: null,

    currentMeet: []
  };
}

function createRacers() {
  const racers = {};

  for (
    let lane = 1;
    lane <= 6;
    lane++
  ) {
    racers[lane] =
      emptyRacer(lane);
  }

  return racers;
}

function parseIdentity(
  cell,
  racer
) {
  const text =
    compact(cell);

  const idGrade =
    text.match(
      /(\d{4})\s*\/\s*(A1|A2|B1|B2)/
    );

  if (idGrade) {
    racer.racerId =
      Number(idGrade[1]);

    racer.grade =
      idGrade[2];
  }

  const anchors = [
    ...cell.matchAll(
      /<a\b[^>]*>([\s\S]*?)<\/a>/gi
    )
  ];

  for (
    const anchor
    of anchors
  ) {
    const candidate =
      compact(anchor[1])
        .replace(
          /\s+/g,
          ''
        );

    if (
      candidate &&
      !/^\d+$/.test(
        candidate
      )
    ) {
      racer.name =
        candidate;

      break;
    }
  }
}

function parseStatus(
  cell,
  racer
) {
  const lines =
    textLines(cell);

  if (
    lines.length >= 3
  ) {
    racer.fCount =
      numberFrom(
        lines[0]
      );

    racer.lCount =
      numberFrom(
        lines[1]
      );

    racer.avgSt =
      numberFrom(
        lines[2]
      );

    return;
  }

  const values =
    numericLines(cell);

  racer.fCount =
    values[0] ?? null;

  racer.lCount =
    values[1] ?? null;

  racer.avgSt =
    values[2] ?? null;
}

function assignThree(
  cell,
  racer,
  keys
) {
  const values =
    numericLines(cell);

  if (
    values.length < 3
  ) {
    return;
  }

  racer[keys[0]] =
    values[0];

  racer[keys[1]] =
    values[1];

  racer[keys[2]] =
    values[2];
}

function countCompleteRacers(
  racers
) {
  return Object
    .values(racers)
    .filter(
      racer =>
        racer.racerId != null &&
        racer.grade != null &&
        racer.avgSt != null &&
        racer.nationalWin != null &&
        racer.national2 != null &&
        racer.localWin != null &&
        racer.motor2 != null &&
        racer.boat2 != null
    )
    .length;
}

function parseRaceList(
  html
) {
  const racers =
    createRacers();

  const sections =
    table1Sections(
      html
    );

  const table =
    sections[1];

  if (!table) {
    return {
      racers,
      parserOk: false,
      parsedCount: 0
    };
  }

  const tbodies =
    tagBlocks(
      table,
      'tbody'
    );

  for (
    let lane = 1;
    lane <= 6;
    lane++
  ) {
    const row =
      tbodies[
        lane - 1
      ];

    if (!row) {
      continue;
    }

    const cells =
      tagBlocks(
        row,
        'td'
      );

    if (
      cells.length < 8
    ) {
      continue;
    }

    const racer =
      racers[lane];

    parseIdentity(
      cells[2],
      racer
    );

    parseStatus(
      cells[3],
      racer
    );

    assignThree(
      cells[4],
      racer,
      [
        'nationalWin',
        'national2',
        'national3'
      ]
    );

    assignThree(
      cells[5],
      racer,
      [
        'localWin',
        'local2',
        'local3'
      ]
    );

    assignThree(
      cells[6],
      racer,
      [
        'motorNo',
        'motor2',
        'motor3'
      ]
    );

    assignThree(
      cells[7],
      racer,
      [
        'boatNo',
        'boat2',
        'boat3'
      ]
    );
  }

  const parsedCount =
    countCompleteRacers(
      racers
    );

  return {
    racers,
    parserOk:
      parsedCount === 6,
    parsedCount
  };
}

function parseCsvLine(line) {
  const cells = [];

  let current = '';
  let quoted = false;

  for (
    let i = 0;
    i < line.length;
    i++
  ) {
    const char =
      line[i];

    if (
      char === '"'
    ) {
      if (
        quoted &&
        line[i + 1]
          === '"'
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
      char === ',' &&
      !quoted
    ) {
      cells.push(
        current
      );

      current = '';

      continue;
    }

    current += char;
  }

  cells.push(
    current
  );

  return cells;
}

function parseCsv(text) {
  const lines =
    String(
      text || ''
    )
      .replace(
        /^\uFEFF/,
        ''
      )
      .split(
        /\r?\n/
      )
      .filter(
        line =>
          line.trim()
            .length
      );

  if (
    lines.length < 2
  ) {
    return [];
  }

  const headers =
    parseCsvLine(
      lines[0]
    )
      .map(
        value =>
          value.trim()
      );

  const rows = [];

  for (
    let i = 1;
    i < lines.length;
    i++
  ) {
    const values =
      parseCsvLine(
        lines[i]
      );

    const row = {};

    headers.forEach(
      (
        header,
        column
      ) => {
        row[header] =
          values[column]
          ?? '';
      }
    );

    rows.push(row);
  }

  return rows;
}

function firstExisting(
  row,
  keys
) {
  for (
    const key
    of keys
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

  return '';
}

function normalizeNumber(
  value
) {
  const match =
    normalizeFullWidth(
      value
    )
      .match(
        /\d+/
      );

  return match
    ? Number(
        match[0]
      )
    : null;
}

function findRaceRow(
  rows,
  venue,
  race
) {
  const targetVenue =
    Number(venue);

  return rows.find(
    row => {
      const venueValue =
        normalizeNumber(
          firstExisting(
            row,
            [
              'レース場コード',
              '場コード',
              '場番号'
            ]
          )
        );

      const raceValue =
        normalizeNumber(
          firstExisting(
            row,
            [
              'レース回',
              'R',
              'レース番号'
            ]
          )
        );

      return (
        venueValue
          === targetVenue &&
        raceValue
          === Number(race)
      );
    }
  ) || null;
}

function laneValue(
  row,
  lane,
  names
) {
  for (
    const name
    of names
  ) {
    const key =
      `艇${lane}_${name}`;

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

  return '';
}

function fill(
  racer,
  key,
  value
) {
  if (
    racer[key] != null &&
    racer[key] !== ''
  ) {
    return;
  }

  if (
    value == null ||
    value === ''
  ) {
    return;
  }

  racer[key] =
    value;
}

function enrichFromCsv(
  csv,
  venue,
  race,
  racers
) {
  const rows =
    parseCsv(csv);

  const row =
    findRaceRow(
      rows,
      venue,
      race
    );

  if (!row) {
    return {
      matched: false,
      rowCount:
        rows.length,
      row: null
    };
  }

  for (
    let lane = 1;
    lane <= 6;
    lane++
  ) {
    const racer =
      racers[lane];

    fill(
      racer,
      'racerId',
      numberFrom(
        laneValue(
          row,
          lane,
          [
            '登録番号',
            '選手登録番号'
          ]
        )
      )
    );

    fill(
      racer,
      'name',
      String(
        laneValue(
          row,
          lane,
          ['選手名']
        )
      ).trim()
    );

    fill(
      racer,
      'grade',
      String(
        laneValue(
          row,
          lane,
          ['級別']
        )
      ).trim()
    );

    fill(
      racer,
      'fCount',
      numberFrom(
        laneValue(
          row,
          lane,
          ['F本数']
        )
      )
    );

    fill(
      racer,
      'lCount',
      numberFrom(
        laneValue(
          row,
          lane,
          ['L本数']
        )
      )
    );

    fill(
      racer,
      'avgSt',
      numberFrom(
        laneValue(
          row,
          lane,
          [
            '全国平均ST',
            '平均ST'
          ]
        )
      )
    );

    fill(
      racer,
      'nationalWin',
      numberFrom(
        laneValue(
          row,
          lane,
          ['全国勝率']
        )
      )
    );

    fill(
      racer,
      'national2',
      numberFrom(
        laneValue(
          row,
          lane,
          [
            '全国2連対率',
            '全国2連率'
          ]
        )
      )
    );

    fill(
      racer,
      'national3',
      numberFrom(
        laneValue(
          row,
          lane,
          [
            '全国3連対率',
            '全国3連率'
          ]
        )
      )
    );

    fill(
      racer,
      'localWin',
      numberFrom(
        laneValue(
          row,
          lane,
          ['当地勝率']
        )
      )
    );

    fill(
      racer,
      'local2',
      numberFrom(
        laneValue(
          row,
          lane,
          [
            '当地2連対率',
            '当地2連率'
          ]
        )
      )
    );

    fill(
      racer,
      'local3',
      numberFrom(
        laneValue(
          row,
          lane,
          [
            '当地3連対率',
            '当地3連率'
          ]
        )
      )
    );

    fill(
      racer,
      'motorNo',
      numberFrom(
        laneValue(
          row,
          lane,
          [
            'モーター番号',
            'モーターNo'
          ]
        )
      )
    );

    fill(
      racer,
      'motor2',
      numberFrom(
        laneValue(
          row,
          lane,
          [
            'モーター2連対率',
            'モーター2連率'
          ]
        )
      )
    );

    fill(
      racer,
      'motor3',
      numberFrom(
        laneValue(
          row,
          lane,
          [
            'モーター3連対率',
            'モーター3連率'
          ]
        )
      )
    );

    fill(
      racer,
      'boatNo',
      numberFrom(
        laneValue(
          row,
          lane,
          [
            'ボート番号',
            'ボートNo'
          ]
        )
      )
    );

    fill(
      racer,
      'boat2',
      numberFrom(
        laneValue(
          row,
          lane,
          [
            'ボート2連対率',
            'ボート2連率'
          ]
        )
      )
    );

    fill(
      racer,
      'boat3',
      numberFrom(
        laneValue(
          row,
          lane,
          [
            'ボート3連対率',
            'ボート3連率'
          ]
        )
      )
    );

    const entries = [];

    for (
      let day = 1;
      day <= 7;
      day++
    ) {
      for (
        let run = 1;
        run <= 2;
        run++
      ) {
        const prefix =
          `艇${lane}_節D${day}走${run}_`;

        const finish =
          numberFrom(
            row[
              `${prefix}着順`
            ]
          );

        const st =
          numberFrom(
            row[
              `${prefix}ST`
            ]
          );

        const course =
          numberFrom(
            row[
              `${prefix}進入`
            ]
          );

        if (
          finish == null &&
          st == null &&
          course == null
        ) {
          continue;
        }

        entries.push({
          day,
          run,
          finish,
          st,
          course
        });
      }
    }

    if (
      entries.length
    ) {
      racer.currentMeet =
        entries;
    }
  }

  return {
    matched: true,
    rowCount:
      rows.length,
    row
  };
}

module.exports =
async function handler(
  req,
  res
) {
  const started =
    Date.now();

  try {
    const date =
      String(
        req.query.date || ''
      )
        .replace(
          /[-/]/g,
          ''
        );

    const venue =
      String(
        req.query.venue || ''
      )
        .padStart(
          2,
          '0'
        );

    const race =
      Number(
        req.query.race || 1
      );

    if (
      !/^\d{8}$/.test(date) ||
      !VENUES[venue] ||
      !Number.isInteger(race) ||
      race < 1 ||
      race > 12
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          error:
            '入力値が不正です'
        });
    }

    const yyyy =
      date.slice(0, 4);

    const mm =
      date.slice(4, 6);

    const dd =
      date.slice(6, 8);

    const officialUrl =
      'https://www.boatrace.jp'
      +
      '/owpc/pc/race/racelist'
      +
      `?rno=${race}`
      +
      `&jcd=${venue}`
      +
      `&hd=${date}`;

    const csvUrl =
      'https://boatracecsv.github.io'
      +
      '/data/programs/race_cards/'
      +
      `${yyyy}/${mm}/${dd}.csv`;

    const [
      officialResult,
      csvResult
    ] =
      await Promise.allSettled([
        core.withRetry(
          ()=>fetchText(
            officialUrl,
            10000
          ),
          { attempts:2, retryDelayMs:100 }
        ),

        core.withRetry(
          ()=>fetchText(
            csvUrl,
            6000
          ),
          { attempts:2, retryDelayMs:100 }
        )
      ]);

    let racers =
      createRacers();

    let officialParsed =
      null;

    let officialError =
      null;

    if (
      officialResult.status
      === 'fulfilled'
    ) {
      officialParsed =
        parseRaceList(
          officialResult.value
        );

      racers =
        officialParsed.racers;
    } else {
      officialError =
        officialResult.reason
          ?.message
        || 'official-fetch-failed';
    }

    let csvInfo = {
      matched: false,
      rowCount: 0
    };

    let csvError =
      null;

    if (
      csvResult.status
      === 'fulfilled'
    ) {
      csvInfo =
        enrichFromCsv(
          csvResult.value,
          venue,
          race,
          racers
        );
    } else {
      csvError =
        csvResult.reason
          ?.message
        || 'csv-fetch-failed';
    }

    const parsedCount =
      countCompleteRacers(
        racers
      );

    if (
      parsedCount !== 6
    ) {
      return res
        .status(200)
        .json({
          ok: false,

          error:
            'race-list-unavailable',

          parsedCount,

          officialParsedCount:
            officialParsed
              ?.parsedCount
            ?? 0,

          officialError,

          csvMatched:
            csvInfo.matched,

          csvRows:
            csvInfo.rowCount,

          csvError,

          elapsedMs:
            Date.now()
            - started
        });
    }

    const fallbackUsed =
      !officialParsed
      || !officialParsed
        .parserOk;

    const currentMeetCounts =
      {};

    let racersWithMeetData =
      0;

    for (
      let lane = 1;
      lane <= 6;
      lane++
    ) {
      const count =
        racers[lane]
          .currentMeet
          .length;

      currentMeetCounts[
        lane
      ] = count;

      if (
        count > 0
      ) {
        racersWithMeetData++;
      }
    }

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    return res
      .status(200)
      .json({
        ok: true,

        venueName:
          VENUES[venue],

        race,

        source:
          fallbackUsed
            ? 'boatracecsv-fallback-v7'
            : 'official+boatracecsv-v7',

        fallbackUsed,

        parserOk: true,

        parsedCount,

        fetchedAt:
          new Date().toISOString(),

        dataQuality:{
          score:
            fallbackUsed ? 90 : 100,
          status:
            fallbackUsed ? 'degraded' : 'good',
          completeRacers:
            parsedCount,
          currentMeetCoverage:
            racersWithMeetData / 6
        },

        warnings:
          [
            fallbackUsed ? 'official-parser-fallback-used' : null,
            racersWithMeetData === 0 ? 'current-meet-data-missing' : null
          ].filter(Boolean),

        errors:[],

        officialParserOk:
          officialParsed
            ?.parserOk
          ?? false,

        officialError,

        csvMatched:
          csvInfo.matched,

        currentMeetDetected:
          racersWithMeetData > 0,

        currentMeetSource:
          racersWithMeetData > 0
            ? 'boatracecsv-race-cards'
            : null,

        currentMeetCounts,

        racersWithMeetData,

        elapsedMs:
          Date.now()
          - started,

        racers
      });
  }

  catch (error) {
    return res
      .status(200)
      .json({
        ok: false,

        error:
          error?.message
          || String(error),

        source:
          'race-v7-fallback',

        elapsedMs:
          Date.now()
          - started
      });
  }
};

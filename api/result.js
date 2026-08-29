const https = require('node:https');
const dns = require('node:dns');

const VENUES = {
  '01':'桐生','02':'戸田','03':'江戸川','04':'平和島',
  '05':'多摩川','06':'浜名湖','07':'蒲郡','08':'常滑',
  '09':'津','10':'三国','11':'びわこ','12':'住之江',
  '13':'尼崎','14':'鳴門','15':'丸亀','16':'児島',
  '17':'宮島','18':'徳山','19':'下関','20':'若松',
  '21':'芦屋','22':'福岡','23':'唐津','24':'大村'
};

function lookupIPv4(hostname, options, callback) {
  dns.lookup(
    hostname,
    {
      family: 4,
      all: false
    },
    callback
  );
}

function fetchJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);

    let settled = false;

    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const req = https.request(
      {
        protocol: 'https:',
        hostname: target.hostname,
        port: 443,
        path: target.pathname + target.search,
        method: 'GET',

        family: 4,
        lookup: lookupIPv4,
        servername: target.hostname,
        agent: false,

        headers: {
          'User-Agent':
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',

          'Accept':
            'application/json,text/plain,*/*',

          'Accept-Language':
            'ja-JP,ja;q=0.9',

          'Accept-Encoding':
            'identity',

          'Cache-Control':
            'no-cache',

          'Connection':
            'close'
        }
      },

      response => {
        const chunks = [];

        response.on(
          'data',
          chunk => chunks.push(chunk)
        );

        response.on(
          'end',
          () => {
            if (settled) return;
            settled = true;

            const body =
              Buffer.concat(chunks)
                .toString('utf8');

            if (response.statusCode === 404) {
              return resolve(null);
            }

            if (
              response.statusCode < 200 ||
              response.statusCode >= 300
            ) {
              const error =
                new Error(
                  `HTTP ${response.statusCode}`
                );

              error.code =
                'UPSTREAM_HTTP';

              return reject(error);
            }

            try {
              resolve(
                JSON.parse(body)
              );
            } catch {
              const error =
                new Error(
                  'invalid-result-json'
                );

              error.code =
                'INVALID_JSON';

              reject(error);
            }
          }
        );
      }
    );

    req.setTimeout(
      timeoutMs,
      () => {
        const error =
          new Error(
            'result-request-timeout'
          );

        error.code =
          'UPSTREAM_TIMEOUT';

        req.destroy(error);
      }
    );

    req.on(
      'error',
      fail
    );

    req.end();
  });
}

function findRace(data, venue, race) {
  if (!data) return null;

  const stadiumNumber =
    Number(venue);

  const raceNumber =
    Number(race);

  /*
   * 現行スキーマ
   * programs.stadiums.{stadium}.races.{race}
   */
  const programs =
    data.programs || data;

  const stadiums =
    programs?.stadiums;

  if (!stadiums) {
    return null;
  }

  const stadium =
    stadiums[venue] ??
    stadiums[String(stadiumNumber)] ??
    stadiums[String(stadiumNumber).padStart(2, '0')];

  if (!stadium) {
    return null;
  }

  const races =
    stadium.races;

  if (!races) {
    return null;
  }

  return (
    races[String(raceNumber)] ??
    races[raceNumber] ??
    null
  );
}

function parseResult(raceData) {
  const result =
    raceData?.result;

  if (!result) {
    return {
      finished: false,
      result: null,
      payout: null,
      popularity: null,
      technique: null,
      racers: []
    };
  }

  const trifecta =
    Array.isArray(
      result?.payouts?.trifecta
    )
      ? result.payouts.trifecta
      : [];

  const primary =
    trifecta[0] || null;

  const combination =
    primary?.combination
      ? String(primary.combination)
          .replace(/\s+/g, '')
      : null;

  const payout =
    Number.isFinite(
      Number(primary?.amount)
    )
      ? Number(primary.amount)
      : null;

  const racers = [];

  if (
    result.racers &&
    typeof result.racers === 'object'
  ) {
    for (let lane = 1; lane <= 6; lane++) {
      const racer =
        result.racers[String(lane)] ??
        result.racers[lane];

      if (!racer) continue;

      racers.push({
        lane,

        racerId:
          racer.number ??
          null,

        name:
          racer.name ??
          null,

        course:
          racer.course_number ??
          null,

        startTiming:
          racer.start_timing ??
          null,

        place:
          racer.place_number ??
          null
      });
    }
  }

  racers.sort(
    (a, b) =>
      (a.place ?? 99) -
      (b.place ?? 99)
  );

  /*
   * trifecta がまだ無ければ、
   * 結果確定前として扱う。
   */
  const finished =
    Boolean(
      combination &&
      payout != null
    );

  return {
    finished,

    result:
      finished
        ? combination
        : null,

    payout:
      finished
        ? payout
        : null,

    popularity:
      null,

    technique:
      result.technique_number ??
      null,

    racers
  };
}

module.exports =
async function handler(req, res) {
  const started =
    Date.now();

  try {
    const date =
      String(
        req.query.date || ''
      )
      .replace(/[-/]/g, '');

    const venue =
      String(
        req.query.venue || ''
      )
      .padStart(2, '0');

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
          error: '入力値が不正です'
        });
    }

    const year =
      date.slice(0, 4);

    const url =
      `https://boatraceopenapi.github.io/api/v1/${year}/${date}.json`;

    const data =
      await fetchJson(
        url,
        15000
      );

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    if (!data) {
      return res
        .status(200)
        .json({
          ok: true,

          finished: false,

          venueName:
            VENUES[venue],

          race,

          result: null,
          payout: null,

          source:
            'boatraceopenapi-v1',

          elapsedMs:
            Date.now() -
            started
        });
    }

    const raceData =
      findRace(
        data,
        venue,
        race
      );

    if (!raceData) {
      return res
        .status(200)
        .json({
          ok: true,

          finished: false,

          venueName:
            VENUES[venue],

          race,

          result: null,
          payout: null,

          source:
            'boatraceopenapi-v1',

          elapsedMs:
            Date.now() -
            started
        });
    }

    const parsed =
      parseResult(
        raceData
      );

    return res
      .status(200)
      .json({
        ok: true,

        venueName:
          VENUES[venue],

        race,

        source:
          'boatraceopenapi-v1',

        ...parsed,

        elapsedMs:
          Date.now() -
          started
      });

  } catch (error) {
    return res
      .status(200)
      .json({
        ok: false,

        finished: false,

        result: null,
        payout: null,

        error:
          error?.message ||
          String(error),

        code:
          error?.code ||
          null,

        elapsedMs:
          Date.now() -
          started
      });
  }
};

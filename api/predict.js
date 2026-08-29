const VENUES = {
  '01':'桐生',
  '02':'戸田',
  '03':'江戸川',
  '04':'平和島',
  '05':'多摩川',
  '06':'浜名湖',
  '07':'蒲郡',
  '08':'常滑',
  '09':'津',
  '10':'三国',
  '11':'びわこ',
  '12':'住之江',
  '13':'尼崎',
  '14':'鳴門',
  '15':'丸亀',
  '16':'児島',
  '17':'宮島',
  '18':'徳山',
  '19':'下関',
  '20':'若松',
  '21':'芦屋',
  '22':'福岡',
  '23':'唐津',
  '24':'大村'
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

const COURSE_PRIOR = {
  1:0.56,
  2:0.14,
  3:0.12,
  4:0.10,
  5:0.05,
  6:0.03
};

const GRADE_BONUS = {
  A1:0.42,
  A2:0.18,
  B1:0.00,
  B2:-0.18
};

function cleanText(value){

  return String(value || '')
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      ' '
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      ' '
    )
    .replace(
      /<br\s*\/?>/gi,
      '\n'
    )
    .replace(
      /<\/(?:div|p|li|span|td|tr|a|tbody)>/gi,
      '\n'
    )
    .replace(
      /<[^>]+>/g,
      ' '
    )
    .replace(
      /&nbsp;|&#160;/gi,
      ' '
    )
    .replace(
      /&amp;/gi,
      '&'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /[ \t]+/g,
      ' '
    )
    .replace(
      /\n\s+/g,
      '\n'
    )
    .trim();

}

function compactText(value){

  return cleanText(value)
    .replace(
      /\s+/g,
      ' '
    )
    .trim();

}

function textLines(value){

  return cleanText(value)
    .split(/\n+/)
    .map(
      line =>
        line.trim()
    )
    .filter(Boolean);

}

function toNumber(value){

  const parsed =
    Number(
      String(value ?? '')
        .replace(
          /[%,¥,\s]/g,
          ''
        )
    );

  return Number.isFinite(parsed)
    ?
    parsed
    :
    null;

}

function toInteger(value){

  const match =
    String(value ?? '')
      .match(
        /\d+/
      );

  if(
    !match
  ){

    return null;

  }

  const parsed =
    Number(
      match[0]
    );

  return Number.isFinite(parsed)
    ?
    parsed
    :
    null;

}

function extractTagBlocks(
  html,
  tagName
){

  const output = [];

  const regex =
    new RegExp(
      `<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`,
      'gi'
    );

  let match;

  while(
    (
      match =
        regex.exec(html)
    )
  ){

    output.push(
      match[0]
    );

  }

  return output;

}

function extractTable1Blocks(
  html
){

  const starts = [];

  const regex =
    /<div\b[^>]*class=["'][^"']*\btable1\b[^"']*["'][^>]*>/gi;

  let match;

  while(
    (
      match =
        regex.exec(html)
    )
  ){

    starts.push(
      match.index
    );

  }

  const blocks = [];

  for(
    let index = 0;
    index < starts.length;
    index++
  ){

    const start =
      starts[index];

    const end =
      index + 1 < starts.length
        ?
        starts[index + 1]
        :
        html.length;

    blocks.push(
      html.slice(
        start,
        end
      )
    );

  }

  return blocks;

}

async function fetchText(
  url
){

  const response =
    await fetch(
      url,
      {
        cache:'no-store'
      }
    );

  const html =
    await response.text();

  if(
    !response.ok
  ){

    throw new Error(
      `公式ページ取得失敗 HTTP ${response.status}`
    );

  }

  return html;

}

function parseOdds(
  html
){

  const values = [];

  const regex =
    /<td[^>]*class=["'][^"']*\boddsPoint\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi;

  let match;

  while(
    (
      match =
        regex.exec(html)
    )
  ){

    const value =
      toNumber(
        compactText(
          match[1]
        )
      );

    values.push(
      value
    );

  }

  const result = {};

  for(
    let index = 0;
    index < Math.min(
      values.length,
      120
    );
    index++
  ){

    const odd =
      values[index];

    if(
      !Number.isFinite(
        odd
      )
      ||
      odd < 1
    ){

      continue;

    }

    const combination =
      String(
        ORDER[index]
      );

    const key =
      `${combination[0]}-${combination[1]}-${combination[2]}`;

    result[key] =
      odd;

  }

  return result;

}

function parseRaceList(
  html
){

  const racers = {};

  for(
    let lane = 1;
    lane <= 6;
    lane++
  ){

    racers[lane] = {
      lane,
      racerId:null,
      name:null,
      grade:null,
      age:null,
      weight:null,
      fCount:0,
      lCount:0,
      avgSt:null,
      nationalWin:null,
      national2:null,
      national3:null,
      localWin:null,
      local2:null,
      local3:null,
      motorNo:null,
      motor2:null,
      motor3:null,
      boatNo:null,
      boat2:null,
      boat3:null,
      currentMeet:[]
    };

  }

  const tables =
    extractTable1Blocks(
      html
    );

  const mainTable =
    tables[1];

  if(
    !mainTable
  ){

    return {
      racers,
      currentMeetDetected:false
    };

  }

  const bodies =
    extractTagBlocks(
      mainTable,
      'tbody'
    )
    .slice(
      0,
      6
    );

  bodies.forEach(
    (
      body,
      index
    ) => {

      const lane =
        index + 1;

      const racer =
        racers[lane];

      const cells =
        extractTagBlocks(
          body,
          'td'
        );

      if(
        cells.length < 8
      ){

        return;

      }

      const identityText =
        compactText(
          cells[2]
        );

      const identityMatch =
        identityText.match(
          /\b(\d{4})\s*\/\s*(A1|A2|B1|B2)\b/
        );

      if(
        identityMatch
      ){

        racer.racerId =
          Number(
            identityMatch[1]
          );

        racer.grade =
          identityMatch[2];

      }

      const nameMatch =
        cells[2]
          .match(
            /<a\b[^>]*>([\s\S]*?)<\/a>/i
          );

      if(
        nameMatch
      ){

        racer.name =
          compactText(
            nameMatch[1]
          )
          .replace(
            /\s/g,
            ''
          );

      }

      const ageMatch =
        identityText.match(
          /(\d{2})歳/
        );

      const weightMatch =
        identityText.match(
          /(\d{2}(?:\.\d+)?)kg/
        );

      if(
        ageMatch
      ){

        racer.age =
          Number(
            ageMatch[1]
          );

      }

      if(
        weightMatch
      ){

        racer.weight =
          Number(
            weightMatch[1]
          );

      }

      const statusText =
        compactText(
          cells[3]
        );

      const fMatch =
        statusText.match(
          /\bF(\d+)\b/i
        );

      const lMatch =
        statusText.match(
          /\bL(\d+)\b/i
        );

      const stMatch =
        statusText.match(
          /\b0\.(\d{2})\b/
        );

      racer.fCount =
        fMatch
          ?
          Number(
            fMatch[1]
          )
          :
          0;

      racer.lCount =
        lMatch
          ?
          Number(
            lMatch[1]
          )
          :
          0;

      racer.avgSt =
        stMatch
          ?
          Number(
            `0.${stMatch[1]}`
          )
          :
          null;

      const national =
        textLines(
          cells[4]
        )
        .map(
          toNumber
        )
        .filter(
          Number.isFinite
        );

      if(
        national.length >= 3
      ){

        racer.nationalWin =
          national[0];

        racer.national2 =
          national[1];

        racer.national3 =
          national[2];

      }

      const local =
        textLines(
          cells[5]
        )
        .map(
          toNumber
        )
        .filter(
          Number.isFinite
        );

      if(
        local.length >= 3
      ){

        racer.localWin =
          local[0];

        racer.local2 =
          local[1];

        racer.local3 =
          local[2];

      }

      const motor =
        textLines(
          cells[6]
        )
        .map(
          toNumber
        )
        .filter(
          Number.isFinite
        );

      if(
        motor.length >= 3
      ){

        racer.motorNo =
          motor[0];

        racer.motor2 =
          motor[1];

        racer.motor3 =
          motor[2];

      }

      const boat =
        textLines(
          cells[7]
        )
        .map(
          toNumber
        )
        .filter(
          Number.isFinite
        );

      if(
        boat.length >= 3
      ){

        racer.boatNo =
          boat[0];

        racer.boat2 =
          boat[1];

        racer.boat3 =
          boat[2];

      }

    }
  );

  let currentMeetDetected =
    false;

  const wholeText =
    cleanText(
      html
    );

  const meetIndex =
    wholeText.indexOf(
      '今節成績'
    );

  if(
    meetIndex >= 0
  ){

    const meetText =
      wholeText.slice(
        meetIndex
      );

    const lines =
      meetText
        .split(/\n+/)
        .map(
          line =>
            line.trim()
        )
        .filter(Boolean);

    for(
      let lane = 1;
      lane <= 6;
      lane++
    ){

      const entries = [];

      for(
        let index = 0;
        index < lines.length - 2;
        index++
      ){

        if(
          Number(
            lines[index]
          ) !== lane
      ){

          continue;

        }

        const window =
          lines
            .slice(
              index,
              index + 40
            )
            .join(
              ' '
            );

        const regex =
          /\b([1-6])\s+(?:F|L)?\.?([0-3]\d)\s+([1-6])\b/g;

        let match;

        while(
          (
            match =
              regex.exec(
                window
              )
          )
        ){

          entries.push({
            course:
              Number(
                match[1]
              ),

            st:
              Number(
                `0.${match[2]}`
              ),

            finish:
              Number(
                match[3]
              )
          });

        }

        break;

      }

      racers[lane]
        .currentMeet =
          entries.slice(
            0,
            8
          );

    }

    currentMeetDetected =
      Object.values(
        racers
      )
      .some(
        racer =>
          racer.currentMeet.length > 0
      );

  }

  return {
    racers,
    currentMeetDetected
  };

}

function parseBeforeInfo(
  html
){

  const boats = {};

  for(
    let lane = 1;
    lane <= 6;
    lane++
  ){

    boats[lane] = {
      lane,
      exTime:null,
      tilt:null,
      parts:[],
      isMiss:false,
      exCourse:null,
      exSt:null,
      exFlying:false
    };

  }

  const tables =
    extractTable1Blocks(
      html
    );

  const mainTable =
    tables[1];

  if(
    mainTable
  ){

    const rows =
      extractTagBlocks(
        mainTable,
        'tbody'
      )
      .slice(
        0,
        6
      );

    rows.forEach(
      (
        row,
        index
      ) => {

      const boat =
        boats[
          index + 1
        ];

      const cells =
        extractTagBlocks(
          row,
          'td'
        );

      if(
        cells.length > 4
      ){

        boat.exTime =
          toNumber(
            compactText(
              cells[4]
            )
          );

      }

      if(
        cells.length > 5
      ){

        boat.tilt =
          toNumber(
            compactText(
              cells[5]
            )
          );

      }

      if(
        cells.length > 7
      ){

        boat.parts =
          extractTagBlocks(
            cells[7],
            'li'
          )
          .map(
            compactText
          )
          .filter(Boolean);

      }

      boat.isMiss =
        /is-miss/i
          .test(
            row
          );

    });

  }

  const startTable =
    tables[2];

  if(
    startTable
  ){

    const rows =
      extractTagBlocks(
        startTable,
        'tr'
      );

    let course =
      0;

    rows.forEach(
      row => {

      const laneMatch =
        row.match(
          /table1_boatImage1Number[^>]*>\s*([1-6])/i
        );

      const stMatch =
        row.match(
          /table1_boatImage1Time[^>]*>\s*(F)?\.?([0-3]\d)/i
        );

      if(
        !laneMatch
        ||
        !stMatch
      ){

        return;

      }

      course++;

      const lane =
        Number(
          laneMatch[1]
        );

      boats[lane]
        .exCourse =
          course;

      boats[lane]
        .exSt =
          Number(
            `0.${stMatch[2]}`
          );

      boats[lane]
        .exFlying =
          Boolean(
            stMatch[1]
          );

    });

  }

  const pageText =
    cleanText(
      html
    );

  const weather = {
    temperature:null,
    weather:null,
    windSpeed:null,
    windDirection:null,
    waterTemperature:null,
    waveHeight:null,
    stabilityBoard:false,
    fixedEntry:false
  };

  weather.stabilityBoard =
    pageText.includes(
      '安定板使用'
    );

  weather.fixedEntry =
    pageText.includes(
      '進入固定'
    );

  const temperatureMatch =
    pageText.match(
      /気温\s*([0-9.]+)\s*℃/
    );

  const windMatch =
    pageText.match(
      /風速\s*([0-9.]+)\s*m/
    );

  const waterMatch =
    pageText.match(
      /水温\s*([0-9.]+)\s*℃/
    );

  const waveMatch =
    pageText.match(
      /波高\s*([0-9.]+)\s*cm/
    );

  if(
    temperatureMatch
  ){

    weather.temperature =
      Number(
        temperatureMatch[1]
      );

  }

  if(
    windMatch
  ){

    weather.windSpeed =
      Number(
        windMatch[1]
      );

  }

  if(
    waterMatch
  ){

    weather.waterTemperature =
      Number(
        waterMatch[1]
      );

  }

  if(
    waveMatch
  ){

    weather.waveHeight =
      Number(
        waveMatch[1]
      );

  }

  const directionMatch =
    html.match(
      /\bis-wind(\d+)\b/i
    );

  if(
    directionMatch
  ){

    weather.windDirection =
      Number(
        directionMatch[1]
      );

  }

  const knownWeather = [
    '晴',
    '曇り',
    '曇',
    '雨',
    '雪'
  ];

  for(
    const label of knownWeather
  ){

    if(
      pageText.includes(
        label
      )
    ){

      weather.weather =
        label;

      break;

    }

  }

  return {
    boats,
    weather
  };

}

function parseResult(
  html
){

  const tables =
    extractTable1Blocks(
      html
    );

  if(
    tables.length < 4
  ){

    return {
      ready:false
    };

  }

  const paymentTable =
    tables[3];

  const bodies =
    extractTagBlocks(
      paymentTable,
      'tbody'
    );

  if(
    !bodies.length
  ){

    return {
      ready:false
    };

  }

  const cells =
    extractTagBlocks(
      bodies[0],
      'td'
    );

  if(
    cells.length < 3
  ){

    return {
      ready:false
    };

  }

  const combinationMatch =
    compactText(
      cells[1]
    )
    .match(
      /([1-6])\s*-\s*([1-6])\s*-\s*([1-6])/
    );

  if(
    !combinationMatch
  ){

    return {
      ready:false
    };

  }

  const combo =
    `${combinationMatch[1]}-${combinationMatch[2]}-${combinationMatch[3]}`;

  const payout =
    toNumber(
      compactText(
        cells[2]
      )
    );

  const popularity =
    cells.length >= 4
      ?
      toInteger(
        compactText(
          cells[3]
        )
      )
      :
      null;

  return {
    ready:true,
    combo,
    payout,
    popularity
  };

}

function readCourseBias(
  query
){

  const result = {};

  for(
    let lane = 1;
    lane <= 6;
    lane++
  ){

    const raw =
      Number(
        query[
          `b${lane}`
        ]
      );

    const value =
      Number.isFinite(
        raw
      )
        ?
        raw
        :
        1;

    result[lane] =
      Math.max(
        0.82,
        Math.min(
          1.18,
          value
        )
      );

  }

  return result;

}

function zScore(
  values,
  target
){

  const valid =
    values.filter(
      value =>
        Number.isFinite(
          value
        )
    );

  if(
    valid.length < 3
    ||
    !Number.isFinite(
      target
    )
  ){

    return 0;

  }

  const mean =
    valid.reduce(
      (
        total,
        value
      ) =>
        total + value,
      0
    )
    /
    valid.length;

  const variance =
    valid.reduce(
      (
        total,
        value
      ) =>
        total
        +
        (
          value -
          mean
        ) ** 2,
      0
    )
    /
    valid.length;

  const standardDeviation =
    Math.sqrt(
      variance
    )
    ||
    1;

  return (
    target -
    mean
  )
  /
  standardDeviation;

}

function recentMeetScore(
  races
){

  if(
    !Array.isArray(
      races
    )
    ||
    races.length === 0
  ){

    return 0;

  }

  const recent =
    races.slice(
      -6
    );

  const validFinishes =
    recent.filter(
      race =>
        Number.isFinite(
          race.finish
        )
    );

  if(
    validFinishes.length === 0
  ){

    return 0;

  }

  const averageFinish =
    validFinishes.reduce(
      (
        total,
        race
      ) =>
        total +
        race.finish,
      0
    )
    /
    validFinishes.length;

  const validStarts =
    recent.filter(
      race =>
        Number.isFinite(
          race.st
        )
    );

  const averageStart =
    validStarts.length
      ?
      validStarts.reduce(
        (
          total,
          race
        ) =>
          total +
          race.st,
        0
      )
      /
      validStarts.length
      :
      null;

  let score =
    (
      3.5 -
      averageFinish
    )
    *
    0.09;

  if(
    Number.isFinite(
      averageStart
    )
  ){

    score +=
      (
        0.16 -
        averageStart
      )
      *
      0.45;

  }

  return Math.max(
    -0.30,
    Math.min(
      0.30,
      score
    )
  );

}

function racerValues(
  racers,
  key
){

  return Object.values(
    racers
  )
  .map(
    racer =>
      racer[key]
  );

}

function calculateLaneStrength(
  lane,
  racer,
  exhibition,
  racers,
  allExhibition,
  courseBias
){

  let score =
    Math.log(
      COURSE_PRIOR[lane]
      *
      courseBias[lane]
    );

  score +=
    GRADE_BONUS[
      racer.grade
    ]
    ||
    0;

  score +=
    0.20
    *
    zScore(
      racerValues(
        racers,
        'nationalWin'
      ),
      racer.nationalWin
    );

  score +=
    0.08
    *
    zScore(
      racerValues(
        racers,
        'national2'
      ),
      racer.national2
    );

  score +=
    0.08
    *
    zScore(
      racerValues(
        racers,
        'national3'
      ),
      racer.national3
    );

  score +=
    0.13
    *
    zScore(
      racerValues(
        racers,
        'localWin'
      ),
      racer.localWin
    );

  score +=
    0.06
    *
    zScore(
      racerValues(
        racers,
        'local2'
      ),
      racer.local2
    );

  score +=
    0.05
    *
    zScore(
      racerValues(
        racers,
        'local3'
      ),
      racer.local3
    );

  score +=
    0.13
    *
    zScore(
      racerValues(
        racers,
        'motor2'
      ),
      racer.motor2
    );

  score +=
    0.06
    *
    zScore(
      racerValues(
        racers,
        'motor3'
      ),
      racer.motor3
    );

  score +=
    0.07
    *
    zScore(
      racerValues(
        racers,
        'boat2'
      ),
      racer.boat2
    );

  score +=
    0.04
    *
    zScore(
      racerValues(
        racers,
        'boat3'
      ),
      racer.boat3
    );

  score -=
    0.11
    *
    zScore(
      racerValues(
        racers,
        'avgSt'
      ),
      racer.avgSt
    );

  score -=
    Math.min(
      0.32,
      (
        racer.fCount ||
        0
      )
      *
      0.13
    );

  score -=
    Math.min(
      0.16,
      (
        racer.lCount ||
        0
      )
      *
      0.08
    );

  score +=
    recentMeetScore(
      racer.currentMeet
    );

  const exhibitionTimes =
    Object.values(
      allExhibition
    )
    .map(
      boat =>
        boat.exTime
    );

  if(
    Number.isFinite(
      exhibition.exTime
    )
  ){

    score -=
      0.19
      *
      zScore(
        exhibitionTimes,
        exhibition.exTime
      );

  }

  const exhibitionStarts =
    Object.values(
      allExhibition
    )
    .map(
      boat =>
        boat.exSt
    );

  if(
    Number.isFinite(
      exhibition.exSt
    )
  ){

    score -=
      0.11
      *
      zScore(
        exhibitionStarts,
        exhibition.exSt
      );

  }

  if(
    exhibition.exFlying
  ){

    score -=
      0.03;

  }

  if(
    exhibition.isMiss
  ){

    score -=
      0.18;

  }

  if(
    Number.isFinite(
      exhibition.exCourse
    )
    &&
    exhibition.exCourse !== lane
  ){

    const original =
      COURSE_PRIOR[
        lane
      ];

    const actual =
      COURSE_PRIOR[
        exhibition.exCourse
      ];

    score +=
      0.18
      *
      Math.log(
        actual /
        original
      );

  }

  if(
    Array.isArray(
      exhibition.parts
    )
    &&
    exhibition.parts.length >= 3
  ){

    score -=
      0.05;

  }

  return score;

}

function createModelProbabilities(
  strengths
){

  const weights = {};

  for(
    let lane = 1;
    lane <= 6;
    lane++
  ){

    weights[lane] =
      Math.exp(
        strengths[lane]
      );

  }

  const probabilities = {};

  const initialTotal =
    Object.values(
      weights
    )
    .reduce(
      (
        total,
        value
      ) =>
        total +
        value,
      0
    );

  for(
    const value
    of ORDER
  ){

    const combination =
      String(
        value
      );

    const first =
      Number(
        combination[0]
      );

    const second =
      Number(
        combination[1]
      );

    const third =
      Number(
        combination[2]
      );

    const p1 =
      weights[first]
      /
      initialTotal;

    const secondTotal =
      initialTotal -
      weights[first];

    const p2 =
      weights[second]
      /
      secondTotal;

    const thirdTotal =
      secondTotal -
      weights[second];

    const p3 =
      weights[third]
      /
      thirdTotal;

    probabilities[
      `${first}-${second}-${third}`
    ] =
      p1 * p2 * p3;

  }

  return probabilities;

}

function createMarketProbabilities(
  odds
){

  const inverse = {};

  let sum =
    0;

  Object.entries(
    odds
  )
  .forEach(
    (
      [
        combination,
        odd
      ]
    ) => {

      if(
        Number.isFinite(
          odd
        )
        &&
        odd > 0
      ){

        inverse[
          combination
        ] =
          1 /
          odd;

        sum +=
          inverse[
            combination
          ];

      }

    }
  );

  const probabilities = {};

  Object.entries(
    inverse
  )
  .forEach(
    (
      [
        combination,
        value
      ]
    ) => {

      probabilities[
        combination
      ] =
        sum
          ?
          value /
          sum
          :
          0;

    }
  );

  return probabilities;

}

function blendProbabilities(
  model,
  market,
  modelWeight
){

  const result = {};

  let total =
    0;

  for(
    const value
    of ORDER
  ){

    const combination =
      String(
        value
      );

    const key =
      `${combination[0]}-${combination[1]}-${combination[2]}`;

    const modelProbability =
      Math.max(
        model[key] || 0,
        0.000000001
      );

    const marketProbability =
      Math.max(
        market[key] || 0,
        0.000000001
      );

    const blended =
      Math.pow(
        modelProbability,
        modelWeight
      )
      *
      Math.pow(
        marketProbability,
        1 - modelWeight
      );

    result[key] =
      blended;

    total +=
      blended;

  }

  if(
    total > 0
  ){

    Object.keys(
      result
    )
    .forEach(
      key => {

        result[key] /=
          total;

      }
    );

  }

  return result;

}

function calculateCoverage(
  racers,
  before,
  currentMeetDetected
){

  const racerFields = [
    'grade',
    'avgSt',
    'nationalWin',
    'national2',
    'national3',
    'localWin',
    'local2',
    'local3',
    'motor2',
    'motor3',
    'boat2',
    'boat3'
  ];

  const beforeFields = [
    'exTime',
    'exSt',
    'exCourse'
  ];

  let total =
    0;

  let obtained =
    0;

  for(
    let lane = 1;
    lane <= 6;
    lane++
  ){

    for(
      const field
      of racerFields
    ){

      total++;

      if(
        racers[lane][field] != null
      ){

        obtained++;

      }

    }

    for(
      const field
      of beforeFields
    ){

      total++;

      if(
        before.boats[lane][field] != null
      ){

        obtained++;

      }

    }

  }

  total++;

  if(
    currentMeetDetected
  ){

    obtained++;

  }

  total++;

  if(
    before.weather.windSpeed != null
    ||
    before.weather.waveHeight != null
  ){

    obtained++;

  }

  return Math.round(
    obtained /
    total *
    100
  );

}

function selectBets(
  odds,
  probabilities,
  market,
  budget,
  coverage,
  weather
){

  const units =
    Math.floor(
      budget /
      100
    );

  if(
    units < 1
  ){

    return [];

  }

  let rows =
    Object.entries(
      odds
    )
    .map(
      (
        [
          combination,
          odd
        ]
      ) => {

        const probability =
          probabilities[
            combination
          ]
          ||
          0;

        const marketProbability =
          market[
            combination
          ]
          ||
          0;

        const divergence =
          marketProbability > 0
            ?
            probability /
            marketProbability
            :
            1;

        let oddsPenalty =
          1;

        if(
          odd > 100
        ){

          oddsPenalty =
            0.50;

        }else if(
          odd > 60
        ){

          oddsPenalty =
            0.68;

        }else if(
          odd > 30
        ){

          oddsPenalty =
            0.82;

        }

        const edge =
          Math.max(
            0.80,
            Math.min(
              1.25,
              divergence
            )
          );

        const score =
          probability
          *
          Math.pow(
            edge,
            0.30
          )
          *
          oddsPenalty;

        return {
          combo:
            combination,

          odds:
            odd,

          p:
            probability,

          marketP:
            marketProbability,

          divergence,

          score
        };

      }
    )
    .filter(
      row =>
        Number.isFinite(
          row.odds
        )
        &&
        row.odds >= 1
    );

  if(
    units <= 3
  ){

    rows =
      rows.filter(
        row =>
          row.odds <= 80
      );

  }else{

    rows =
      rows.filter(
        row =>
          row.odds <= 150
      );

  }

  rows.sort(
    (
      a,
      b
    ) =>
      b.score -
      a.score
      ||
      b.p -
      a.p
  );

  const wind =
    Number(
      weather.windSpeed ||
      0
    );

  const wave =
    Number(
      weather.waveHeight ||
      0
    );

  let maximumPicks =
    Math.min(
      3,
      units
    );

  if(
    coverage < 75
    ||
    wind >= 6
    ||
    wave >= 6
  ){

    maximumPicks =
      Math.min(
        maximumPicks,
        2
      );

  }

  const selected =
    rows
      .filter(
        row =>
          row.p >=
          0.025
      )
      .slice(
        0,
        maximumPicks
      );

  if(
    selected.length === 0
  ){

    return [];

  }

  if(
    units <= 3
  ){

    return selected.map(
      row => ({
        ...row,
        amount:100
      })
    );

  }

  const probabilityTotal =
    selected.reduce(
      (
        total,
        row
      ) =>
        total +
        row.p,
      0
    );

  let remaining =
    units;

  const result =
    [];

  selected.forEach(
    (
      row,
      index
    ) => {

      let use;

      if(
        index ===
        selected.length - 1
      ){

        use =
          remaining;

      }else{

        use =
          Math.max(
            1,
            Math.floor(
              units
              *
              row.p
              /
              probabilityTotal
            )
          );

      }

      const mustRemain =
        selected.length
        -
        index
        -
        1;

      use =
        Math.min(
          use,
          remaining -
          mustRemain
        );

      result.push({
        ...row,
        amount:
          use *
          100
      });

      remaining -=
        use;

    }
  );

  return result;

}

module.exports =
async function handler(
  req,
  res
){

  try{

    const action =
      String(
        req.query.action ||
        'predict'
      );

    const date =
      String(
        req.query.date ||
        ''
      )
      .replace(
        /[-/]/g,
        ''
      );

    const venue =
      String(
        req.query.venue ||
        ''
      )
      .padStart(
        2,
        '0'
      );

    const race =
      Number(
        req.query.race ||
        1
      );

    if(
      !/^\d{8}$/.test(
        date
      )
      ||
      !VENUES[
        venue
      ]
      ||
      !Number.isInteger(
        race
      )
      ||
      race < 1
      ||
      race > 12
    ){

      return res
        .status(400)
        .json({
          error:
            '入力値が不正です'
        });

    }

    const query =
      `?rno=${race}&jcd=${venue}&hd=${date}`;

    const base =
      'https://www.boatrace.jp/owpc/pc/race';

    if(
      action ===
      'result'
    ){

      const html =
        await fetchText(
          `${base}/raceresult${query}`
        );

      const result =
        parseResult(
          html
        );

      return res
        .status(200)
        .json({
          venueName:
            VENUES[
              venue
            ],

          race,

          ...result
        });

    }

    const budget =
      Number(
        req.query.budget ||
        300
      );

    if(
      !Number.isFinite(
        budget
      )
      ||
      budget < 100
    ){

      return res
        .status(400)
        .json({
          error:
            '予算が不正です'
        });

    }

    const courseBias =
      readCourseBias(
        req.query
      );

    const [
      oddsHtml,
      raceHtml,
      beforeHtml
    ] =
      await Promise.all([

        fetchText(
          `${base}/odds3t${query}`
        ),

        fetchText(
          `${base}/racelist${query}`
        ),

        fetchText(
          `${base}/beforeinfo${query}`
        )

      ]);

    const odds =
      parseOdds(
        oddsHtml
      );

    const oddsCount =
      Object.keys(
        odds
      ).length;

    if(
      oddsCount < 100
    ){

      return res
        .status(200)
        .json({
          skip:true,

          venueName:
            VENUES[
              venue
            ],

          race,

          oddsCount,

          picks:[],

          reason:
            `公式3連単オッズを${oddsCount}通りしか取得できないため見送り。`
        });

    }

    const raceInfo =
      parseRaceList(
        raceHtml
      );

    const before =
      parseBeforeInfo(
        beforeHtml
      );

    const coverage =
      calculateCoverage(
        raceInfo.racers,
        before,
        raceInfo.currentMeetDetected
      );

    const strengths = {};

    for(
      let lane = 1;
      lane <= 6;
      lane++
    ){

      strengths[lane] =
        calculateLaneStrength(

          lane,

          raceInfo
            .racers[
              lane
            ],

          before
            .boats[
              lane
            ],

          raceInfo
            .racers,

          before
            .boats,

          courseBias

        );

    }

    const modelProbabilities =
      createModelProbabilities(
        strengths
      );

    const marketProbabilities =
      createMarketProbabilities(
        odds
      );

    let modelWeight;

    if(
      coverage >= 90
    ){

      modelWeight =
        0.58;

    }else if(
      coverage >= 80
    ){

      modelWeight =
        0.54;

    }else if(
      coverage >= 65
    ){

      modelWeight =
        0.50;

    }else{

      modelWeight =
        0.44;

    }

    const wind =
      Number(
        before
          .weather
          .windSpeed ||
        0
      );

    const wave =
      Number(
        before
          .weather
          .waveHeight ||
        0
      );

    if(
      wind >= 6
      ||
      wave >= 6
    ){

      modelWeight =
        Math.max(
          0.40,
          modelWeight -
          0.06
        );

    }

    const blended =
      blendProbabilities(
        modelProbabilities,
        marketProbabilities,
        modelWeight
      );

    const picks =
      selectBets(
        odds,
        blended,
        marketProbabilities,
        budget,
        coverage,
        before.weather
      );

    const bestProbability =
      picks.length
        ?
        Math.max(
          ...picks.map(
            pick =>
              pick.p
          )
        )
        :
        0;

    const skip =
      picks.length === 0
      ||
      (
        budget <= 500
        &&
        bestProbability < 0.04
      );

    return res
      .status(200)
      .json({

        skip,

        venueName:
          VENUES[
            venue
          ],

        race,

        oddsCount,

        picks:
          skip
            ?
            []
            :
            picks,

        reason:
          skip
            ?
            '全取得データと市場オッズを統合した結果、少額資金で買う根拠が弱いため見送り。'
            :
            '全国/当地成績・平均ST・F/L・モーター/ボート・今節成績・展示タイム/ST/進入・チルト・部品交換・気象・120通りオッズ・蓄積結果補正を統合。',

        meta:{

          model:
            'full-v4.1',

          coverage,

          modelWeight,

          currentMeetDetected:
            raceInfo
              .currentMeetDetected,

          courseBias,

          weather:
            before.weather,

          racers:
            raceInfo.racers,

          exhibition:
            before.boats

        },

        snapshot:{

          racers:
            raceInfo.racers,

          exhibition:
            before.boats,

          weather:
            before.weather,

          coverage,

          modelWeight,

          courseBias

        }

      });

  }catch(
    error
  ){

    return res
      .status(500)
      .json({
        error:
          error.message
          ||
          String(
            error
          )
      });

  }

};

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

const BASE_COURSE_PRIOR = {
  1:.56,
  2:.14,
  3:.12,
  4:.10,
  5:.05,
  6:.03
};

const GRADE_BONUS = {
  A1:.42,
  A2:.18,
  B1:0,
  B2:-.18
};

const strip = s =>
  String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&#39;/gi,"'")
    .replace(/&quot;/gi,'"')
    .replace(/\s+/g,' ')
    .trim();

const lines = s =>
  String(s || '')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/(?:div|p|li|span|td|tr|a)>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .split(/\n+/)
    .map(x => x.replace(/\s+/g,' ').trim())
    .filter(Boolean);

function findMatchingClose(html, tag, openStart) {

  const tokenRe =
    new RegExp(`<\\/?${tag}\\b[^>]*>`,'gi');

  tokenRe.lastIndex =
    openStart;

  let depth = 0;

  let match;

  while(
    (
      match =
        tokenRe.exec(html)
    )
  ){

    if(
      match[0].startsWith('</')
    ){

      depth--;

    }else{

      depth++;

    }

    if(
      depth === 0
    ){

      return tokenRe.lastIndex;

    }

  }

  return -1;

}

function blocksByTag(
  html,
  tag
){

  const output = [];

  const openRe =
    new RegExp(
      `<${tag}\\b[^>]*>`,
      'gi'
    );

  let match;

  while(
    (
      match =
        openRe.exec(html)
    )
  ){

    const end =
      findMatchingClose(
        html,
        tag,
        match.index
      );

    if(
      end < 0
    ){

      break;

    }

    output.push(
      html.slice(
        match.index,
        end
      )
    );

    openRe.lastIndex =
      end;

  }

  return output;

}

function blocksByClass(
  html,
  tag,
  className
){

  return blocksByTag(
    html,
    tag
  )
  .filter(
    block => {

      const open =
        block.match(
          new RegExp(
            `^<${tag}\\b[^>]*>`,
            'i'
          )
        );

      return (
        open
        &&
        new RegExp(
          `class=["'][^"']*\\b${className}\\b`,
          'i'
        )
        .test(
          open[0]
        )
      );

    }
  );

}

const num = value => {

  const number =
    Number(
      String(
        value ?? ''
      )
      .replace(
        /[%,¥,\s]/g,
        ''
      )
    );

  return Number.isFinite(
    number
  )
    ?
    number
    :
    null;

};

const int = value => {

  const number =
    parseInt(
      String(
        value ?? ''
      )
      .replace(
        /\D/g,
        ''
      ),
      10
    );

  return Number.isFinite(
    number
  )
    ?
    number
    :
    null;

};

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

    const number =
      num(
        strip(
          match[1]
        )
      );

    values.push(
      Number.isFinite(
        number
      )
      &&
      number >= 1
        ?
        number
        :
        null
    );

  }

  const odds = {};

  for(
    let index = 0;
    index <
      Math.min(
        values.length,
        120
      );
    index++
  ){

    if(
      values[index] == null
    ){

      continue;

    }

    const combination =
      String(
        ORDER[index]
      );

    odds[
      `${combination[0]}-${combination[1]}-${combination[2]}`
    ] =
      values[index];

  }

  return odds;

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
    blocksByClass(
      html,
      'div',
      'table1'
    );

  const main =
    tables[1];

  if(
    !main
  ){

    return {

      racers,

      currentMeetDetected:false

    };

  }

  const tbodies =
    blocksByTag(
      main,
      'tbody'
    )
    .slice(
      0,
      6
    );

  tbodies.forEach(
    (
      body,
      index
    ) => {

      const lane =
        index + 1;

      const cells =
        blocksByTag(
          body,
          'td'
        );

      if(
        cells.length < 8
      ){

        return;

      }

      const racer =
        racers[lane];

      const idGrade =
        strip(
          cells[2]
        )
        .match(
          /\b(\d{4})\s*\/\s*(A1|A2|B1|B2)\b/
        );

      if(
        idGrade
      ){

        racer.racerId =
          Number(
            idGrade[1]
          );

        racer.grade =
          idGrade[2];

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
          strip(
            nameMatch[1]
          )
          .replace(
            /\s+/g,
            ''
          );

      }

      const detail =
        strip(
          cells[2]
        );

      const age =
        detail.match(
          /(\d{2})歳/
        );

      const weight =
        detail.match(
          /(\d{2}(?:\.\d+)?)kg/
        );

      if(
        age
      ){

        racer.age =
          Number(
            age[1]
          );

      }

      if(
        weight
      ){

        racer.weight =
          Number(
            weight[1]
          );

      }

      const flst =
        strip(
          cells[3]
        );

      const flying =
        flst.match(
          /\bF(\d+)\b/i
        );

      const late =
        flst.match(
          /\bL(\d+)\b/i
        );

      const averageSt =
        flst.match(
          /\b0\.(\d{2})\b/
        );

      racer.fCount =
        flying
          ?
          Number(
            flying[1]
          )
          :
          0;

      racer.lCount =
        late
          ?
          Number(
            late[1]
          )
          :
          0;

      racer.avgSt =
        averageSt
          ?
          Number(
            `0.${averageSt[1]}`
          )
          :
          null;

      const national =
        lines(
          cells[4]
        )
        .map(num)
        .filter(
          Number.isFinite
        );

      if(
        national.length >= 3
      ){

        [
          racer.nationalWin,
          racer.national2,
          racer.national3
        ] =
          national.slice(
            0,
            3
          );

      }

      const local =
        lines(
          cells[5]
        )
        .map(num)
        .filter(
          Number.isFinite
        );

      if(
        local.length >= 3
      ){

        [
          racer.localWin,
          racer.local2,
          racer.local3
        ] =
          local.slice(
            0,
            3
          );

      }

      const motor =
        lines(
          cells[6]
        )
        .map(num)
        .filter(
          Number.isFinite
        );

      if(
        motor.length >= 3
      ){

        [
          racer.motorNo,
          racer.motor2,
          racer.motor3
        ] =
          motor.slice(
            0,
            3
          );

      }

      const boat =
        lines(
          cells[7]
        )
        .map(num)
        .filter(
          Number.isFinite
        );

      if(
        boat.length >= 3
      ){

        [
          racer.boatNo,
          racer.boat2,
          racer.boat3
        ] =
          boat.slice(
            0,
            3
          );

      }

    }
  );

  let currentMeetDetected =
    false;

  for(
    const table
    of tables.slice(2)
  ){

    const rows =
      blocksByTag(
        table,
        'tbody'
      );

    if(
      rows.length < 6
    ){

      continue;

    }

    let totalEntries =
      0;

    const parsed = {};

    for(
      let index = 0;
      index < 6;
      index++
    ){

      const text =
        strip(
          rows[index]
        );

      const entries = [];

      const regex =
        /(?:^|\s)([1-6])\s+(F|L)?\.?([0-3]\d)\s+([1-6])(?=\s|$)/g;

      let match;

      while(
        (
          match =
            regex.exec(
              text
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
              `0.${match[3]}`
            ),

          finish:
            Number(
              match[4]
            ),

          flag:
            match[2] || null

        });

      }

      parsed[
        index + 1
      ] =
        entries;

      totalEntries +=
        entries.length;

    }

    if(
      totalEntries >= 6
    ){

      currentMeetDetected =
        true;

      for(
        let lane = 1;
        lane <= 6;
        lane++
      ){

        racers[
          lane
        ].currentMeet =
          parsed[lane];

      }

      break;

    }

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
    blocksByClass(
      html,
      'div',
      'table1'
    );

  const main =
    tables[1];

  if(
    main
  ){

    const rows =
      blocksByTag(
        main,
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

        const cells =
          blocksByTag(
            row,
            'td'
          );

        const boat =
          boats[
            index + 1
          ];

        if(
          cells[4]
        ){

          boat.exTime =
            num(
              strip(
                cells[4]
              )
            );

        }

        if(
          cells[5]
        ){

          boat.tilt =
            num(
              strip(
                cells[5]
              )
            );

        }

        if(
          cells[7]
        ){

          boat.parts =
            blocksByTag(
              cells[7],
              'li'
            )
            .map(strip)
            .filter(Boolean);

        }

        const open =
          row.match(
            /^<tbody\b[^>]*>/i
          )?.[0] || '';

        boat.isMiss =
          /is-miss/i
            .test(
              open
            );

      }
    );

  }

  const start =
    tables[2];

  if(
    start
  ){

    const rows =
      blocksByTag(
        start,
        'tr'
      )
      .slice(1);

    let course = 0;

    for(
      const row
      of rows
    ){

      const number =
        row.match(
          /table1_boatImage1Number[^>]*>\s*([1-6])/i
        );

      const timing =
        row.match(
          /table1_boatImage1Time[^>]*>\s*(F)?\.?([0-3]\d)/i
        );

      if(
        !number
        ||
        !timing
      ){

        continue;

      }

      course++;

      const lane =
        Number(
          number[1]
        );

      boats[
        lane
      ].exCourse =
        course;

      boats[
        lane
      ].exSt =
        Number(
          `0.${timing[2]}`
        );

      boats[
        lane
      ].exFlying =
        Boolean(
          timing[1]
        );

    }

  }

  const labels =
    blocksByClass(
      html,
      'span',
      'label2'
    )
    .map(strip);

  const weather = {

    temperature:null,

    weather:null,

    windSpeed:null,

    windDirection:null,

    waterTemperature:null,

    waveHeight:null,

    stabilityBoard:
      labels.includes(
        '安定板使用'
      ),

    fixedEntry:
      labels.includes(
        '進入固定'
      )

  };

  const weatherBody =
    blocksByClass(
      html,
      'div',
      'weather1_body'
    )[0];

  if(
    weatherBody
  ){

    const units =
      blocksByClass(
        weatherBody,
        'div',
        'weather1_bodyUnit'
      );

    const getData =
      index => {

        if(
          !units[index]
        ){

          return null;

        }

        const match =
          units[index]
          .match(
            /weather1_bodyUnitLabelData[^>]*>([\s\S]*?)<\/span>/i
          );

        return match
          ?
          strip(
            match[1]
          )
          :
          strip(
            units[index]
          );

      };

    weather.temperature =
      num(
        getData(0)
      );

    const weatherTitle =
      units[1]
      ?.match(
        /weather1_bodyUnitLabelTitle[^>]*>([\s\S]*?)<\/span>/i
      );

    weather.weather =
      weatherTitle
        ?
        strip(
          weatherTitle[1]
        )
        :
        null;

    weather.windSpeed =
      num(
        getData(2)
      );

    weather.waterTemperature =
      num(
        getData(4)
      );

    weather.waveHeight =
      num(
        getData(5)
      );

    const direction =
      weatherBody.match(
        /\bis-wind(\d+)\b/i
      );

    weather.windDirection =
      direction
        ?
        Number(
          direction[1]
        )
        :
        null;

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
    blocksByClass(
      html,
      'div',
      'table1'
    );

  if(
    tables.length < 4
  ){

    return {
      ready:false
    };

  }

  let combo = null;

  let payout = null;

  let popularity = null;

  const payRows =
    blocksByTag(
      tables[3],
      'tbody'
    );

  if(
    payRows[0]
  ){

    const cells =
      blocksByTag(
        payRows[0],
        'td'
      );

    if(
      cells.length >= 4
    ){

      const combination =
        strip(
          cells[1]
        )
        .match(
          /[1-6]\s*-\s*[1-6]\s*-\s*[1-6]/
        );

      combo =
        combination
          ?
          combination[0]
            .replace(
              /\s/g,
              ''
            )
          :
          null;

      payout =
        num(
          strip(
            cells[2]
          )
        );

      popularity =
        int(
          strip(
            cells[3]
          )
        );

    }

  }

  return {

    ready:
      Boolean(
        combo
      ),

    combo,

    payout,

    popularity

  };

}

function parseBias(
  raw
){

  const output = {
    1:1,
    2:1,
    3:1,
    4:1,
    5:1,
    6:1
  };

  try{

    const input =
      JSON.parse(
        String(
          raw || '{}'
        )
      );

    for(
      let lane = 1;
      lane <= 6;
      lane++
    ){

      const value =
        Number(
          input[lane]
        );

      if(
        Number.isFinite(
          value
        )
      ){

        output[lane] =
          Math.max(
            .82,
            Math.min(
              1.18,
              value
            )
          );

      }

    }

  }catch{

  }

  return output;

}

function zScore(
  values,
  target
){

  const valid =
    values.filter(
      Number.isFinite
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

function currentMeetScore(
  entries
){

  if(
    !Array.isArray(
      entries
    )
    ||
    !entries.length
  ){

    return 0;

  }

  const recent =
    entries.slice(
      -6
    );

  const averageFinish =
    recent.reduce(
      (
        total,
        race
      ) =>
        total +
        race.finish,
      0
    )
    /
    recent.length;

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
    .10;

  if(
    Number.isFinite(
      averageStart
    )
  ){

    score +=
      (
        .16 -
        averageStart
      )
      *
      .55;

  }

  return Math.max(
    -.35,
    Math.min(
      .35,
      score
    )
  );

}

function laneStrength(
  lane,
  racer,
  before,
  allRacers,
  allBefore,
  bias
){

  let score =
    Math.log(
      BASE_COURSE_PRIOR[
        lane
      ]
      *
      bias[
        lane
      ]
    );

  score +=
    GRADE_BONUS[
      racer.grade
    ]
    ||
    0;

  const values =
    key =>
      Object.values(
        allRacers
      )
      .map(
        racer =>
          racer[key]
      );

  score +=
    .22
    *
    zScore(
      values(
        'nationalWin'
      ),
      racer.nationalWin
    );

  score +=
    .10
    *
    zScore(
      values(
        'national2'
      ),
      racer.national2
    );

  score +=
    .10
    *
    zScore(
      values(
        'national3'
      ),
      racer.national3
    );

  score +=
    .14
    *
    zScore(
      values(
        'localWin'
      ),
      racer.localWin
    );

  score +=
    .07
    *
    zScore(
      values(
        'local2'
      ),
      racer.local2
    );

  score +=
    .06
    *
    zScore(
      values(
        'local3'
      ),
      racer.local3
    );

  score +=
    .13
    *
    zScore(
      values(
        'motor2'
      ),
      racer.motor2
    );

  score +=
    .07
    *
    zScore(
      values(
        'motor3'
      ),
      racer.motor3
    );

  score +=
    .08
    *
    zScore(
      values(
        'boat2'
      ),
      racer.boat2
    );

  score +=
    .04
    *
    zScore(
      values(
        'boat3'
      ),
      racer.boat3
    );

  score -=
    .12
    *
    zScore(
      values(
        'avgSt'
      ),
      racer.avgSt
    );

  score -=
    Math.min(
      .30,
      (
        racer.fCount ||
        0
      )
      *
      .12
    );

  score -=
    Math.min(
      .15,
      (
        racer.lCount ||
        0
      )
      *
      .08
    );

  score +=
    currentMeetScore(
      racer.currentMeet
    );

  const exhibitionTimes =
    Object.values(
      allBefore
    )
    .map(
      boat =>
        boat.exTime
    );

  const exhibitionStarts =
    Object.values(
      allBefore
    )
    .map(
      boat =>
        boat.exSt
    );

  if(
    Number.isFinite(
      before.exTime
    )
  ){

    score -=
      .20
      *
      zScore(
        exhibitionTimes,
        before.exTime
      );

  }

  if(
    Number.isFinite(
      before.exSt
    )
  ){

    score -=
      .12
      *
      zScore(
        exhibitionStarts,
        before.exSt
      );

  }

  if(
    before.exFlying
  ){

    score -=
      .025;

  }

  if(
    before.isMiss
  ){

    score -=
      .18;

  }

  if(
    Number.isFinite(
      before.exCourse
    )
    &&
    before.exCourse !==
      lane
  ){

    const ratio =
      BASE_COURSE_PRIOR[
        before.exCourse
      ]
      /
      BASE_COURSE_PRIOR[
        lane
      ];

    score +=
      .18
      *
      Math.log(
        ratio
      );

  }

  if(
    Array.isArray(
      before.parts
    )
    &&
    before.parts.length >= 3
  ){

    score -=
      .05;

  }

  return score;

}

function allModelProbabilities(
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

  for(
    const combination
    of ORDER
  ){

    const value =
      String(
        combination
      );

    const first =
      Number(
        value[0]
      );

    const second =
      Number(
        value[1]
      );

    const third =
      Number(
        value[2]
      );

    const total1 =
      Object.values(
        weights
      )
      .reduce(
        (
          total,
          weight
        ) =>
          total +
          weight,
        0
      );

    const p1 =
      weights[
        first
      ]
      /
      total1;

    const total2 =
      total1
      -
      weights[
        first
      ];

    const p2 =
      weights[
        second
      ]
      /
      total2;

    const total3 =
      total2
      -
      weights[
        second
      ];

    const p3 =
      weights[
        third
      ]
      /
      total3;

    probabilities[
      `${first}-${second}-${third}`
    ] =
      p1
      *
      p2
      *
      p3;

  }

  return probabilities;

}

function marketProbabilities(
  odds
){

  const inverse = {};

  let total = 0;

  for(
    const [
      combination,
      odd
    ]
    of Object.entries(
      odds
    )
  ){

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

      total +=
        inverse[
          combination
        ];

    }

  }

  const output = {};

  for(
    const [
      combination,
      value
    ]
    of Object.entries(
      inverse
    )
  ){

    output[
      combination
    ] =
      total
        ?
        value /
        total
        :
        0;

  }

  return output;

}

function blendProbabilities(
  model,
  market,
  modelWeight
){

  const output = {};

  let total = 0;

  for(
    const combination
    of ORDER
  ){

    const value =
      String(
        combination
      );

    const key =
      `${value[0]}-${value[1]}-${value[2]}`;

    const modelProbability =
      Math.max(
        model[key] ||
        1e-9,
        1e-9
      );

    const marketProbability =
      Math.max(
        market[key] ||
        1e-9,
        1e-9
      );

    const probability =
      Math.pow(
        modelProbability,
        modelWeight
      )
      *
      Math.pow(
        marketProbability,
        1 -
        modelWeight
      );

    output[
      key
    ] =
      probability;

    total +=
      probability;

  }

  if(
    total
  ){

    for(
      const key
      of Object.keys(
        output
      )
    ){

      output[
        key
      ] /=
        total;

    }

  }

  return output;

}

function dataCoverage(
  racers,
  beforeInfo,
  currentMeetDetected
){

  let obtained = 0;

  let total = 0;

  const racerKeys = [
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

  for(
    let lane = 1;
    lane <= 6;
    lane++
  ){

    for(
      const key
      of racerKeys
    ){

      total++;

      if(
        racers[
          lane
        ][key] != null
      ){

        obtained++;

      }

    }

    for(
      const key
      of [
        'exTime',
        'exSt',
        'exCourse'
      ]
    ){

      total++;

      if(
        beforeInfo
          .boats[
            lane
          ][key] != null
      ){

        obtained++;

      }

    }

  }

  total += 2;

  if(
    currentMeetDetected
  ){

    obtained++;

  }

  if(
    beforeInfo
      .weather
      .windSpeed != null
    ||
    beforeInfo
      .weather
      .waveHeight != null
  ){

    obtained++;

  }

  return Math.round(
    obtained /
    total *
    100
  );

}

function chooseBets(
  odds,
  finalProbabilities,
  marketProbabilitiesMap,
  budget,
  coverage,
  weather
){

  const units =
    Math.floor(
      Math.max(
        0,
        budget
      )
      /
      100
    );

  if(
    units < 1
  ){

    return [];

  }

  const rows =
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
          finalProbabilities[
            combination
          ] ||
          0;

        const marketProbability =
          marketProbabilitiesMap[
            combination
          ] ||
          0;

        const fairIndex =
          probability
          *
          odd;

        const divergence =
          marketProbability > 0
            ?
            probability /
            marketProbability
            :
            null;

        return {

          combo:
            combination,

          odds:
            odd,

          p:
            probability,

          marketP:
            marketProbability,

          fairIndex,

          divergence

        };

      }
    )
    .filter(
      row =>
        row.odds >= 1
        &&
        Number.isFinite(
          row.p
        )
    );

  const maxOdds =
    units <= 3
      ?
      80
      :
      150;

  let candidates =
    rows.filter(
      row =>
        row.odds <=
        maxOdds
    );

  candidates.forEach(
    row => {

      const edgeBoost =
        Math.max(
          .75,
          Math.min(
            1.25,
            row.divergence ||
            1
          )
        );

      row.rankScore =
        row.p
        *
        Math.pow(
          edgeBoost,
          .35
        )
        *
        Math.pow(
          Math.log1p(
            row.odds
          ),
          .18
        );

    }
  );

  candidates.sort(
    (
      first,
      second
    ) =>
      second.rankScore -
      first.rankScore
      ||
      second.p -
      first.p
  );

  const wind =
    weather?.windSpeed ||
    0;

  const wave =
    weather?.waveHeight ||
    0;

  const uncertaintyPenalty =
    (
      coverage < 75
        ?
        1
        :
        0
    )
    +
    (
      wind >= 6
        ?
        1
        :
        0
    )
    +
    (
      wave >= 6
        ?
        1
        :
        0
    );

  let maxPicks =
    Math.min(
      3,
      units
    );

  if(
    units === 3
    &&
    uncertaintyPenalty > 0
  ){

    maxPicks =
      2;

  }

  if(
    units === 2
    &&
    uncertaintyPenalty > 1
  ){

    maxPicks =
      1;

  }

  const viable =
    candidates
      .filter(
        row =>
          row.p >=
          .025
      )
      .slice(
        0,
        maxPicks
      );

  if(
    !viable.length
  ){

    return [];

  }

  if(
    units <= 3
  ){

    return viable.map(
      row => ({

        ...row,

        amount:
          100

      })
    );

  }

  const selected =
    viable.slice(
      0,
      Math.min(
        3,
        viable.length
      )
    );

  let remainingUnits =
    units;

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

  const output = [];

  selected.forEach(
    (
      row,
      index
    ) => {

      let useUnits;

      if(
        index ===
        selected.length -
        1
      ){

        useUnits =
          remainingUnits;

      }else{

        useUnits =
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

      useUnits =
        Math.min(
          useUnits,
          remainingUnits
          -
          (
            selected.length
            -
            index
            -
            1
          )
        );

      output.push({

        ...row,

        amount:
          useUnits *
          100

      });

      remainingUnits -=
        useUnits;

    }
  );

  return output;

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

    const base =
      'https://www.boatrace.jp/owpc/pc/race';

    const query =
      `?rno=${race}&jcd=${venue}&hd=${date}`;

    if(
      action ===
      'result'
    ){

      const html =
        await fetchText(
          `${base}/raceresult${query}`
        );

      return res
        .status(200)
        .json({

          venueName:
            VENUES[
              venue
            ],

          race,

          ...parseResult(
            html
          )

        });

    }

    const budget =
      Number(
        req.query.budget ||
        1000
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

    const bias =
      parseBias(
        req.query.bias
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
      dataCoverage(

        raceInfo.racers,

        before,

        raceInfo
          .currentMeetDetected

      );

    const strengths = {};

    for(
      let lane = 1;
      lane <= 6;
      lane++
    ){

      strengths[lane] =
        laneStrength(

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

          bias

        );

    }

    const modelProbabilities =
      allModelProbabilities(
        strengths
      );

    const market =
      marketProbabilities(
        odds
      );

    let modelWeight =
      coverage >= 90
        ?
        .58
        :
        coverage >= 80
          ?
          .54
          :
          coverage >= 65
            ?
            .50
            :
            .45;

    const wind =
      before
        .weather
        .windSpeed ||
      0;

    const wave =
      before
        .weather
        .waveHeight ||
      0;

    if(
      wind >= 6
      ||
      wave >= 6
    ){

      modelWeight =
        Math.max(
          .42,
          modelWeight -
          .06
        );

    }

    const finalProbabilities =
      blendProbabilities(

        modelProbabilities,

        market,

        modelWeight

      );

    const picks =
      chooseBets(

        odds,

        finalProbabilities,

        market,

        budget,

        coverage,

        before.weather

      );

    const topProbability =
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
      !picks.length
      ||
      (
        budget <= 500
        &&
        topProbability <
          .04
      );

    const output =
      skip
        ?
        []
        :
        picks.map(
          pick => ({

            combo:
              pick.combo,

            amount:
              pick.amount,

            odds:
              pick.odds,

            p:
              pick.p,

            marketP:
              pick.marketP,

            divergence:
              pick.divergence,

            fairIndex:
              pick.fairIndex

          })
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
          output,

        reason:
          skip

            ?

            '取得データ・市場オッズ・不確実性を統合した結果、少額資金で無理に買う根拠が弱いため見送り。'

            :

            '全国/当地成績、平均ST、F/L、モーター/ボート、今節成績、展示タイム/ST/進入、チルト・部品交換、気象、3連単市場オッズ、蓄積結果補正を統合。',

        meta:{

          model:
            'full-v4-market-calibrated',

          coverage,

          modelWeight,

          currentMeetDetected:
            raceInfo
              .currentMeetDetected,

          courseBias:
            bias,

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

          modelWeight

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

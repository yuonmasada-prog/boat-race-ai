const VENUES={
  '01':'桐生','02':'戸田','03':'江戸川','04':'平和島','05':'多摩川','06':'浜名湖',
  '07':'蒲郡','08':'常滑','09':'津','10':'三国','11':'びわこ','12':'住之江',
  '13':'尼崎','14':'鳴門','15':'丸亀','16':'児島','17':'宮島','18':'徳山',
  '19':'下関','20':'若松','21':'芦屋','22':'福岡','23':'唐津','24':'大村'
};

const ORDER=[
  123,213,312,412,512,612,124,214,314,413,513,613,
  125,215,315,415,514,614,126,216,316,416,516,615,
  132,231,321,421,521,621,134,234,324,423,523,623,
  135,235,325,425,524,624,136,236,326,426,526,625,
  142,241,341,431,531,631,143,243,342,432,532,632,
  145,245,345,435,534,634,146,246,346,436,536,635,
  152,251,351,451,541,641,153,253,352,452,542,642,
  154,254,354,453,543,643,156,256,356,456,546,645,
  162,261,361,461,561,651,163,263,362,462,562,652,
  164,264,364,463,563,653,165,265,365,465,564,654
];

const PRIOR={
  1:.56,
  2:.14,
  3:.12,
  4:.10,
  5:.05,
  6:.03
};

const GRADE={
  A1:.42,
  A2:.18,
  B1:0,
  B2:-.18
};


/* ================================
   短期キャッシュ
================================ */

const CACHE=
  globalThis.__BR_CACHE__
  ||
  new Map();

globalThis.__BR_CACHE__=
  CACHE;


function cached(key){

  const item=
    CACHE.get(key);

  if(!item){
    return null;
  }

  if(
    item.expiresAt
    <=
    Date.now()
  ){

    CACHE.delete(key);

    return null;

  }

  return item.value;

}


function putCache(
  key,
  value,
  ttl
){

  CACHE.set(
    key,
    {
      value,
      expiresAt:
        Date.now()
        +
        ttl
    }
  );

}


/* ================================
   HTML utility
================================ */

function clean(value){

  return String(
    value || ''
  )

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
    /[ \t]+/g,
    ' '
  )

  .replace(
    /\n\s+/g,
    '\n'
  )

  .trim();

}


function compact(value){

  return clean(value)
    .replace(
      /\s+/g,
      ' '
    )
    .trim();

}


function number(value){

  const result=
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
    result
  )
    ?
    result
    :
    null;

}


function tagBlocks(
  html,
  tag
){

  const result=[];

  const regex=
    new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`,
      'gi'
    );

  let match;

  while(
    (
      match=
        regex.exec(html)
    )
  ){

    result.push(
      match[0]
    );

  }

  return result;

}


function tableBlocks(
  html
){

  const starts=[];

  const regex=
    /<div\b[^>]*class=["'][^"']*\btable1\b[^"']*["'][^>]*>/gi;

  let match;

  while(
    (
      match=
        regex.exec(html)
    )
  ){

    starts.push(
      match.index
    );

  }

  return starts.map(
    (
      start,
      index
    ) => {

      const end=
        index + 1
        <
        starts.length

          ?

          starts[
            index + 1
          ]

          :

          html.length;

      return html.slice(
        start,
        end
      );

    }
  );

}


/* ================================
   安定したfetch
================================ */

async function fetchOnce(
  url,
  timeoutMs
){

  const controller=
    new AbortController();

  const timer=
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try{

    const response=
      await fetch(
        url,
        {
          cache:'no-store',
          signal:
            controller.signal
        }
      );

    const text=
      await response.text();

    if(
      !response.ok
    ){

      throw new Error(
        `HTTP ${response.status}`
      );

    }

    return text;

  }finally{

    clearTimeout(
      timer
    );

  }

}


async function fetchReliable(
  url,
  key,
  ttl
){

  const hit=
    cached(key);

  if(hit){

    return {
      ok:true,
      text:hit,
      source:'cache'
    };

  }

  let lastError=
    null;

  for(
    let attempt=0;
    attempt<2;
    attempt++
  ){

    try{

      const text=
        await fetchOnce(
          url,
          2200
        );

      putCache(
        key,
        text,
        ttl
      );

      return {
        ok:true,
        text,
        source:'network'
      };

    }catch(error){

      lastError=
        error;

      if(
        attempt === 0
      ){

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              120
            )
        );

      }

    }

  }

  return {
    ok:false,

    error:
      lastError?.name
      ===
      'AbortError'

        ?

        'timeout'

        :

        (
          lastError?.message
          ||
          'fetch failed'
        )
  };

}


/* ================================
   オッズ
================================ */

function parseOdds(html){

  const values=[];

  const regex=
    /<td[^>]*class=["'][^"']*\boddsPoint\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi;

  let match;

  while(
    (
      match=
        regex.exec(html)
    )
  ){

    values.push(
      number(
        compact(
          match[1]
        )
      )
    );

  }

  const result={};

  for(
    let index=0;
    index<
      Math.min(
        values.length,
        120
      );
    index++
  ){

    const odd=
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

    const s=
      String(
        ORDER[index]
      );

    result[
      `${s[0]}-${s[1]}-${s[2]}`
    ]=
      odd;

  }

  return result;

}


/* ================================
   出走表
================================ */

function emptyRacer(lane){

  return {
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


function numericCell(cell){

  return clean(cell)
    .split(
      /\s+/
    )
    .map(
      number
    )
    .filter(
      Number.isFinite
    );

}


function parseRaceList(html){

  const racers={};

  for(
    let lane=1;
    lane<=6;
    lane++
  ){

    racers[lane]=
      emptyRacer(
        lane
      );

  }

  const tables=
    tableBlocks(
      html
    );

  const main=
    tables[1];

  if(!main){

    return {
      racers,
      currentMeetDetected:false
    };

  }

  const rows=
    tagBlocks(
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

      const lane=
        index + 1;

      const racer=
        racers[lane];

      const cells=
        tagBlocks(
          row,
          'td'
        );

      if(
        cells.length < 8
      ){

        return;

      }

      const identity=
        compact(
          cells[2]
        );

      const id=
        identity.match(
          /\b(\d{4})\s*\/\s*(A1|A2|B1|B2)\b/
        );

      if(id){

        racer.racerId=
          Number(
            id[1]
          );

        racer.grade=
          id[2];

      }

      const name=
        cells[2]
          .match(
            /<a\b[^>]*>([\s\S]*?)<\/a>/i
          );

      if(name){

        racer.name=
          compact(
            name[1]
          )
          .replace(
            /\s/g,
            ''
          );

      }

      const age=
        identity.match(
          /(\d{2})歳/
        );

      const weight=
        identity.match(
          /(\d{2}(?:\.\d+)?)kg/
        );

      if(age){

        racer.age=
          Number(
            age[1]
          );

      }

      if(weight){

        racer.weight=
          Number(
            weight[1]
          );

      }

      const status=
        compact(
          cells[3]
        );

      const f=
        status.match(
          /\bF(\d+)\b/i
        );

      const l=
        status.match(
          /\bL(\d+)\b/i
        );

      const st=
        status.match(
          /\b0\.(\d{2})\b/
        );

      racer.fCount=
        f
          ?
          Number(
            f[1]
          )
          :
          0;

      racer.lCount=
        l
          ?
          Number(
            l[1]
          )
          :
          0;

      racer.avgSt=
        st
          ?
          Number(
            `0.${st[1]}`
          )
          :
          null;


      const national=
        numericCell(
          cells[4]
        );

      if(
        national.length >= 3
      ){

        racer.nationalWin=
          national[0];

        racer.national2=
          national[1];

        racer.national3=
          national[2];

      }


      const local=
        numericCell(
          cells[5]
        );

      if(
        local.length >= 3
      ){

        racer.localWin=
          local[0];

        racer.local2=
          local[1];

        racer.local3=
          local[2];

      }


      const motor=
        numericCell(
          cells[6]
        );

      if(
        motor.length >= 3
      ){

        racer.motorNo=
          motor[0];

        racer.motor2=
          motor[1];

        racer.motor3=
          motor[2];

      }


      const boat=
        numericCell(
          cells[7]
        );

      if(
        boat.length >= 3
      ){

        racer.boatNo=
          boat[0];

        racer.boat2=
          boat[1];

        racer.boat3=
          boat[2];

      }

    }
  );


  let currentMeetDetected=
    false;

  const page=
    clean(
      html
    );

  const meetPosition=
    page.indexOf(
      '今節成績'
    );

  if(
    meetPosition >= 0
  ){

    const meetText=
      page.slice(
        meetPosition
      );

    for(
      let lane=1;
      lane<=6;
      lane++
    ){

      const entries=[];

      const regex=
        new RegExp(
          `(?:^|\\s)${lane}\\s+([1-6])\\s+(?:F|L)?\\.?([0-3]\\d)\\s+([1-6])`,
          'g'
        );

      let match;

      while(
        (
          match=
            regex.exec(
              meetText
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

        if(
          entries.length >= 8
        ){

          break;

        }

      }

      racers[
        lane
      ].currentMeet=
        entries;

      if(
        entries.length > 0
      ){

        currentMeetDetected=
          true;

      }

    }

  }


  return {
    racers,
    currentMeetDetected
  };

}


/* ================================
   直前・展示
================================ */

function parseBeforeInfo(html){

  const boats={};

  for(
    let lane=1;
    lane<=6;
    lane++
  ){

    boats[lane]={
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

  const tables=
    tableBlocks(
      html
    );

  const main=
    tables[1];

  if(main){

    const rows=
      tagBlocks(
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

        const boat=
          boats[
            index + 1
          ];

        const cells=
          tagBlocks(
            row,
            'td'
          );

        if(cells[4]){

          boat.exTime=
            number(
              compact(
                cells[4]
              )
            );

        }

        if(cells[5]){

          boat.tilt=
            number(
              compact(
                cells[5]
              )
            );

        }

        if(cells[7]){

          boat.parts=
            tagBlocks(
              cells[7],
              'li'
            )
            .map(
              compact
            )
            .filter(Boolean);

        }

        boat.isMiss=
          /is-miss/i
            .test(
              row
            );

      }
    );

  }


  const start=
    tables[2];

  if(start){

    let course=
      0;

    for(
      const row
      of tagBlocks(
        start,
        'tr'
      )
    ){

      const lane=
        row.match(
          /table1_boatImage1Number[^>]*>\s*([1-6])/i
        );

      const st=
        row.match(
          /table1_boatImage1Time[^>]*>\s*(F)?\.?([0-3]\d)/i
        );

      if(
        !lane
        ||
        !st
      ){

        continue;

      }

      course++;

      const laneNumber=
        Number(
          lane[1]
        );

      boats[
        laneNumber
      ].exCourse=
        course;

      boats[
        laneNumber
      ].exSt=
        Number(
          `0.${st[2]}`
        );

      boats[
        laneNumber
      ].exFlying=
        Boolean(
          st[1]
        );

    }

  }


  const text=
    clean(
      html
    );


  function getNumber(regex){

    const match=
      text.match(
        regex
      );

    return match
      ?
      Number(
        match[1]
      )
      :
      null;

  }


  const weather={

    temperature:
      getNumber(
        /気温\s*([0-9.]+)\s*℃/
      ),

    weather:
      [
        '晴',
        '曇り',
        '曇',
        '雨',
        '雪'
      ]
      .find(
        item =>
          text.includes(
            item
          )
      )
      ||
      null,

    windSpeed:
      getNumber(
        /風速\s*([0-9.]+)\s*m/
      ),

    windDirection:
      null,

    waterTemperature:
      getNumber(
        /水温\s*([0-9.]+)\s*℃/
      ),

    waveHeight:
      getNumber(
        /波高\s*([0-9.]+)\s*cm/
      ),

    stabilityBoard:
      text.includes(
        '安定板使用'
      ),

    fixedEntry:
      text.includes(
        '進入固定'
      )

  };


  const direction=
    html.match(
      /\bis-wind(\d+)\b/i
    );

  if(direction){

    weather.windDirection=
      Number(
        direction[1]
      );

  }


  return {
    boats,
    weather
  };

}


/* ================================
   結果
================================ */

function parseResult(html){

  const tables=
    tableBlocks(
      html
    );

  if(
    tables.length < 4
  ){

    return {
      ready:false
    };

  }

  const body=
    tagBlocks(
      tables[3],
      'tbody'
    )[0];

  if(!body){

    return {
      ready:false
    };

  }

  const cells=
    tagBlocks(
      body,
      'td'
    );

  if(
    cells.length < 3
  ){

    return {
      ready:false
    };

  }

  const combo=
    compact(
      cells[1]
    )
    .match(
      /([1-6])\s*-\s*([1-6])\s*-\s*([1-6])/
    );

  if(!combo){

    return {
      ready:false
    };

  }

  return {

    ready:true,

    combo:
      `${combo[1]}-${combo[2]}-${combo[3]}`,

    payout:
      number(
        compact(
          cells[2]
        )
      ),

    popularity:
      cells[3]
        ?
        Number(
          compact(
            cells[3]
          )
          .match(
            /\d+/
          )?.[0]
          ||
          0
        )
        :
        null

  };

}


/* ================================
   学習補正
================================ */

function readBias(query){

  const result={};

  for(
    let lane=1;
    lane<=6;
    lane++
  ){

    const value=
      Number(
        query[
          `b${lane}`
        ]
      );

    result[lane]=
      Math.max(
        .82,
        Math.min(
          1.18,
          Number.isFinite(
            value
          )
            ?
            value
            :
            1
        )
      );

  }

  return result;

}


/* ================================
   モデル
================================ */

function zScore(
  values,
  target
){

  const valid=
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

  const mean=
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

  const variance=
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

  const standardDeviation=
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

  const recent=
    races.slice(
      -6
    );

  const finishes=
    recent.filter(
      race =>
        Number.isFinite(
          race.finish
        )
    );

  if(
    finishes.length === 0
  ){

    return 0;

  }

  const averageFinish=
    finishes.reduce(
      (
        total,
        race
      ) =>
        total +
        race.finish,
      0
    )
    /
    finishes.length;

  const starts=
    recent.filter(
      race =>
        Number.isFinite(
          race.st
        )
    );

  const averageStart=
    starts.length
      ?
      starts.reduce(
        (
          total,
          race
        ) =>
          total +
          race.st,
        0
      )
      /
      starts.length
      :
      null;

  let score=
    (
      3.5 -
      averageFinish
    )
    *
    .09;

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
      .45;

  }

  return Math.max(
    -.30,
    Math.min(
      .30,
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


function laneStrength(
  lane,
  racer,
  exhibition,
  racers,
  allExhibition,
  bias
){

  let score=
    Math.log(
      PRIOR[lane]
      *
      bias[lane]
    );

  score +=
    GRADE[
      racer.grade
    ]
    ||
    0;


  score +=
    .20 *
    zScore(
      racerValues(
        racers,
        'nationalWin'
      ),
      racer.nationalWin
    );

  score +=
    .08 *
    zScore(
      racerValues(
        racers,
        'national2'
      ),
      racer.national2
    );

  score +=
    .08 *
    zScore(
      racerValues(
        racers,
        'national3'
      ),
      racer.national3
    );

  score +=
    .13 *
    zScore(
      racerValues(
        racers,
        'localWin'
      ),
      racer.localWin
    );

  score +=
    .06 *
    zScore(
      racerValues(
        racers,
        'local2'
      ),
      racer.local2
    );

  score +=
    .05 *
    zScore(
      racerValues(
        racers,
        'local3'
      ),
      racer.local3
    );

  score +=
    .13 *
    zScore(
      racerValues(
        racers,
        'motor2'
      ),
      racer.motor2
    );

  score +=
    .06 *
    zScore(
      racerValues(
        racers,
        'motor3'
      ),
      racer.motor3
    );

  score +=
    .07 *
    zScore(
      racerValues(
        racers,
        'boat2'
      ),
      racer.boat2
    );

  score +=
    .04 *
    zScore(
      racerValues(
        racers,
        'boat3'
      ),
      racer.boat3
    );

  score -=
    .11 *
    zScore(
      racerValues(
        racers,
        'avgSt'
      ),
      racer.avgSt
    );


  score -=
    Math.min(
      .32,
      (
        racer.fCount ||
        0
      )
      *
      .13
    );


  score -=
    Math.min(
      .16,
      (
        racer.lCount ||
        0
      )
      *
      .08
    );


  score +=
    recentMeetScore(
      racer.currentMeet
    );


  const exhibitionTimes=
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
      .19 *
      zScore(
        exhibitionTimes,
        exhibition.exTime
      );

  }


  const exhibitionStarts=
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
      .11 *
      zScore(
        exhibitionStarts,
        exhibition.exSt
      );

  }


  if(
    exhibition.exFlying
  ){

    score -=
      .03;

  }


  if(
    exhibition.isMiss
  ){

    score -=
      .18;

  }


  if(
    Number.isFinite(
      exhibition.exCourse
    )
    &&
    exhibition.exCourse !==
      lane
  ){

    score +=
      .18 *
      Math.log(
        PRIOR[
          exhibition.exCourse
        ]
        /
        PRIOR[
          lane
        ]
      );

  }


  if(
    exhibition.parts?.length >= 3
  ){

    score -=
      .05;

  }


  return score;

}


function modelProbabilities(
  strengths
){

  const weights={};

  for(
    let lane=1;
    lane<=6;
    lane++
  ){

    weights[lane]=
      Math.exp(
        strengths[lane]
      );

  }


  const total=
    Object.values(
      weights
    )
    .reduce(
      (
        sum,
        value
      ) =>
        sum + value,
      0
    );


  const result={};


  for(
    const value
    of ORDER
  ){

    const s=
      String(
        value
      );

    const first=
      Number(
        s[0]
      );

    const second=
      Number(
        s[1]
      );

    const third=
      Number(
        s[2]
      );


    const p1=
      weights[first]
      /
      total;


    const secondTotal=
      total -
      weights[first];


    const p2=
      weights[second]
      /
      secondTotal;


    const thirdTotal=
      secondTotal -
      weights[second];


    const p3=
      weights[third]
      /
      thirdTotal;


    result[
      `${first}-${second}-${third}`
    ]=
      p1 *
      p2 *
      p3;

  }


  return result;

}


function marketProbabilities(
  odds
){

  const inverse={};

  let total=
    0;


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
      odd > 0
    ){

      inverse[
        combination
      ]=
        1 /
        odd;

      total +=
        inverse[
          combination
        ];

    }

  }


  const result={};


  for(
    const [
      combination,
      value
    ]
    of Object.entries(
      inverse
    )
  ){

    result[
      combination
    ]=
      value /
      total;

  }


  return result;

}


function blendProbabilities(
  model,
  market,
  modelWeight
){

  const result={};

  let total=
    0;


  for(
    const value
    of ORDER
  ){

    const s=
      String(
        value
      );

    const key=
      `${s[0]}-${s[1]}-${s[2]}`;


    const modelProbability=
      Math.max(
        model[key] ||
        0,
        1e-9
      );


    const marketProbability=
      Math.max(
        market[key] ||
        0,
        1e-9
      );


    const probability=
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


    result[key]=
      probability;


    total +=
      probability;

  }


  for(
    const key
    of Object.keys(
      result
    )
  ){

    result[key] /=
      total;

  }


  return result;

}


/* ================================
   データ完全性
================================ */

function coverage(
  racers,
  before,
  currentMeetDetected
){

  const racerFields=[
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


  const beforeFields=[
    'exTime',
    'exSt',
    'exCourse'
  ];


  let total=0;
  let obtained=0;


  for(
    let lane=1;
    lane<=6;
    lane++
  ){

    for(
      const field
      of racerFields
    ){

      total++;

      if(
        racers[
          lane
        ][
          field
        ] != null
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
        before
          .boats[
            lane
          ][
            field
          ] != null
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
    before
      .weather
      .windSpeed != null
    &&
    before
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


function criticalData(
  racers,
  before,
  oddsCount
){

  const missing=[];


  if(
    oddsCount < 100
  ){

    missing.push(
      '3連単オッズ'
    );

  }


  for(
    let lane=1;
    lane<=6;
    lane++
  ){

    const racer=
      racers[lane];

    const exhibition=
      before
        .boats[
          lane
        ];


    if(!racer.grade){
      missing.push(`${lane}号艇級別`);
    }

    if(racer.avgSt == null){
      missing.push(`${lane}号艇平均ST`);
    }

    if(racer.nationalWin == null){
      missing.push(`${lane}号艇全国勝率`);
    }

    if(racer.motor2 == null){
      missing.push(`${lane}号艇モーター`);
    }

    if(racer.boat2 == null){
      missing.push(`${lane}号艇ボート`);
    }

    if(exhibition.exTime == null){
      missing.push(`${lane}号艇展示タイム`);
    }

    if(exhibition.exSt == null){
      missing.push(`${lane}号艇展示ST`);
    }

    if(exhibition.exCourse == null){
      missing.push(`${lane}号艇展示進入`);
    }

  }


  if(
    before
      .weather
      .windSpeed == null
  ){

    missing.push(
      '風速'
    );

  }


  if(
    before
      .weather
      .waveHeight == null
  ){

    missing.push(
      '波高'
    );

  }


  return {

    ok:
      missing.length === 0,

    missing

  };

}


/* ================================
   買い目
================================ */

function chooseBets(
  odds,
  probabilities,
  market,
  budget,
  weather
){

  const units=
    Math.floor(
      budget /
      100
    );

  if(
    units < 1
  ){

    return [];

  }


  let rows=
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

        const probability=
          probabilities[
            combination
          ]
          ||
          0;


        const marketProbability=
          market[
            combination
          ]
          ||
          0;


        const divergence=
          marketProbability > 0
            ?
            probability /
            marketProbability
            :
            1;


        let oddsPenalty=
          1;


        if(
          odd > 100
        ){

          oddsPenalty=
            .50;

        }else if(
          odd > 60
        ){

          oddsPenalty=
            .68;

        }else if(
          odd > 30
        ){

          oddsPenalty=
            .82;

        }


        const edge=
          Math.max(
            .80,
            Math.min(
              1.25,
              divergence
            )
          );


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

          score:
            probability
            *
            Math.pow(
              edge,
              .30
            )
            *
            oddsPenalty

        };

      }
    );


  rows=
    rows.filter(
      row =>
        row.odds >= 1
        &&
        row.odds <=
          (
            units <= 3
              ?
              80
              :
              150
          )
    );


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


  const unstable=
    (
      weather.windSpeed ||
      0
    )
    >=
    6
    ||
    (
      weather.waveHeight ||
      0
    )
    >=
    6;


  const maxPicks=
    Math.min(
      unstable
        ?
        2
        :
        3,
      units
    );


  const selected=
    rows
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


  const totalProbability=
    selected.reduce(
      (
        sum,
        row
      ) =>
        sum +
        row.p,
      0
    );


  let remaining=
    units;


  return selected.map(
    (
      row,
      index
    ) => {

      let use=
        index ===
        selected.length - 1

          ?

          remaining

          :

          Math.max(
            1,
            Math.floor(
              units
              *
              row.p
              /
              totalProbability
            )
          );


      use=
        Math.min(
          use,
          remaining
          -
          (
            selected.length
            -
            index
            -
            1
          )
        );


      remaining -=
        use;


      return {
        ...row,
        amount:
          use *
          100
      };

    }
  );

}


/* ================================
   API
================================ */

module.exports=
async function handler(
  req,
  res
){

  const started=
    Date.now();


  try{

    const action=
      String(
        req.query.action ||
        'predict'
      );


    const date=
      String(
        req.query.date ||
        ''
      )
      .replace(
        /[-/]/g,
        ''
      );


    const venue=
      String(
        req.query.venue ||
        ''
      )
      .padStart(
        2,
        '0'
      );


    const race=
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


    const base=
      'https://www.boatrace.jp/owpc/pc/race';


    const query=
      `?rno=${race}&jcd=${venue}&hd=${date}`;


    const key=
      `${date}_${venue}_${race}`;


    if(
      action ===
      'result'
    ){

      const resultFetch=
        await fetchReliable(

          `${base}/raceresult${query}`,

          `result_${key}`,

          5000

        );


      if(
        !resultFetch.ok
      ){

        return res
          .status(200)
          .json({

            ready:false,

            venueName:
              VENUES[
                venue
              ],

            race,

            reason:
              '公式結果ページの応答が遅いため未取得。'

          });

      }


      return res
        .status(200)
        .json({

          venueName:
            VENUES[
              venue
            ],

          race,

          ...parseResult(
            resultFetch.text
          )

        });

    }


    const budget=
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


    const courseBias=
      readBias(
        req.query
      );


    /*
      3ページ同時取得。
      1ページ最大2.2秒 × 2回。
      他ページを待ち続けてVercel全体を
      504にしない。
    */

    const [
      oddsFetch,
      raceFetch,
      beforeFetch
    ]=

      await Promise.all([

        fetchReliable(

          `${base}/odds3t${query}`,

          `odds_${key}`,

          8000

        ),

        fetchReliable(

          `${base}/racelist${query}`,

          `race_${key}`,

          60000

        ),

        fetchReliable(

          `${base}/beforeinfo${query}`,

          `before_${key}`,

          15000

        )

      ]);


    const fetchStatus={

      odds:
        oddsFetch.ok
          ?
          oddsFetch.source
          :
          oddsFetch.error,

      raceList:
        raceFetch.ok
          ?
          raceFetch.source
          :
          raceFetch.error,

      beforeInfo:
        beforeFetch.ok
          ?
          beforeFetch.source
          :
          beforeFetch.error

    };


    /*
      重要ページのどれかが取れなければ
      精度を落とした予想はしない。
    */

    if(
      !oddsFetch.ok
      ||
      !raceFetch.ok
      ||
      !beforeFetch.ok
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

          oddsCount:0,

          picks:[],

          reason:
            '重要データの取得が完了しなかったため、精度を落とした予想は出さず見送り。',

          meta:{

            model:
              'full-v4.2-stable',

            coverage:0,

            fetchStatus,

            elapsedMs:
              Date.now()
              -
              started,

            criticalMissing:true

          }

        });

    }


    const odds=
      parseOdds(
        oddsFetch.text
      );


    const raceInfo=
      parseRaceList(
        raceFetch.text
      );


    const before=
      parseBeforeInfo(
        beforeFetch.text
      );


    const oddsCount=
      Object.keys(
        odds
      ).length;


    const dataCoverage=
      coverage(

        raceInfo.racers,

        before,

        raceInfo
          .currentMeetDetected

      );


    const critical=
      criticalData(

        raceInfo.racers,

        before,

        oddsCount

      );


    /*
      重要項目欠損 または
      取得率85%未満なら
      予想しない。
    */

    if(
      !critical.ok
      ||
      dataCoverage < 85
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
            '重要データが不足しているため、精度優先で予想を見送り。',

          meta:{

            model:
              'full-v4.2-stable',

            coverage:
              dataCoverage,

            fetchStatus,

            missingCritical:
              critical.missing,

            currentMeetDetected:
              raceInfo
                .currentMeetDetected,

            weather:
              before.weather,

            racers:
              raceInfo.racers,

            exhibition:
              before.boats,

            elapsedMs:
              Date.now()
              -
              started

          }

        });

    }


    const strengths={};


    for(
      let lane=1;
      lane<=6;
      lane++
    ){

      strengths[lane]=
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

          raceInfo.racers,

          before.boats,

          courseBias

        );

    }


    const model=
      modelProbabilities(
        strengths
      );


    const market=
      marketProbabilities(
        odds
      );


    let modelWeight=
      dataCoverage >= 95

        ?

        .60

        :

        dataCoverage >= 90

          ?

          .57

          :

          .53;


    if(
      (
        before
          .weather
          .windSpeed ||
        0
      )
      >=
      6
      ||
      (
        before
          .weather
          .waveHeight ||
        0
      )
      >=
      6
    ){

      modelWeight=
        Math.max(
          .47,
          modelWeight -
          .05
        );

    }


    const blended=
      blendProbabilities(

        model,

        market,

        modelWeight

      );


    const picks=
      chooseBets(

        odds,

        blended,

        market,

        budget,

        before.weather

      );


    const bestProbability=
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


    const skip=
      !picks.length
      ||
      (
        budget <= 500
        &&
        bestProbability <
          .04
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

            '必要データは取得できたが、買い条件を満たす組み合わせが弱いため見送り。'

            :

            '全国/当地成績・平均ST・F/L・モーター/ボート・今節成績・展示タイム/ST/進入・チルト・部品交換・気象・120通りオッズ・蓄積結果補正を統合。',

        meta:{

          model:
            'full-v4.2-stable',

          coverage:
            dataCoverage,

          modelWeight,

          fetchStatus,

          currentMeetDetected:
            raceInfo
              .currentMeetDetected,

          courseBias,

          weather:
            before.weather,

          racers:
            raceInfo.racers,

          exhibition:
            before.boats,

          elapsedMs:
            Date.now()
            -
            started

        },

        snapshot:{

          racers:
            raceInfo.racers,

          exhibition:
            before.boats,

          weather:
            before.weather,

          coverage:
            dataCoverage,

          modelWeight,

          courseBias

        }

      });


  }catch(error){

    return res
      .status(500)
      .json({

        error:
          error.message
          ||
          String(
            error
          ),

        elapsedMs:
          Date.now()
          -
          started

      });

  }

};

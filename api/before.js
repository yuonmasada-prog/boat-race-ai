const VENUES={
  '01':'桐生','02':'戸田','03':'江戸川','04':'平和島','05':'多摩川','06':'浜名湖',
  '07':'蒲郡','08':'常滑','09':'津','10':'三国','11':'びわこ','12':'住之江',
  '13':'尼崎','14':'鳴門','15':'丸亀','16':'児島','17':'宮島','18':'徳山',
  '19':'下関','20':'若松','21':'芦屋','22':'福岡','23':'唐津','24':'大村'
};

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

  return clean(
    value
  )
  .replace(
    /\s+/g,
    ' '
  )
  .trim();

}

function toNumber(value){

  const n=
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
    n
  )
    ?
    n
    :
    null;

}

function blocks(
  html,
  tag
){

  const output=[];

  const regex=
    new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`,
      'gi'
    );

  let match;

  while(
    (
      match=
        regex.exec(
          html
        )
    )
  ){

    output.push(
      match[0]
    );

  }

  return output;

}

function table1Blocks(
  html
){

  const starts=[];

  const regex=
    /<div\b[^>]*class=["'][^"']*\btable1\b[^"']*["'][^>]*>/gi;

  let match;

  while(
    (
      match=
        regex.exec(
          html
        )
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

async function fetchWithTimeout(
  url,
  timeoutMs=5000
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

function emptyBoat(
  lane
){

  return {
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

function parseBefore(
  html
){

  const boats={};

  for(
    let lane=1;
    lane<=6;
    lane++
  ){

    boats[lane]=
      emptyBoat(
        lane
      );

  }


  const tables=
    table1Blocks(
      html
    );


  let mainTable=
    null;


  for(
    const table
    of tables
  ){

    const text=
      compact(
        table
      );

    const rows=
      blocks(
        table,
        'tbody'
      );


    if(
      rows.length >= 6
      &&
      /展示タイム/.test(
        text
      )
      &&
      /チルト/.test(
        text
      )
    ){

      mainTable=
        table;

      break;

    }

  }


  if(
    mainTable
  ){

    const rows=
      blocks(
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

        const lane=
          index + 1;


        const boat=
          boats[
            lane
          ];


        const cells=
          blocks(
            row,
            'td'
          );


        /*
        公式HTMLの列構成に合わせる。
        展示タイム・チルト・部品交換。
        */

        if(
          cells.length >= 5
        ){

          const candidates=
            cells
            .map(
              cell =>
                toNumber(
                  compact(
                    cell
                  )
                )
            );


          const exhibitionCandidate=
            candidates.find(
              value =>
                Number.isFinite(
                  value
                )
                &&
                value >= 6.2
                &&
                value <= 7.3
            );


          if(
            exhibitionCandidate != null
          ){

            boat.exTime=
              exhibitionCandidate;

          }

        }


        if(
          cells.length >= 6
        ){

          const text=
            compact(
              cells[5]
            );


          const tilt=
            text.match(
              /[-+]?\d+(?:\.\d+)?/
            );


          if(
            tilt
          ){

            boat.tilt=
              Number(
                tilt[0]
              );

          }

        }


        const liParts=
          blocks(
            row,
            'li'
          )
          .map(
            compact
          )
          .filter(Boolean);


        if(
          liParts.length
        ){

          boat.parts=
            liParts;

        }


        boat.isMiss=
          /is-miss/i
            .test(
              row
            );

      }
    );

  }


  /*
  スタート展示
  */

  let startTable=
    null;


  for(
    const table
    of tables
  ){

    if(
      /table1_boatImage1Number/i
        .test(
          table
        )
      &&
      /table1_boatImage1Time/i
        .test(
          table
        )
    ){

      startTable=
        table;

      break;

    }

  }


  if(
    startTable
  ){

    let course=
      0;


    const rows=
      blocks(
        startTable,
        'tr'
      );


    for(
      const row
      of rows
    ){

      const laneMatch=
        row.match(
          /table1_boatImage1Number[^>]*>\s*([1-6])/i
        );


      const stMatch=
        row.match(
          /table1_boatImage1Time[^>]*>\s*(F)?\.?([0-3]\d)/i
        );


      if(
        !laneMatch
        ||
        !stMatch
      ){

        continue;

      }


      course++;


      const lane=
        Number(
          laneMatch[1]
        );


      boats[
        lane
      ].exCourse=
        course;


      boats[
        lane
      ].exSt=
        Number(
          `0.${stMatch[2]}`
        );


      boats[
        lane
      ].exFlying=
        Boolean(
          stMatch[1]
        );

    }

  }


  /*
  テーブル解析で取れなかった場合の
  展示タイム fallback
  */

  const pageText=
    clean(
      html
    );


  const fallbackTimes=
    [
      ...pageText.matchAll(
        /\b6\.(\d{2})\b/g
      )
    ]
    .map(
      match =>
        Number(
          `6.${match[1]}`
        )
    )
    .filter(
      value =>
        value >= 6.2
        &&
        value <= 7.3
    );


  if(
    fallbackTimes.length >= 6
  ){

    const lastSix=
      fallbackTimes.slice(
        -6
      );


    for(
      let lane=1;
      lane<=6;
      lane++
    ){

      if(
        boats[
          lane
        ].exTime == null
      ){

        boats[
          lane
        ].exTime=
          lastSix[
            lane - 1
          ];

      }

    }

  }


  /*
  展示ST fallback
  */

  const fallbackStarts=
    [
      ...pageText.matchAll(
        /(?:^|\s)(F)?\.?([0-3]\d)(?=\s|$)/g
      )
    ]
    .map(
      match => ({
        flying:
          Boolean(
            match[1]
          ),

        value:
          Number(
            `0.${match[2]}`
          )
      })
    )
    .filter(
      item =>
        item.value >= 0
        &&
        item.value <= .40
    );


  if(
    fallbackStarts.length >= 6
  ){

    const lastSix=
      fallbackStarts.slice(
        -6
      );


    for(
      let lane=1;
      lane<=6;
      lane++
    ){

      if(
        boats[
          lane
        ].exSt == null
      ){

        boats[
          lane
        ].exSt=
          lastSix[
            lane - 1
          ].value;


        boats[
          lane
        ].exFlying=
          lastSix[
            lane - 1
          ].flying;

      }

    }

  }


  /*
  水面気象
  */

  function getNumber(
    regex
  ){

    const match=
      pageText.match(
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

    weather:null,

    windSpeed:
      getNumber(
        /風速\s*([0-9.]+)\s*m/
      ),

    windDirection:null,

    waterTemperature:
      getNumber(
        /水温\s*([0-9.]+)\s*℃/
      ),

    waveHeight:
      getNumber(
        /波高\s*([0-9.]+)\s*cm/
      ),

    stabilityBoard:
      pageText.includes(
        '安定板使用'
      ),

    fixedEntry:
      pageText.includes(
        '進入固定'
      )

  };


  const weatherLabels=[
    '晴',
    '曇り',
    '曇',
    '雨',
    '雪'
  ];


  for(
    const label
    of weatherLabels
  ){

    if(
      pageText.includes(
        label
      )
    ){

      weather.weather=
        label;

      break;

    }

  }


  const direction=
    html.match(
      /\bis-wind(\d+)\b/i
    );


  if(
    direction
  ){

    weather.windDirection=
      Number(
        direction[1]
      );

  }


  const parsedCount=
    Object.values(
      boats
    )
    .filter(
      boat =>
        boat.exTime != null
        &&
        boat.exSt != null
        &&
        boat.exCourse != null
    )
    .length;


  return {

    boats,

    weather,

    parserOk:
      parsedCount === 6
      &&
      weather.windSpeed != null
      &&
      weather.waveHeight != null,

    parsedCount

  };

}


module.exports=
async function handler(
  req,
  res
){

  const started=
    Date.now();


  try{

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

          ok:false,

          error:
            '入力値が不正です'

        });

    }


    const url=
      `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${race}&jcd=${venue}&hd=${date}`;


    const html=
      await fetchWithTimeout(
        url,
        5000
      );


    const parsed=
      parseBefore(
        html
      );


    return res
      .status(200)
      .json({

        ok:
          parsed.parserOk,

        venueName:
          VENUES[
            venue
          ],

        race,

        source:
          'official-beforeinfo',

        elapsedMs:
          Date.now()
          -
          started,

        ...parsed

      });


  }catch(
    error
  ){

    const timeout=
      error?.name ===
      'AbortError';


    return res
      .status(200)
      .json({

        ok:false,

        error:
          timeout

            ?

            'before-data-timeout'

            :

            (
              error?.message
              ||
              String(
                error
              )
            ),

        elapsedMs:
          Date.now()
          -
          started

      });

  }

};

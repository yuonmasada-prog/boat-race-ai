const VENUES={
  '01':'桐生','02':'戸田','03':'江戸川','04':'平和島','05':'多摩川','06':'浜名湖',
  '07':'蒲郡','08':'常滑','09':'津','10':'三国','11':'びわこ','12':'住之江',
  '13':'尼崎','14':'鳴門','15':'丸亀','16':'児島','17':'宮島','18':'徳山',
  '19':'下関','20':'若松','21':'芦屋','22':'福岡','23':'唐津','24':'大村'
};

function clean(value){
  return String(value||'')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/(?:div|p|li|span|td|tr|a|tbody)>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/[ \t]+/g,' ')
    .replace(/\n\s+/g,'\n')
    .trim();
}

function compact(value){
  return clean(value)
    .replace(/\s+/g,' ')
    .trim();
}

function toNumber(value){
  const n=
    Number(
      String(value??'')
        .replace(/[%,¥,\s]/g,'')
    );

  return Number.isFinite(n)
    ?
    n
    :
    null;
}

function blocks(
  html,
  tag
){
  const out=[];

  const re=
    new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`,
      'gi'
    );

  let match;

  while(
    (
      match=
        re.exec(html)
    )
  ){
    out.push(
      match[0]
    );
  }

  return out;
}

function table1Blocks(html){

  const starts=[];

  const re=
    /<div\b[^>]*class=["'][^"']*\btable1\b[^"']*["'][^>]*>/gi;

  let match;

  while(
    (
      match=
        re.exec(html)
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

function numericValues(cell){

  return clean(cell)
    .split(/\s+/)
    .map(
      toNumber
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
    table1Blocks(
      html
    );

  let main=
    null;


  /*
  出走表の本体テーブルを
  固定indexではなく
  内容で探す
  */

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
      /登番/.test(
        text
      )
      &&
      /級別/.test(
        text
      )
      &&
      /モーター/.test(
        text
      )
    ){

      main=
        table;

      break;

    }

  }


  if(
    !main
  ){

    return {
      racers,
      currentMeetDetected:false,
      parserOk:false,
      parsedCount:0
    };

  }


  const rows=
    blocks(
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
        racers[
          lane
        ];

      const cells=
        blocks(
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


      const idMatch=
        identity.match(
          /\b(\d{4})\s*\/\s*(A1|A2|B1|B2)\b/
        );


      if(
        idMatch
      ){

        racer.racerId=
          Number(
            idMatch[1]
          );

        racer.grade=
          idMatch[2];

      }


      const nameMatch=
        cells[2]
          .match(
            /<a\b[^>]*>([\s\S]*?)<\/a>/i
          );


      if(
        nameMatch
      ){

        racer.name=
          compact(
            nameMatch[1]
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


      if(
        age
      ){
        racer.age=
          Number(
            age[1]
          );
      }


      if(
        weight
      ){
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
        numericValues(
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
        numericValues(
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
        numericValues(
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
        numericValues(
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


  /*
  今節成績
  */

  let currentMeetDetected=
    false;


  const page=
    clean(
      html
    );


  const meetPos=
    page.indexOf(
      '今節成績'
    );


  if(
    meetPos >= 0
  ){

    const meet=
      page.slice(
        meetPos
      );


    for(
      let lane=1;
      lane<=6;
      lane++
    ){

      const entries=[];


      const laneRegex=
        new RegExp(
          `(?:^|\\n)${lane}(?:\\n|\\s)`,
          'g'
        );


      const laneMatch=
        laneRegex.exec(
          meet
        );


      if(
        !laneMatch
      ){
        continue;
      }


      const window=
        meet.slice(
          laneMatch.index,
          laneMatch.index + 1200
        );


      const raceRegex=
        /\b([1-6])\s+(F|L)?\.?([0-3]\d)\s+([1-6])\b/g;


      let raceMatch;


      while(
        (
          raceMatch=
            raceRegex.exec(
              window
            )
        )
      ){

        entries.push({

          course:
            Number(
              raceMatch[1]
            ),

          flag:
            raceMatch[2]
            ||
            null,

          st:
            Number(
              `0.${raceMatch[3]}`
            ),

          finish:
            Number(
              raceMatch[4]
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
        entries.length
      ){
        currentMeetDetected=
          true;
      }

    }

  }


  const parsedCount=
    Object.values(
      racers
    )
    .filter(
      racer =>
        racer.grade
        &&
        racer.avgSt != null
        &&
        racer.nationalWin != null
        &&
        racer.motor2 != null
        &&
        racer.boat2 != null
    )
    .length;


  return {

    racers,

    currentMeetDetected,

    parserOk:
      parsedCount === 6,

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
      `https://www.boatrace.jp/owpc/pc/race/racelist?rno=${race}&jcd=${venue}&hd=${date}`;


    /*
    このFunctionでは
    出走表1ページしか取得しない。

    前版のように
    3ページを1関数で待たない。
    */

    const html=
      await fetchWithTimeout(
        url,
        5000
      );


    const parsed=
      parseRaceList(
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
          'official-racelist',

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

            'race-data-timeout'

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

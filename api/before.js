const https = require('node:https');
const dns = require('node:dns');
const core = require('../lib/boat-race-core');

const VENUES={
  '01':'桐生','02':'戸田','03':'江戸川','04':'平和島','05':'多摩川','06':'浜名湖',
  '07':'蒲郡','08':'常滑','09':'津','10':'三国','11':'びわこ','12':'住之江',
  '13':'尼崎','14':'鳴門','15':'丸亀','16':'児島','17':'宮島','18':'徳山',
  '19':'下関','20':'若松','21':'芦屋','22':'福岡','23':'唐津','24':'大村'
};

function clean(value){
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/(?:div|p|li|span|td|tr|a|tbody|dd|dt)>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&minus;|&#8722;/gi,'-')
    .replace(/[ \t]+/g,' ')
    .replace(/\n\s+/g,'\n')
    .trim();
}

function compact(value){
  return clean(value)
    .replace(/\s+/g,' ')
    .trim();
}

function numberFrom(value){
  const match=
    String(value ?? '')
      .replace(/,/g,'')
      .match(/-?\d+(?:\.\d+)?/);

  if(!match){
    return null;
  }

  const n=
    Number(match[0]);

  return Number.isFinite(n)
    ? n
    : null;
}

function tagBlocks(html,tag){
  const out=[];

  const re=
    new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`,
      'gi'
    );

  let match;

  while((match=re.exec(html))){
    out.push(match[0]);
  }

  return out;
}

function lookupIPv4(
  hostname,
  options,
  callback
){
  dns.lookup(
    hostname,
    {
      family:4,
      all:false
    },
    callback
  );
}

function fetchOfficial(
  url,
  timeoutMs=20000
){
  return new Promise(
    (resolve,reject)=>{

      const target=
        new URL(url);

      let settled=false;

      const fail=
        error=>{

          if(settled){
            return;
          }

          settled=true;
          reject(error);
        };

      const req=
        https.request(
          {
            protocol:'https:',

            hostname:
              target.hostname,

            port:443,

            path:
              target.pathname +
              target.search,

            method:'GET',

            family:4,

            lookup:
              lookupIPv4,

            servername:
              target.hostname,

            agent:false,

            headers:{
              'User-Agent':
                'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',

              'Accept':
                'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',

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

          response=>{

            const chunks=[];

            response.on(
              'data',
              chunk=>{
                chunks.push(chunk);
              }
            );

            response.on(
              'end',
              ()=>{

                if(settled){
                  return;
                }

                settled=true;

                const body=
                  Buffer
                    .concat(chunks)
                    .toString('utf8');

                if(
                  response.statusCode < 200 ||
                  response.statusCode >= 300
                ){

                  const error=
                    new Error(
                      `HTTP ${response.statusCode}`
                    );

                  error.code=
                    'UPSTREAM_HTTP';

                  return reject(error);
                }

                resolve(body);
              }
            );
          }
        );

      req.setTimeout(
        timeoutMs,
        ()=>{

          const error=
            new Error(
              'official-request-timeout'
            );

          error.code=
            'UPSTREAM_TIMEOUT';

          req.destroy(error);
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

function emptyBoat(lane){
  return {
    lane,

    exTime:null,

    weight:null,

    tilt:null,

    parts:[],

    isMiss:false,

    exCourse:null,

    exSt:null,

    exFlying:false
  };
}

function extractExhibitionRows(html){
  const tbodies=
    tagBlocks(
      html,
      'tbody'
    );

  const candidates=[];

  for(
    const tbody
    of tbodies
  ){

    const cells=
      tagBlocks(
        tbody,
        'td'
      );

    if(
      cells.length < 4
    ){
      continue;
    }

    const text=
      compact(
        tbody
      );

    const values=
      [
        ...text.matchAll(
          /\b([6-7]\.\d{2})\b/g
        )
      ]
      .map(
        match =>
          Number(
            match[1]
          )
      );

    if(
      values.some(
        value =>
          value >= 6.2 &&
          value <= 7.3
      )
    ){
      candidates.push(
        tbody
      );
    }
  }

  return candidates.slice(
    0,
    6
  );
}

function parseExhibition(
  html,
  boats
){
  const rows=
    extractExhibitionRows(
      html
    );

  rows.forEach(
    (
      row,
      index
    )=>{

      const lane=
        index + 1;

      const boat=
        boats[lane];

      const cells=
        tagBlocks(
          row,
          'td'
        );

      const rowText=
        compact(
          row
        );

      const exMatch=
        rowText.match(
          /\b([6-7]\.\d{2})\b/
        );

      if(exMatch){

        const value=
          Number(
            exMatch[1]
          );

        if(
          value >= 6.2 &&
          value <= 7.3
        ){
          boat.exTime=
            value;
        }
      }

      // v11 body weight
      const weightMatch=
        rowText.match(
          /\b([4-6]\d(?:\.\d+)?)\s*kg\b/i
        );

      if(weightMatch){
        boat.weight=
          Number(
            weightMatch[1]
          );
      }


      const tiltCandidates=[];

      for(
        const cell
        of cells
      ){

        const text=
          compact(
            cell
          );

        const match=
          text.match(
            /(?:^|\s)([-+]?\d+(?:\.\d+)?)(?:\s|$)/
          );

        if(match){

          const value=
            Number(
              match[1]
            );

          if(
            value >= -0.5 &&
            value <= 3.0
          ){
            tiltCandidates.push(
              value
            );
          }
        }
      }

      if(
        tiltCandidates.length
      ){

        boat.tilt=
          tiltCandidates[
            tiltCandidates.length - 1
          ];
      }

      const parts=
        tagBlocks(
          row,
          'li'
        )
        .map(
          compact
        )
        .filter(
          Boolean
        );

      if(
        parts.length
      ){
        boat.parts=
          parts;
      }

      if(
        /is-miss|欠場|展示なし/i
          .test(
            rowText
          )
      ){
        boat.isMiss=
          true;
      }
    }
  );

  if(
    rows.length < 6
  ){

    const page=
      clean(
        html
      );

    const times=
      [
        ...page.matchAll(
          /\b([6-7]\.\d{2})\b/g
        )
      ]
      .map(
        match =>
          Number(
            match[1]
          )
      )
      .filter(
        value =>
          value >= 6.2 &&
          value <= 7.3
      );

    const firstSix=
      times.slice(
        0,
        6
      );

    if(
      firstSix.length >= 6
    ){

      for(
        let lane=1;
        lane<=6;
        lane++
      ){

        if(
          boats[lane]
            .exTime == null
        ){

          boats[lane]
            .exTime=
              firstSix[
                lane - 1
              ];
        }
      }
    }
  }
}

function parseStartExhibition(
  html,
  boats
){
  const numberRegex=
    /table1_boatImage1Number[^>]*>[\s\S]*?([1-6])[\s\S]*?<\/[^>]+>/gi;

  const timeRegex=
    /table1_boatImage1Time[^>]*>[\s\S]*?(F)?\.?([0-3]\d)[\s\S]*?<\/[^>]+>/gi;

  const lanes=[];
  const starts=[];

  let match;

  while(
    (
      match=
        numberRegex.exec(
          html
        )
    )
  ){
    lanes.push(
      Number(
        match[1]
      )
    );
  }

  while(
    (
      match=
        timeRegex.exec(
          html
        )
    )
  ){

    starts.push({
      flying:
        Boolean(
          match[1]
        ),

      st:
        Number(
          `0.${match[2]}`
        )
    });
  }

  if(
    lanes.length >= 6 &&
    starts.length >= 6
  ){

    for(
      let course=1;
      course<=6;
      course++
    ){

      const lane=
        lanes[
          course - 1
        ];

      if(
        !boats[lane]
      ){
        continue;
      }

      boats[lane]
        .exCourse=
          course;

      boats[lane]
        .exSt=
          starts[
            course - 1
          ].st;

      boats[lane]
        .exFlying=
          starts[
            course - 1
          ].flying;
    }

    return;
  }

  const rows=
    tagBlocks(
      html,
      'tr'
    );

  let course=0;

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
      !laneMatch ||
      !stMatch
    ){
      continue;
    }

    course++;

    const lane=
      Number(
        laneMatch[1]
      );

    boats[lane]
      .exCourse=
        course;

    boats[lane]
      .exSt=
        Number(
          `0.${stMatch[2]}`
        );

    boats[lane]
      .exFlying=
        Boolean(
          stMatch[1]
        );

    if(
      course >= 6
    ){
      break;
    }
  }
}

function parseWeather(html){
  const page=
    clean(
      html
    );

  const get=
    regex=>{

      const match=
        page.match(
          regex
        );

      return match
        ?
        Number(
          match[1]
        )
        :
        null;
    };

  let weather=null;

  for(
    const label
    of [
      '晴',
      '曇り',
      '曇',
      '雨',
      '雪'
    ]
  ){

    if(
      page.includes(
        label
      )
    ){
      weather=
        label;

      break;
    }
  }

  const direction=
    html.match(
      /\bis-wind(\d+)\b/i
    );

  return {
    temperature:
      get(
        /気温\s*([0-9.]+)\s*℃/
      ),

    weather,

    windSpeed:
      get(
        /風速\s*([0-9.]+)\s*m(?:\/s)?/i
      ),

    windDirection:
      direction
        ?
        Number(
          direction[1]
        )
        :
        null,

    waterTemperature:
      get(
        /水温\s*([0-9.]+)\s*℃/
      ),

    waveHeight:
      get(
        /波高\s*([0-9.]+)\s*cm/
      ),

    stabilityBoard:
      page.includes(
        '安定板使用'
      ),

    fixedEntry:
      page.includes(
        '進入固定'
      )
  };
}

function parseBefore(html){
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

  parseExhibition(
    html,
    boats
  );

  parseStartExhibition(
    html,
    boats
  );

  const weather=
    parseWeather(
      html
    );

  const parsedCount=
    Object
      .values(
        boats
      )
      .filter(
        boat =>
          boat.exTime != null &&
          boat.exSt != null &&
          boat.exCourse != null
      )
      .length;

  return {
    boats,

    weather,

    parserOk:
      parsedCount === 6 &&
      weather.windSpeed != null &&
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
      ) ||
      !VENUES[venue] ||
      !Number.isInteger(
        race
      ) ||
      race < 1 ||
      race > 12
    ){

      return res
        .status(400)
        .json({
          ok:false,
          error:'入力値が不正です'
        });
    }

    const url=
      `https://www.boatrace.jp/owpc/pc/race/beforeinfo?rno=${race}&jcd=${venue}&hd=${date}`;

    const html=
      await core.withRetry(
        ()=>fetchOfficial(
          url,
          9000
        ),
        { attempts:2, retryDelayMs:100 }
      );

    const parsed=
      parseBefore(
        html
      );

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    return res
      .status(200)
      .json({
        ok:
          parsed.parserOk,

        venueName:
          VENUES[venue],

        race,

        source:
          'official-beforeinfo-v4',

        transport:
          'node-https-ipv4',

        fetchedAt:
          new Date().toISOString(),

        dataQuality:{
          score:
            parsed.parserOk ? 100 : Math.round(parsed.parsedCount / 6 * 80),
          status:
            parsed.parserOk ? 'good' : 'poor',
          completeBoats:
            parsed.parsedCount
        },

        warnings:
          parsed.parserOk ? [] : ['before-parser-incomplete'],

        errors:
          parsed.parserOk ? [] : ['before-data-quality-insufficient'],

        htmlLength:
          html.length,

        elapsedMs:
          Date.now() -
          started,

        ...parsed
      });

  }catch(error){

    return res
      .status(200)
      .json({
        ok:false,

        error:
          error?.code ===
          'UPSTREAM_TIMEOUT'
            ?
            'before-data-timeout'
            :
            (
              error?.message ||
              String(error)
            ),

        code:
          error?.code ||
          null,

        elapsedMs:
          Date.now() -
          started
      });
  }
};

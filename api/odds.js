const https = require('node:https');
const dns = require('node:dns');

const VENUES={
  '01':'桐生','02':'戸田','03':'江戸川','04':'平和島',
  '05':'多摩川','06':'浜名湖','07':'蒲郡','08':'常滑',
  '09':'津','10':'三国','11':'びわこ','12':'住之江',
  '13':'尼崎','14':'鳴門','15':'丸亀','16':'児島',
  '17':'宮島','18':'徳山','19':'下関','20':'若松',
  '21':'芦屋','22':'福岡','23':'唐津','24':'大村'
};

const ORDER=[
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

function clean(value){
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/\s+/g,' ')
    .trim();
}

function toNumber(value){
  const n=
    Number(
      String(value ?? '')
        .replace(/[%,¥,\s]/g,'')
    );

  return Number.isFinite(n)
    ? n
    : null;
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
                'Mozilla/5.0',

              'Accept':
                'text/html,*/*',

              'Accept-Encoding':
                'identity',

              'Connection':
                'close'
            }
          },

          response=>{

            const chunks=[];

            response.on(
              'data',
              chunk=>
                chunks.push(chunk)
            );

            response.on(
              'end',
              ()=>{

                if(settled){
                  return;
                }

                settled=true;

                const body=
                  Buffer.concat(
                    chunks
                  ).toString(
                    'utf8'
                  );

                if(
                  response.statusCode < 200
                  ||
                  response.statusCode >= 300
                ){
                  return reject(
                    new Error(
                      `HTTP ${response.statusCode}`
                    )
                  );
                }

                resolve(body);
              }
            );
          }
        );

      req.setTimeout(
        timeoutMs,
        ()=>{
          req.destroy(
            new Error(
              'official-request-timeout'
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

async function fetchText(
  url,
  timeoutMs=10000
){
  const controller=
    new AbortController();

  const timer=
    setTimeout(
      ()=>controller.abort(),
      timeoutMs
    );

  try{

    const response=
      await fetch(
        url,
        {
          signal:
            controller.signal,

          cache:
            'no-store'
        }
      );

    if(
      !response.ok
    ){
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    return await response.text();

  }finally{
    clearTimeout(timer);
  }
}

function parseCsvLine(line){
  const cells=[];
  let current='';
  let quoted=false;

  for(
    let i=0;
    i<line.length;
    i++
  ){
    const char=
      line[i];

    if(char === '"'){

      if(
        quoted
        &&
        line[i+1] === '"'
      ){
        current += '"';
        i++;
      }else{
        quoted=
          !quoted;
      }

      continue;
    }

    if(
      char === ','
      &&
      !quoted
    ){
      cells.push(current);
      current='';
      continue;
    }

    current += char;
  }

  cells.push(current);

  return cells;
}

function parseCsv(text){
  const lines=
    String(text || '')
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
      );

  if(
    lines.length < 2
  ){
    return [];
  }

  const headers=
    parseCsvLine(
      lines[0]
    );

  return lines
    .slice(1)
    .map(
      line => {

        const cells=
          parseCsvLine(
            line
          );

        const row={};

        headers.forEach(
          (
            header,
            index
          )=>{
            row[header]=
              cells[index]
              ?? '';
          }
        );

        return row;
      }
    );
}

function parseTrifecta(
  html
){
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
      toNumber(
        clean(
          match[1]
        )
      )
    );
  }

  const odds={};

  for(
    let index=0;
    index<
      Math.min(
        values.length,
        ORDER.length
      );
    index++
  ){

    const odd=
      values[index];

    if(
      !Number.isFinite(odd)
      ||
      odd < 1
    ){
      continue;
    }

    const combo=
      String(
        ORDER[index]
      );

    odds[
      `${combo[0]}-${combo[1]}-${combo[2]}`
    ]=
      odd;
  }

  return{
    odds,
    count:
      Object.keys(
        odds
      ).length,
    rawCount:
      values.length
  };
}

function raceCode(
  date,
  venue,
  race
){
  return(
    date
    +
    venue
    +
    String(
      race
    ).padStart(
      2,
      '0'
    )
  );
}

function extractOdds(
  row,
  prefix
){
  const result={};

  if(!row){
    return result;
  }

  for(
    const [
      key,
      raw
    ]
    of Object.entries(
      row
    )
  ){

    if(
      !key.startsWith(
        prefix
      )
    ){
      continue;
    }

    const odd=
      toNumber(raw);

    if(
      odd === null
      ||
      odd <= 0
    ){
      continue;
    }

    const combo=
      key
        .slice(
          prefix.length
        )
        .replace(
          /=/g,
          '='
        );

    result[
      combo
    ]=
      odd;
  }

  return result;
}

function marketProbabilities(
  odds
){
  let total=0;
  const inverse={};

  for(
    const [
      combo,
      odd
    ]
    of Object.entries(
      odds || {}
    )
  ){

    if(
      Number.isFinite(odd)
      &&
      odd > 0
    ){
      inverse[combo]=
        1 / odd;

      total +=
        inverse[combo];
    }
  }

  const output={};

  for(
    const [
      combo,
      value
    ]
    of Object.entries(
      inverse
    )
  ){
    output[combo]=
      total
        ? value / total
        : 0;
  }

  return output;
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
        req.query.date
        ||
        ''
      )
      .replace(
        /[-/]/g,
        ''
      );

    const venue=
      String(
        req.query.venue
        ||
        ''
      )
      .padStart(
        2,
        '0'
      );

    const race=
      Number(
        req.query.race
        ||
        1
      );

    if(
      !/^\d{8}$/.test(date)
      ||
      !VENUES[venue]
      ||
      !Number.isInteger(race)
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

    const officialUrl=
      `https://www.boatrace.jp/owpc/pc/race/odds3t?rno=${race}&jcd=${venue}&hd=${date}`;

    const yyyy=
      date.slice(0,4);

    const mm=
      date.slice(4,6);

    const dd=
      date.slice(6,8);

    const base=
      'https://boatracecsv.github.io/data/previews';

    const code=
      raceCode(
        date,
        venue,
        race
      );

    const [
      officialResult,
      od1Result,
      od2Result
    ]=
      await Promise.allSettled([

        fetchOfficial(
          officialUrl,
          20000
        ),

        fetchText(
          `${base}/od1/${yyyy}/${mm}/${dd}.csv`
        ),

        fetchText(
          `${base}/od2/${yyyy}/${mm}/${dd}.csv`
        )

      ]);

    let odds={};
    let officialCount=0;
    let rawCount=0;

    if(
      officialResult.status
      ===
      'fulfilled'
    ){

      const parsed=
        parseTrifecta(
          officialResult.value
        );

      odds=
        parsed.odds;

      officialCount=
        parsed.count;

      rawCount=
        parsed.rawCount;
    }

    let row1=null;
    let row2=null;

    if(
      od1Result.status
      ===
      'fulfilled'
    ){
      row1=
        parseCsv(
          od1Result.value
        )
        .find(
          row =>
            String(
              row['レースコード']
              ||
              ''
            )
            ===
            code
        )
        ||
        null;
    }

    if(
      od2Result.status
      ===
      'fulfilled'
    ){
      row2=
        parseCsv(
          od2Result.value
        )
        .find(
          row =>
            String(
              row['レースコード']
              ||
              ''
            )
            ===
            code
        )
        ||
        null;
    }

    const odds3f=
      extractOdds(
        row1,
        '3連複_'
      );

    const odds2t=
      extractOdds(
        row2,
        '2連単_'
      );

    const odds2f=
      extractOdds(
        row2,
        '2連複_'
      );

    const ok=
      officialCount >= 100;

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    return res
      .status(200)
      .json({

        ok,

        venueName:
          VENUES[venue],

        race,

        source:
          'official-3t+boatracecsv-multibet-v12',

        oddsCount:
          officialCount,

        rawOddsPointCount:
          rawCount,

        odds,

        marketProbabilities:
          marketProbabilities(
            odds
          ),

        odds3f,
        odds2t,
        odds2f,

        market3f:
          marketProbabilities(
            odds3f
          ),

        market2t:
          marketProbabilities(
            odds2t
          ),

        market2f:
          marketProbabilities(
            odds2f
          ),

        multibetReady:
          (
            Object.keys(
              odds3f
            ).length > 0
            &&
            Object.keys(
              odds2t
            ).length > 0
            &&
            Object.keys(
              odds2f
            ).length > 0
          ),

        counts:{
          trifecta:
            Object.keys(
              odds
            ).length,

          trio:
            Object.keys(
              odds3f
            ).length,

          exacta:
            Object.keys(
              odds2t
            ).length,

          quinella:
            Object.keys(
              odds2f
            ).length
        },

        elapsedMs:
          Date.now()
          -
          started

      });

  }catch(error){

    return res
      .status(500)
      .json({
        ok:false,
        error:
          error.message
          ||
          'odds-error'
      });
  }
};

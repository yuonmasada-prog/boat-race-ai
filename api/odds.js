const https = require('node:https');
const dns = require('node:dns');

const VENUES={
  '01':'桐生','02':'戸田','03':'江戸川','04':'平和島','05':'多摩川','06':'浜名湖',
  '07':'蒲郡','08':'常滑','09':'津','10':'三国','11':'びわこ','12':'住之江',
  '13':'尼崎','14':'鳴門','15':'丸亀','16':'児島','17':'宮島','18':'徳山',
  '19':'下関','20':'若松','21':'芦屋','22':'福岡','23':'唐津','24':'大村'
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

    const value=
      toNumber(
        clean(
          match[1]
        )
      );

    values.push(
      value
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
      !Number.isFinite(odd) ||
      odd < 1
    ){
      continue;
    }

    const combination=
      String(
        ORDER[index]
      );

    odds[
      `${combination[0]}-${combination[1]}-${combination[2]}`
    ]=
      odd;
  }

  return {
    odds,
    rawOddsPointCount:
      values.length
  };
}

function createMarketProbabilities(
  odds
){
  const inverse={};

  let total=0;

  for(
    const [
      combo,
      odd
    ]
    of Object.entries(
      odds
    )
  ){

    if(
      Number.isFinite(odd) &&
      odd > 0
    ){

      inverse[combo]=
        1 / odd;

      total +=
        inverse[combo];
    }
  }

  const probabilities={};

  for(
    const [
      combo,
      value
    ]
    of Object.entries(
      inverse
    )
  ){

    probabilities[combo]=
      total
        ? value / total
        : 0;
  }

  return probabilities;
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
      !/^\d{8}$/.test(date) ||
      !VENUES[venue] ||
      !Number.isInteger(race) ||
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
      `https://www.boatrace.jp/owpc/pc/race/odds3t?rno=${race}&jcd=${venue}&hd=${date}`;

    const html=
      await fetchOfficial(
        url,
        20000
      );

    const parsed=
      parseOdds(
        html
      );

    const odds=
      parsed.odds;

    const oddsCount=
      Object
        .keys(
          odds
        )
        .length;

    if(
      parsed.rawOddsPointCount !== 120 ||
      oddsCount < 100
    ){

      return res
        .status(200)
        .json({
          ok:false,

          venueName:
            VENUES[venue],

          race,

          source:
            'official-odds3t-v4',

          transport:
            'node-https-ipv4',

          htmlLength:
            html.length,

          rawOddsPointCount:
            parsed.rawOddsPointCount,

          oddsCount,

          error:
            'odds-incomplete',

          elapsedMs:
            Date.now() -
            started
        });
    }

    const marketProbabilities=
      createMarketProbabilities(
        odds
      );

    res.setHeader(
      'Cache-Control',
      'no-store'
    );

    return res
      .status(200)
      .json({
        ok:true,

        venueName:
          VENUES[venue],

        race,

        source:
          'official-odds3t-v4',

        transport:
          'node-https-ipv4',

        htmlLength:
          html.length,

        rawOddsPointCount:
          parsed.rawOddsPointCount,

        oddsCount,

        odds,

        marketProbabilities,

        elapsedMs:
          Date.now() -
          started
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
            'odds-data-timeout'
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

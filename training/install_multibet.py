from __future__ import annotations

from pathlib import Path


ODDS_API = r'''const https = require('node:https');
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
'''


MULTIBET_JS = r'''
function aggregateBetProbabilities(
  trifecta
){

  const trio={};
  const exacta={};
  const quinella={};

  for(
    const [
      combo,
      probability
    ]
    of Object.entries(
      trifecta
    )
  ){

    const boats=
      combo
        .replace(
          /-/g,
          ''
        )
        .split('')
        .map(Number);

    if(
      boats.length !== 3
    ){
      continue;
    }

    const [
      first,
      second
    ]=
      boats;

    const trioKey=
      [...boats]
        .sort(
          (
            a,
            b
          ) =>
            a - b
        )
        .join('=');

    const exactaKey=
      `${first}-${second}`;

    const quinellaKey=
      [
        first,
        second
      ]
        .sort(
          (
            a,
            b
          ) =>
            a - b
        )
        .join('=');

    trio[trioKey]=
      (
        trio[trioKey]
        ||
        0
      )
      +
      probability;

    exacta[exactaKey]=
      (
        exacta[exactaKey]
        ||
        0
      )
      +
      probability;

    quinella[quinellaKey]=
      (
        quinella[quinellaKey]
        ||
        0
      )
      +
      probability;
  }

  return{
    trifecta,
    trio,
    exacta,
    quinella
  };
}


function betTypeDefinitions(){

  return{

    trifecta:{
      label:
        '3連単',
      uniform:
        1 / 120,
      safer:
        0.94
    },

    trio:{
      label:
        '3連複',
      uniform:
        1 / 20,
      safer:
        1.08
    },

    exacta:{
      label:
        '2連単',
      uniform:
        1 / 30,
      safer:
        1.02
    },

    quinella:{
      label:
        '2連複',
      uniform:
        1 / 15,
      safer:
        1.12
    }

  };

}


function oddsForType(
  oddsData,
  type
){

  if(
    type ===
    'trifecta'
  ){
    return(
      oddsData?.odds
      ||
      {}
    );
  }

  if(
    type ===
    'trio'
  ){
    return(
      oddsData?.odds3f
      ||
      {}
    );
  }

  if(
    type ===
    'exacta'
  ){
    return(
      oddsData?.odds2t
      ||
      {}
    );
  }

  return(
    oddsData?.odds2f
    ||
    {}
  );

}


function marketForType(
  oddsData,
  type
){

  if(
    type ===
    'trifecta'
  ){
    return(
      oddsData?.marketProbabilities
      ||
      {}
    );
  }

  if(
    type ===
    'trio'
  ){
    return(
      oddsData?.market3f
      ||
      {}
    );
  }

  if(
    type ===
    'exacta'
  ){
    return(
      oddsData?.market2t
      ||
      {}
    );
  }

  return(
    oddsData?.market2f
    ||
    {}
  );

}


function formatBetCombo(
  combo
){
  return String(
    combo
  );
}


function multiBetRecommendation(
  modelTrifecta,
  oddsData
){

  const definitions=
    betTypeDefinitions();

  const models=
    aggregateBetProbabilities(
      modelTrifecta
    );

  const candidates=[];

  for(
    const type
    of Object.keys(
      definitions
    )
  ){

    const pure=
      models[type];

    const market=
      marketForType(
        oddsData,
        type
      );

    const combined=
      Object.keys(
        market
      ).length
        ?
        combineMarket(
          pure,
          market
        )
        :
        pure;

    const odds=
      oddsForType(
        oddsData,
        type
      );

    const ranked=
      rankPredictions(
        combined,
        pure,
        odds
      );

    const first=
      ranked[0]
      ||
      null;

    const second=
      ranked[1]
      ||
      null;

    if(!first){
      continue;
    }

    const margin=
      second
        ?
        Math.max(
          first.p
          -
          second.p,
          0
        )
        :
        first.p;

    const definition=
      definitions[
        type
      ];

    const concentration=
      first.p
      /
      definition.uniform;

    const marginStrength=
      margin
      /
      definition.uniform;

    const oddsReady=
      first.odd !== null;

    const score=
      (
        Math.log(
          1
          +
          Math.max(
            concentration,
            0
          )
        )
        *
        definition.safer
      )
      +
      Math.min(
        marginStrength,
        4
      )
      *
      0.10
      +
      (
        oddsReady
          ?
          0.08
          :
          0
      );

    candidates.push({

      type,

      label:
        definition.label,

      ranked,

      pure,

      combined,

      market,

      odds,

      top:
        first,

      margin,

      score

    });

  }

  candidates.sort(
    (
      a,
      b
    ) =>
      b.score
      -
      a.score
  );

  return{

    recommended:
      candidates[0]
      ||
      null,

    types:
      candidates

  };

}


function chooseMultiBets(
  recommendation,
  budget
){

  const recommended=
    recommendation?.recommended;

  if(
    !recommended
    ||
    budget < 100
  ){
    return [];
  }

  const definition=
    betTypeDefinitions()[
      recommended.type
    ];

  const minimumProbability=
    definition.uniform
    *
    1.45;

  const candidates=
    recommended.ranked

      .filter(
        item =>
          item.odd !== null
          &&
          item.odd >= 1
          &&
          item.odd <= 200
          &&
          item.p >=
            minimumProbability
      )

      .map(
        item => ({
          ...item,

          betType:
            recommended.type,

          betTypeLabel:
            recommended.label,

          score:
            item.p
            *
            Math.min(
              Math.sqrt(
                item.odd
              ),
              8
            )
        })
      )

      .sort(
        (
          a,
          b
        ) =>
          b.score
          -
          a.score
      );

  if(
    !candidates.length
  ){
    return [];
  }

  const units=
    Math.floor(
      budget / 100
    );

  let count=1;

  if(
    units >= 4
  ){
    count=2;
  }

  if(
    units >= 8
  ){
    count=3;
  }

  const selected=
    candidates.slice(
      0,
      count
    );

  let remaining=
    units * 100;

  selected.forEach(
    (
      item,
      index
    )=>{

      const slots=
        selected.length
        -
        index;

      const amount=
        index ===
        selected.length - 1
          ?
          remaining
          :
          Math.max(
            100,
            Math.floor(
              remaining
              /
              slots
              /
              100
            )
            *
            100
          );

      item.amount=
        amount;

      remaining -=
        amount;
    }
  );

  return selected;

}


function renderMultiPredictions(
  recommendation,
  mode
){

  const items=
    recommendation?.types
    ||
    [];

  $('predictionArea')
    .classList
    .remove(
      'hidden'
    );

  $('predictions').innerHTML=
    items
      .map(
        item => {

          const recommended=
            recommendation
              ?.recommended
              ?.type
            ===
            item.type;

          return`
            <div class="prediction">

              <div class="prediction-top">

                <div class="prediction-label">
                  ${
                    recommended
                      ?
                      '◎ AI推奨券種'
                      :
                      '比較'
                  }
                  ・${item.label}
                </div>

                <div class="prediction-score">
                  券種適合
                  ${
                    item.score
                      .toFixed(2)
                  }
                </div>

              </div>

              <div class="combo">
                ${
                  formatBetCombo(
                    item.top.combo
                  )
                }
              </div>

              <div class="sub">
                モデル評価
                ${pct(item.top.p)}

                ${
                  item.top.odd !== null
                    ?
                    ` / オッズ ${
                      item.top.odd
                        .toFixed(1)
                    }倍`
                    :
                    ''
                }

                ${
                  mode === 'pre'
                    ?
                    ' / 暫定'
                    :
                    ''
                }
              </div>

            </div>
          `;
        }
      )
      .join('');

}
'''


def replace_function(
    text: str,
    start_name: str,
    next_name: str,
    replacement: str,
):
    start = text.find(
        f"function {start_name}("
    )

    end = text.find(
        f"function {next_name}("
    )

    if (
        start < 0
        or
        end < 0
        or
        end <= start
    ):
        raise RuntimeError(
            f"function patch failed: "
            f"{start_name}"
        )

    return (
        text[:start]
        +
        replacement.strip()
        +
        "\n\n\n"
        +
        text[end:]
    )


def new_render_picks():
    return r'''
function renderPicks(
  picks,
  market,
  mode
){

  if(
    !picks.length
  ){

    $('purchaseArea')
      .classList
      .add(
        'hidden'
      );

    $('picks').innerHTML =
      '';

    return;
  }


  $('purchaseArea')
    .classList
    .remove(
      'hidden'
    );


  const labels = [
    '◎ 購入本線',
    '○ 購入対抗',
    '△ 購入押さえ'
  ];


  $('picks').innerHTML =

    picks.map(
      (
        pick,
        index
      ) => {

        const marketProbability =
          market?.[
            pick.combo
          ]
          ||
          0;


        const payout =
          pick.odd !== null
            ?
            Math.floor(
              pick.amount
              *
              pick.odd
            )
            :
            null;


        return`

          <div class="pick">

            <div class="sub">

              ${
                labels[index]
                ||
                '購入候補'
              }

              ・${pick.betTypeLabel || '3連単'}

              ${
                mode === 'pre'
                  ?
                  '・暫定'
                  :
                  ''
              }

            </div>


            <div class="combo">

              ${
                formatBetCombo(
                  pick.combo
                )
              }

            </div>


            <div class="amount">

              ¥${
                pick.amount
                  .toLocaleString()
              }

              ${
                pick.odd !== null
                  ?
                  ` / ${
                    pick.odd.toFixed(1)
                  }倍`
                  :
                  ''
              }

            </div>


            <div class="metrics">

              <div class="metric">
                <small>
                  統合モデル評価
                </small>
                <b>
                  ${pct(pick.p)}
                </b>
              </div>


              <div class="metric">
                <small>
                  市場基準
                </small>
                <b>
                  ${pct(
                    marketProbability
                  )}
                </b>
              </div>


              <div class="metric">
                <small>
                  ML単独
                </small>
                <b>
                  ${pct(pick.pure)}
                </b>
              </div>


              <div class="metric">
                <small>
                  的中時目安
                </small>
                <b>
                  ${
                    payout !== null
                      ?
                      `¥${
                        payout
                          .toLocaleString()
                      }`
                      :
                      '-'
                  }
                </b>
              </div>

            </div>

          </div>

        `;

      }
    )
      .join('');

}
'''


def patch_index():
    path = Path(
        "index.html"
    )

    text = path.read_text(
        encoding="utf-8"
    )

    text = text.replace(
        "3連単予想",
        "券種別AI予想",
        1,
    )

    text = text.replace(
        "3連単1位評価",
        "推奨券種1位評価",
    )

    text = text.replace(
        "購入・見送りに関係なく\n      必ず表示します。",
        "3連単・3連複・2連単・2連複を比較し、\n      購入・見送りに関係なく表示します。",
        1,
    )

    if (
        "function aggregateBetProbabilities("
        not in text
    ):
        marker = (
            "function chooseBets("
        )

        position = text.find(
            marker
        )

        if position < 0:
            raise RuntimeError(
                "chooseBets marker missing"
            )

        text = (
            text[:position]
            +
            MULTIBET_JS.strip()
            +
            "\n\n\n"
            +
            text[position:]
        )

    text = replace_function(
        text,
        "renderPicks",
        "renderCandidates",
        new_render_picks(),
    )

    old = """    const predictions =
      predictionTop4(
        ranked
      );


    const selected =
      chooseBets(
        combined,
        modelTrifecta,
        oddsData?.odds
        ||
        {},
        budget,
        data.oddsOk
      );"""

    new = """    const recommendation =
      multiBetRecommendation(
        modelTrifecta,
        oddsData
      );


    const recommendedType =
      recommendation
        ?.recommended;


    const predictions =
      predictionTop4(
        ranked
      );


    const selected =
      chooseMultiBets(
        recommendation,
        budget
      );"""

    if old not in text:
        raise RuntimeError(
            "analysis selection block missing"
        )

    text = text.replace(
        old,
        new,
        1,
    )

    old = """    const decision =
      purchaseDecision(
        ranked,
        selected,
        laneProbability,
        data.oddsOk,
        budget
      );"""

    new = """    const decision =
      purchaseDecision(
        recommendedType?.ranked
        ||
        ranked,
        selected,
        laneProbability,
        Boolean(
          recommendedType
          &&
          Object.keys(
            recommendedType.odds
            ||
            {}
          ).length
        ),
        budget
      );"""

    if old not in text:
        raise RuntimeError(
            "decision block missing"
        )

    text = text.replace(
        old,
        new,
        1,
    )

    old = """    renderPredictions(
      predictions,
      mode,
      data.oddsOk
    );"""

    new = """    renderMultiPredictions(
      recommendation,
      mode
    );"""

    if old not in text:
        raise RuntimeError(
            "prediction render block missing"
        )

    text = text.replace(
        old,
        new,
        1,
    )

    old = """    renderPicks(
      selected,
      market,
      mode
    );"""

    new = """    renderPicks(
      selected,
      recommendedType?.market
      ||
      market,
      mode
    );


    $('reason').textContent =
      recommendedType
        ?
        `AI推奨券種: ${
          recommendedType.label
        }。着順固定の強さと着順不確実性を比較して券種を選択しています。`
        :
        '';"""

    if old not in text:
        raise RuntimeError(
            "pick render block missing"
        )

    text = text.replace(
        old,
        new,
        1,
    )

    text = text.replace(
        "'3連単1位評価が基準3.0%未満'",
        "'推奨券種1位評価が購入基準未満'",
    )

    text = text.replace(
        "<title>BOAT RACE AI v11</title>",
        "<title>BOAT RACE AI v12 MultiBet</title>",
    )

    text = text.replace(
        "AUTO CHAMPION / RACE-RELATIVE LIVE MODEL",
        "AUTO CHAMPION / MULTI-BET STRATEGY",
    )

    path.write_text(
        text,
        encoding="utf-8",
    )


def main():
    Path(
        "api/odds.js"
    ).write_text(
        ODDS_API,
        encoding="utf-8",
    )

    patch_index()

    print(
        "MultiBet installation completed."
    )


if __name__ == "__main__":
    main()

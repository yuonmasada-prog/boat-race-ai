const https = require('node:https');
const dns = require('node:dns');

const VENUES = {
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


function numberFrom(value){
  if(value == null){
    return null;
  }

  const match =
    String(value)
      .replace(/,/g,'')
      .match(/-?\d+(?:\.\d+)?/);

  if(!match){
    return null;
  }

  const n = Number(match[0]);

  return Number.isFinite(n)
    ? n
    : null;
}


function tagBlocks(html, tag){
  const output = [];

  const regex =
    new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`,
      'gi'
    );

  let match;

  while((match = regex.exec(html))){
    output.push(match[0]);
  }

  return output;
}


function table1Sections(html){
  const starts = [];

  const regex =
    /<div\b[^>]*class=["'][^"']*\btable1\b[^"']*["'][^>]*>/gi;

  let match;

  while((match = regex.exec(html))){
    starts.push(match.index);
  }

  return starts.map((start,index)=>{

    const end =
      index + 1 < starts.length
        ? starts[index + 1]
        : html.length;

    return html.slice(
      start,
      end
    );
  });
}


function textLines(html){
  return clean(html)
    .split(/\n+/)
    .map(v => v.trim())
    .filter(Boolean);
}


function numericLines(html){
  return textLines(html)
    .map(numberFrom)
    .filter(Number.isFinite);
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


function fetchText(
  url,
  timeoutMs = 20000
){
  return new Promise(
    (resolve,reject)=>{

      const target =
        new URL(url);

      let settled = false;

      const finishError =
        error => {

          if(settled){
            return;
          }

          settled = true;
          reject(error);
        };

      const req =
        https.request(
          {
            protocol:'https:',
            hostname:target.hostname,
            port:443,
            path:target.pathname + target.search,
            method:'GET',

            family:4,
            lookup:lookupIPv4,
            servername:target.hostname,
            agent:false,

            headers:{
              'User-Agent':
                'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',

              'Accept':
                'text/html,text/plain,text/csv,application/xhtml+xml,*/*;q=0.8',

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

          response => {

            const chunks = [];

            response.on(
              'data',
              chunk => {
                chunks.push(chunk);
              }
            );

            response.on(
              'end',
              ()=>{

                if(settled){
                  return;
                }

                settled = true;

                const body =
                  Buffer
                    .concat(chunks)
                    .toString('utf8');

                if(
                  response.statusCode < 200 ||
                  response.statusCode >= 300
                ){

                  const error =
                    new Error(
                      `HTTP ${response.statusCode}`
                    );

                  error.code =
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

          const error =
            new Error(
              'request-timeout'
            );

          error.code =
            'UPSTREAM_TIMEOUT';

          req.destroy(error);
        }
      );

      req.on(
        'error',
        finishError
      );

      req.end();
    }
  );
}


function emptyRacer(lane){
  return {
    lane,

    racerId:null,
    name:null,
    grade:null,

    age:null,
    weight:null,

    fCount:null,
    lCount:null,

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


function parseIdentity(
  cell,
  racer
){
  const text =
    compact(cell);

  const idGrade =
    text.match(
      /(\d{4})\s*\/\s*(A1|A2|B1|B2)/
    );

  if(idGrade){

    racer.racerId =
      Number(
        idGrade[1]
      );

    racer.grade =
      idGrade[2];
  }

  const age =
    text.match(
      /(\d+)歳/
    );

  if(age){
    racer.age =
      Number(
        age[1]
      );
  }

  const weight =
    text.match(
      /(\d+(?:\.\d+)?)kg/
    );

  if(weight){
    racer.weight =
      Number(
        weight[1]
      );
  }

  const anchors =
    [
      ...cell.matchAll(
        /<a\b[^>]*>([\s\S]*?)<\/a>/gi
      )
    ];

  for(const anchor of anchors){

    const candidate =
      compact(
        anchor[1]
      )
      .replace(/\s+/g,'');

    if(
      candidate &&
      !/^\d+$/.test(candidate)
    ){
      racer.name =
        candidate;

      break;
    }
  }
}


function parseStatus(
  cell,
  racer
){
  const lines =
    textLines(cell);

  if(lines.length >= 3){

    racer.fCount =
      numberFrom(
        lines[0]
      );

    racer.lCount =
      numberFrom(
        lines[1]
      );

    racer.avgSt =
      numberFrom(
        lines[2]
      );

    return;
  }

  const values =
    numericLines(cell);

  racer.fCount =
    values[0] ?? null;

  racer.lCount =
    values[1] ?? null;

  racer.avgSt =
    values[2] ?? null;
}


function assignThree(
  cell,
  racer,
  keys
){
  const values =
    numericLines(cell);

  if(values.length < 3){
    return;
  }

  racer[keys[0]] =
    values[0];

  racer[keys[1]] =
    values[1];

  racer[keys[2]] =
    values[2];
}


function normalizeFullWidth(value){
  return String(value || '')
    .replace(/[０-９]/g, char =>
      String.fromCharCode(
        char.charCodeAt(0) - 0xFEE0
      )
    )
    .replace(/Ｆ/g,'F')
    .replace(/Ｌ/g,'L');
}


function detectMeetingDay(html){

  const text =
    normalizeFullWidth(
      clean(html)
    );

  if(
    /初日/.test(text)
  ){
    return 1;
  }

  const match =
    text.match(
      /(?:^|\s)(\d+)日目(?:\s|$)/
    );

  if(match){

    const value =
      Number(
        match[1]
      );

    if(
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 7
    ){
      return value;
    }
  }

  return null;
}


/*
旧HTMLパーサー。
公式ページ側の構造が取れる場合は
これもフォールバックとして残す。
*/
function parseCurrentMeetFromHtml(
  html,
  racers
){
  const page =
    clean(html);

  const position =
    page.indexOf(
      '今節成績'
    );

  if(position < 0){
    return false;
  }

  const meet =
    page.slice(
      position
    );

  let detected = false;

  for(
    let lane=1;
    lane<=6;
    lane++
  ){

    const entries = [];

    const regex =
      new RegExp(
        `(?:^|\\n)${lane}(?:\\n|\\s)`,
        'g'
      );

    const laneMatch =
      regex.exec(meet);

    if(!laneMatch){
      continue;
    }

    const window =
      meet.slice(
        laneMatch.index,
        laneMatch.index + 1800
      );

    const raceRegex =
      /\b([1-6])\s+(F|L)?\.?([0-3]\d)\s+([1-6])\b/g;

    let match;

    while(
      (
        match =
          raceRegex.exec(window)
      )
    ){

      entries.push({
        course:
          Number(
            match[1]
          ),

        flag:
          match[2] || null,

        st:
          Number(
            `0.${match[3]}`
          ),

        finish:
          Number(
            match[4]
          )
      });

      if(entries.length >= 14){
        break;
      }
    }

    if(entries.length){

      racers[lane].currentMeet =
        entries;

      detected = true;
    }
  }

  return detected;
}


function parseRaceList(html){

  const racers = {};

  for(
    let lane=1;
    lane<=6;
    lane++
  ){
    racers[lane] =
      emptyRacer(lane);
  }

  const sections =
    table1Sections(html);

  const raceTable =
    sections[1];

  if(!raceTable){

    return {
      racers,
      parserOk:false,
      parsedCount:0,
      table1Count:sections.length,
      tbodyCount:0,
      currentMeetDetected:false
    };
  }

  const tbodies =
    tagBlocks(
      raceTable,
      'tbody'
    );

  if(tbodies.length < 6){

    return {
      racers,
      parserOk:false,
      parsedCount:0,
      table1Count:sections.length,
      tbodyCount:tbodies.length,
      currentMeetDetected:false
    };
  }

  for(
    let lane=1;
    lane<=6;
    lane++
  ){

    const row =
      tbodies[
        lane - 1
      ];

    const cells =
      tagBlocks(
        row,
        'td'
      );

    const racer =
      racers[lane];

    if(cells.length < 8){
      continue;
    }

    parseIdentity(
      cells[2],
      racer
    );

    parseStatus(
      cells[3],
      racer
    );

    assignThree(
      cells[4],
      racer,
      [
        'nationalWin',
        'national2',
        'national3'
      ]
    );

    assignThree(
      cells[5],
      racer,
      [
        'localWin',
        'local2',
        'local3'
      ]
    );

    assignThree(
      cells[6],
      racer,
      [
        'motorNo',
        'motor2',
        'motor3'
      ]
    );

    assignThree(
      cells[7],
      racer,
      [
        'boatNo',
        'boat2',
        'boat3'
      ]
    );
  }

  const currentMeetDetected =
    parseCurrentMeetFromHtml(
      html,
      racers
    );

  const parsedCount =
    Object
      .values(racers)
      .filter(
        racer =>
          racer.racerId != null &&
          racer.grade != null &&
          racer.avgSt != null &&
          racer.nationalWin != null &&
          racer.national2 != null &&
          racer.national3 != null &&
          racer.localWin != null &&
          racer.motor2 != null &&
          racer.boat2 != null
      )
      .length;

  return {
    racers,

    currentMeetDetected,

    parserOk:
      parsedCount === 6,

    parsedCount,

    table1Count:
      sections.length,

    tbodyCount:
      tbodies.length
  };
}


/*
RFC4180寄りの簡易CSVパーサー。
ダブルクォート・カンマ入り文字列に対応。
*/
function parseCsvLine(line){

  const cells = [];

  let current = '';
  let quoted = false;

  for(
    let i=0;
    i<line.length;
    i++
  ){

    const char =
      line[i];

    if(char === '"'){

      if(
        quoted &&
        line[i + 1] === '"'
      ){

        current += '"';
        i++;

      }else{

        quoted =
          !quoted;

      }

      continue;
    }

    if(
      char === ',' &&
      !quoted
    ){

      cells.push(
        current
      );

      current = '';

      continue;
    }

    current +=
      char;
  }

  cells.push(
    current
  );

  return cells;
}


function parseCsv(text){

  const lines =
    String(text || '')
      .replace(/^\uFEFF/,'')
      .split(/\r?\n/)
      .filter(
        line =>
          line.trim().length
      );

  if(lines.length < 2){
    return [];
  }

  const headers =
    parseCsvLine(
      lines[0]
    )
    .map(
      value =>
        value.trim()
    );

  const rows = [];

  for(
    let i=1;
    i<lines.length;
    i++
  ){

    const values =
      parseCsvLine(
        lines[i]
      );

    if(
      values.length <
      Math.min(
        4,
        headers.length
      )
    ){
      continue;
    }

    const row = {};

    headers.forEach(
      (header,index)=>{

        row[header] =
          values[index] ?? '';

      }
    );

    rows.push(
      row
    );
  }

  return rows;
}


function firstExisting(
  row,
  keys
){
  for(
    const key
    of keys
  ){

    if(
      Object.prototype.hasOwnProperty.call(
        row,
        key
      )
    ){

      return row[key];
    }
  }

  return '';
}


function normalizeRaceNumber(value){

  const match =
    normalizeFullWidth(
      value
    )
    .match(/\d+/);

  return match
    ? Number(match[0])
    : null;
}


function normalizeVenueNumber(value){

  const match =
    normalizeFullWidth(
      value
    )
    .match(/\d+/);

  return match
    ? Number(match[0])
    : null;
}


function normalizeFinish(value){

  const text =
    normalizeFullWidth(
      value
    )
    .trim();

  if(
    /^[1-6]$/.test(text)
  ){

    return {
      finish:Number(text),
      flag:null
    };
  }

  if(
    !text
  ){

    return {
      finish:null,
      flag:null
    };
  }

  return {
    finish:null,
    flag:text
  };
}


/*
BoatraceCSVのrace_cardsは
BOATCAST bc_j_str3を構造化したもの。

節間スロット:
D1走1, D1走2 ...
D7走1, D7走2

各スロット:
R番号 / 進入 / 枠 / ST / 着順
*/
function enrichCurrentMeetFromCsv(
  csv,
  venue,
  race,
  racers
){

  const rows =
    parseCsv(csv);

  if(!rows.length){

    return {
      detected:false,
      maxDay:0,
      matched:false
    };
  }

  const targetVenue =
    Number(venue);

  const targetRace =
    Number(race);

  const row =
    rows.find(
      item => {

        const venueValue =
          normalizeVenueNumber(
            firstExisting(
              item,
              [
                'レース場コード',
                '場コード'
              ]
            )
          );

        const raceValue =
          normalizeRaceNumber(
            firstExisting(
              item,
              [
                'レース回',
                'R'
              ]
            )
          );

        return (
          venueValue === targetVenue &&
          raceValue === targetRace
        );
      }
    );

  if(!row){

    return {
      detected:false,
      maxDay:0,
      matched:false
    };
  }

  let detected = false;
  let maxDay = 0;

  for(
    let lane=1;
    lane<=6;
    lane++
  ){

    const entries = [];

    for(
      let day=1;
      day<=7;
      day++
    ){

      for(
        let run=1;
        run<=2;
        run++
      ){

        const prefix =
          `艇${lane}_節D${day}走${run}_`;

        const raceNo =
          numberFrom(
            row[
              `${prefix}R番号`
            ]
          );

        const course =
          numberFrom(
            row[
              `${prefix}進入`
            ]
          );

        const frame =
          numberFrom(
            row[
              `${prefix}枠`
            ]
          );

        const st =
          numberFrom(
            row[
              `${prefix}ST`
            ]
          );

        const finishInfo =
          normalizeFinish(
            row[
              `${prefix}着順`
            ]
          );

        const hasAny =
          raceNo != null ||
          course != null ||
          frame != null ||
          st != null ||
          finishInfo.finish != null ||
          finishInfo.flag != null;

        if(!hasAny){
          continue;
        }

        entries.push({
          day,
          run,

          raceNo:
            raceNo ?? null,

          course:
            course ?? null,

          frame:
            frame ?? null,

          st:
            st ?? null,

          finish:
            finishInfo.finish,

          flag:
            finishInfo.flag
        });

        detected = true;

        maxDay =
          Math.max(
            maxDay,
            day
          );
      }
    }

    if(entries.length){

      racers[lane].currentMeet =
        entries;
    }
  }

  return {
    detected,
    maxDay,
    matched:true
  };
}


module.exports =
async function handler(
  req,
  res
){

  const started =
    Date.now();

  try{

    const date =
      String(
        req.query.date || ''
      )
      .replace(
        /[-/]/g,
        ''
      );

    const venue =
      String(
        req.query.venue || ''
      )
      .padStart(
        2,
        '0'
      );

    const race =
      Number(
        req.query.race || 1
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


    const officialUrl =
      `https://www.boatrace.jp/owpc/pc/race/racelist?rno=${race}&jcd=${venue}&hd=${date}`;


    const yyyy =
      date.slice(0,4);

    const mm =
      date.slice(4,6);

    const dd =
      date.slice(6,8);


    /*
    BOATCAST bc_j_str3由来の構造化CSV。
    公式HTMLの今節成績が取りづらい場合の
    補完専用。
    */
    const meetCsvUrl =
      `https://boatracecsv.github.io/data/programs/race_cards/${yyyy}/${mm}/${dd}.csv`;


    /*
    別ホストなので並列。
    公式出走表が8〜10秒でも、
    補完取得が足を引っ張らない。
    */
    const [
      officialResult,
      meetResult
    ] =
      await Promise.allSettled([

        fetchText(
          officialUrl,
          20000
        ),

        fetchText(
          meetCsvUrl,
          10000
        )

      ]);


    if(
      officialResult.status
      !==
      'fulfilled'
    ){

      throw officialResult.reason;
    }


    const html =
      officialResult.value;


    const parsed =
      parseRaceList(
        html
      );


    if(
      !parsed.parserOk
    ){

      return res
        .status(200)
        .json({
          ok:false,

          error:
            'race-list-parser-failed',

          source:
            'official-racelist-v5',

          transport:
            'node-https-ipv4',

          htmlLength:
            html.length,

          parsedCount:
            parsed.parsedCount,

          table1Count:
            parsed.table1Count,

          tbodyCount:
            parsed.tbodyCount,

          elapsedMs:
            Date.now()
            -
            started
        });
    }


    let meetingDay =
      detectMeetingDay(
        html
      );


    let meetSupplement = {
      detected:false,
      maxDay:0,
      matched:false
    };


    if(
      meetResult.status
      ===
      'fulfilled'
    ){

      meetSupplement =
        enrichCurrentMeetFromCsv(
          meetResult.value,
          venue,
          race,
          parsed.racers
        );
    }


    /*
    HTMLより構造化節間データを優先。
    補完側が取れなければ旧HTML解析を使用。
    */
    let currentMeetDetected =
      meetSupplement.detected
      ||
      parsed.currentMeetDetected;


    let currentMeetSource =
      meetSupplement.detected

        ?

        'boatcast-race-cards'

        :

        parsed.currentMeetDetected

          ?

          'official-racelist-html'

          :

          null;


    /*
    meetingDayがHTMLで取れなかった場合、
    最後に存在する節間日+1を推定。
    */
    if(
      meetingDay == null &&
      meetSupplement.maxDay > 0
    ){

      meetingDay =
        Math.min(
          7,
          meetSupplement.maxDay + 1
        );
    }


    /*
    初日は今節成績が0件で正常。
    index.html v6はcurrentMeetDetectedを
    データ完全性判定に使うため、
    「初日=取得完了」としてtrueにする。
    */
    if(
      meetingDay === 1
    ){

      currentMeetDetected =
        true;

      currentMeetSource =
        'not-applicable-first-day';
    }


    /*
    各艇の今節成績数
    */
    const currentMeetCounts = {};

    for(
      let lane=1;
      lane<=6;
      lane++
    ){

      currentMeetCounts[lane] =
        Array.isArray(
          parsed.racers[lane].currentMeet
        )

          ?

          parsed.racers[lane]
            .currentMeet
            .length

          :

          0;
    }


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

        meetingDay,

        source:
          'official-racelist-v5',

        currentMeetSource,

        transport:
          'node-https-ipv4',

        htmlLength:
          html.length,

        elapsedMs:
          Date.now()
          -
          started,

        parserOk:
          parsed.parserOk,

        parsedCount:
          parsed.parsedCount,

        currentMeetDetected,

        currentMeetCounts,

        currentMeetSupplementMatched:
          meetSupplement.matched,

        racers:
          parsed.racers

      });


  }catch(error){

    return res
      .status(200)
      .json({

        ok:false,

        error:
          error?.message
          ||
          String(error),

        code:
          error?.code
          ||
          null,

        source:
          'official-racelist-v5',

        elapsedMs:
          Date.now()
          -
          started

      });
  }
};

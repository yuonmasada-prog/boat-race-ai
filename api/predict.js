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
  A1:0.48,
  A2:0.22,
  B1:0.02,
  B2:-0.18
};


function strip(html){

  return String(
    html || ''
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
    /\s+/g,
    ' '
  )

  .trim();

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
        regex.exec(
          html
        )
    )
  ){

    const number =
      Number(
        strip(
          match[1]
        )
        .replace(
          /,/g,
          ''
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


  values
    .slice(
      0,
      120
    )
    .forEach(
      (
        value,
        index
      ) => {

        if(
          value == null
        ){

          return;

        }


        const combination =
          String(
            ORDER[index]
          );


        odds[
          `${combination[0]}-${combination[1]}-${combination[2]}`
        ] =
          value;

      }
    );


  return odds;

}


function parseBeforeInfo(
  html
){

  const text =
    strip(
      html
    );


  const boats = {};


  for(
    let lane = 1;
    lane <= 6;
    lane++
  ){

    boats[lane] = {

      lane,

      exTime:null,

      exSt:null

    };

  }


  const exhibitionTimes =

    [
      ...text.matchAll(
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
        value >= 6.30
        &&
        value <= 7.20
    )

    .slice(
      -6
    );


  if(
    exhibitionTimes.length === 6
  ){

    exhibitionTimes
      .forEach(
        (
          value,
          index
        ) => {

          boats[
            index + 1
          ].exTime =
            value;

        }
      );

  }


  const exhibitionStarts =

    [
      ...text.matchAll(
        /(?:^|\s)(?:F)?\.?([0-9]{2})(?=\s|$)/g
      )
    ]

    .map(
      match =>
        Number(
          `0.${match[1]}`
        )
    )

    .filter(
      value =>
        value >= 0
        &&
        value <= 0.40
    )

    .slice(
      -6
    );


  if(
    exhibitionStarts.length === 6
  ){

    exhibitionStarts
      .forEach(
        (
          value,
          index
        ) => {

          boats[
            index + 1
          ].exSt =
            value;

        }
      );

  }


  return boats;

}


function parseRaceList(
  html
){

  const text =
    strip(
      html
    );


  const boats = {};


  for(
    let lane = 1;
    lane <= 6;
    lane++
  ){

    boats[lane] = {

      lane,

      grade:null

    };

  }


  const grades =

    [
      ...text.matchAll(
        /\b(A1|A2|B1|B2)\b/g
      )
    ]

    .map(
      match =>
        match[1]
    )

    .slice(
      0,
      6
    );


  grades
    .forEach(
      (
        grade,
        index
      ) => {

        boats[
          index + 1
        ].grade =
          grade;

      }
    );


  return boats;

}


function parseBias(
  raw
){

  const bias = {
    1:1,
    2:1,
    3:1,
    4:1,
    5:1,
    6:1
  };


  if(
    !raw
  ){

    return bias;

  }


  try{

    const input =
      JSON.parse(
        String(
          raw
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

        bias[lane] =
          Math.max(
            0.8,
            Math.min(
              1.2,
              value
            )
          );

      }

    }

  }catch{

  }


  return bias;

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


  const sd =
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
  sd;

}


function calculateStrength(
  lane,
  racer,
  before,
  allBefore,
  learnedBias
){

  let score =
    Math.log(
      COURSE_PRIOR[lane]
      *
      learnedBias[lane]
    );


  score +=
    GRADE_BONUS[
      racer.grade
    ]
    ||
    0;


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


  /*
  展示タイムは小さいほど良い
  */

  if(
    Number.isFinite(
      before.exTime
    )
  ){

    score -=
      0.30
      *
      zScore(
        exhibitionTimes,
        before.exTime
      );

  }


  /*
  展示STも小さいほど良い

  ただし展示一発だけを
  過大評価しないよう
  係数を抑えている
  */

  if(
    Number.isFinite(
      before.exSt
    )
  ){

    score -=
      0.18
      *
      zScore(
        exhibitionStarts,
        before.exSt
      );

  }


  return score;

}


function trifectaProbability(
  combination,
  strengths
){

  const [
    first,
    second,
    third
  ] =
    combination
      .split(
        '-'
      )
      .map(
        Number
      );


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


  const total1 =
    Object.values(
      weights
    )
    .reduce(
      (
        total,
        value
      ) =>
        total + value,
      0
    );


  const firstProbability =
    weights[first]
    /
    total1;


  const total2 =
    total1
    -
    weights[first];


  const secondProbability =
    weights[second]
    /
    total2;


  const total3 =
    total2
    -
    weights[second];


  const thirdProbability =
    weights[third]
    /
    total3;


  return (
    firstProbability
    *
    secondProbability
    *
    thirdProbability
  );

}


function chooseBets(
  odds,
  strengths,
  budget
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


  const candidates =
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
          trifectaProbability(
            combination,
            strengths
          );


        return {

          combo:
            combination,

          odds:
            odd,

          p:
            probability,

          ev:
            probability
            *
            odd

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


  /*
  100〜300円の少額時は
  大穴EVより
  推定的中率を優先。

  残高が少ない時に
  100倍超へ全額投入する
  ような挙動を防ぐ。
  */

  if(
    units <= 3
  ){

    candidates.sort(
      (
        a,
        b
      ) =>
        b.p -
        a.p
        ||
        a.odds -
        b.odds
    );


    return candidates

      .slice(
        0,
        units
      )

      .map(
        row => ({

          ...row,

          amount:
            100

        })
      );

  }


  candidates
    .forEach(
      row => {

        let oddsPenalty =
          1;


        if(
          row.odds > 100
        ){

          oddsPenalty =
            0.55;

        }else if(
          row.odds > 50
        ){

          oddsPenalty =
            0.70;

        }else if(
          row.odds > 25
        ){

          oddsPenalty =
            0.82;

        }


        row.score =
          row.p
          *
          Math.log1p(
            row.odds
          )
          *
          oddsPenalty;

      }
    );


  candidates.sort(
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


  const selected =
    candidates

      .filter(
        row =>
          row.p >= 0.012
          &&
          row.odds <= 120
      )

      .slice(
        0,
        Math.min(
          3,
          units
        )
      );


  if(
    selected.length === 0
  ){

    return [];

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


  let remainingUnits =
    units;


  const output = [];


  selected
    .forEach(
      (
        row,
        index
      ) => {

        let useUnits;


        if(
          index ===
          selected.length - 1
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
            useUnits
            *
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


    const budget =
      Number(
        req.query.budget || 1000
      );


    const learnedBias =
      parseBias(
        req.query.bias
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
      ||
      !Number.isFinite(
        budget
      )
      ||
      budget < 100
    ){

      return res
        .status(
          400
        )
        .json({

          error:
            '入力値が不正です'

        });

    }


    const base =
      'https://www.boatrace.jp/owpc/pc/race';


    const query =
      `?rno=${race}`
      +
      `&jcd=${venue}`
      +
      `&hd=${date}`;


    /*
    公式サイトから並列取得

    ・3連単オッズ
    ・出走表
    ・直前情報
    */

    const [
      oddsHtml,
      raceHtml,
      beforeHtml
    ] =

      await Promise.all([

        fetchText(
          base
          +
          '/odds3t'
          +
          query
        ),

        fetchText(
          base
          +
          '/racelist'
          +
          query
        ),

        fetchText(
          base
          +
          '/beforeinfo'
          +
          query
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
        .status(
          200
        )
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
            '公式3連単オッズの取得数が不足しているため見送り。'

        });

    }


    const racers =
      parseRaceList(
        raceHtml
      );


    const before =
      parseBeforeInfo(
        beforeHtml
      );


    const strengths = {};


    for(
      let lane = 1;
      lane <= 6;
      lane++
    ){

      strengths[lane] =
        calculateStrength(

          lane,

          racers[lane],

          before[lane],

          before,

          learnedBias

        );

    }


    const picks =
      chooseBets(
        odds,
        strengths,
        budget
      );


    const maxProbability =
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


    /*
    500円以下では
    予測確率が薄いレースを
    無理に購入候補にしない
    */

    const skip =
      picks.length === 0
      ||
      (
        budget <= 500
        &&
        maxProbability < 0.035
      );


    return res
      .status(
        200
      )
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

            '少額資金で有力候補の推定確率が低いため見送り。'

            :

            'コース基礎率・選手級別・展示タイム・展示ST・3連単オッズ・蓄積結果によるコース補正を統合した暫定モデル。',

        meta:{

          model:
            'adaptive-v3',

          courseBias:
            learnedBias,

          grades:
            Object.values(
              racers
            )
            .map(
              racer =>
                racer.grade
            ),

          exhibition:
            before

        }

      });


  }catch(
    error
  ){

    return res
      .status(
        500
      )
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

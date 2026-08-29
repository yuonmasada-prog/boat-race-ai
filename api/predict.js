const V={
  '01':'桐生','02':'戸田','03':'江戸川','04':'平和島','05':'多摩川','06':'浜名湖',
  '07':'蒲郡','08':'常滑','09':'津','10':'三国','11':'びわこ','12':'住之江',
  '13':'尼崎','14':'鳴門','15':'丸亀','16':'児島','17':'宮島','18':'徳山',
  '19':'下関','20':'若松','21':'芦屋','22':'福岡','23':'唐津','24':'大村'
};

const C={1:.56,2:.14,3:.12,4:.10,5:.05,6:.03};

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

const strip=s=>String(s||'')
  .replace(/<script[\s\S]*?<\/script>/gi,' ')
  .replace(/<style[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;|&#160;/g,' ')
  .replace(/&amp;/g,'&')
  .replace(/\s+/g,' ')
  .trim();

async function get(u){
  const c=new AbortController();
  const t=setTimeout(()=>c.abort(),8000);

  try{
    const r=await fetch(u,{
      headers:{
        'user-agent':'Mozilla/5.0 BOAT-RACE-AI-MVP/1.1',
        'accept':'text/html,application/xhtml+xml'
      },
      signal:c.signal,
      cache:'no-store'
    });

    if(!r.ok){
      throw Error('公式ページ取得失敗 '+r.status);
    }

    return await r.text();
  }finally{
    clearTimeout(t);
  }
}

function parseOdds(html){
  const vals=[];
  const cell=/<td[^>]*class=["'][^"']*\boddsPoint\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi;

  let m;

  while((m=cell.exec(html))){
    const s=strip(m[1]).replace(/,/g,'');
    const n=Number(s);

    if(Number.isFinite(n) && n>=1){
      vals.push(n);
    }else{
      vals.push(null);
    }
  }

  const out={};

  if(vals.length>=120){
    for(let i=0;i<120;i++){
      if(vals[i]!=null){
        const k=String(ORDER[i]);
        out[`${k[0]}-${k[1]}-${k[2]}`]=vals[i];
      }
    }
    return out;
  }

  const text=strip(html);

  const re=/([1-6])\s*[-－]\s*([1-6])\s*[-－]\s*([1-6])\s+([0-9]{1,4}(?:\.[0-9])?)/g;

  while((m=re.exec(text))){
    if(new Set([m[1],m[2],m[3]]).size===3){
      out[`${m[1]}-${m[2]}-${m[3]}`]=+m[4];
    }
  }

  return out;
}

function prob(k){
  const [a,b,c]=k.split('-').map(Number);

  return Math.max(
    .0001,
    C[a] *
    (C[b]/Math.max(.001,1-C[a])) *
    (C[c]/Math.max(.001,1-C[a]-C[b]))
  );
}

module.exports=async(req,res)=>{
  try{
    const d=String(req.query.date||'').replace(/-/g,'');
    const v=String(req.query.venue||'15').padStart(2,'0');
    const r=+req.query.race||1;
    const b=Math.max(
      100,
      Math.floor((+req.query.budget||1000)/100)*100
    );

    if(
      !/^\d{8}$/.test(d) ||
      !V[v] ||
      r<1 ||
      r>12
    ){
      return res.status(400).json({
        error:'入力値が不正です'
      });
    }

    const base='https://www.boatrace.jp/owpc/pc/race';
    const q=`?rno=${r}&jcd=${v}&hd=${d}`;

    const src=[
      `${base}/racelist${q}`,
      `${base}/beforeinfo${q}`,
      `${base}/odds3t${q}`
    ];

    const s=await Promise.allSettled(src.map(get));

    const o=parseOdds(
      s[2].status==='fulfilled'
        ? s[2].value
        : ''
    );

    const a=Object.entries(o)
      .map(([combo,od])=>{
        const p=prob(combo);

        return{
          combo,
          odds:od,
          prob:p,
          ev:p*od,
          score:
            p*.8 +
            (1/Math.sqrt(od))*.2
        };
      })
      .sort((x,y)=>y.score-x.score);

    if(a.length<100){
      return res.json({
        skip:true,
        venueName:V[v],
        race:r,
        oddsCount:a.length,
        picks:[],
        reason:
          `公式3連単オッズの取得数が${a.length}通りのため見送り。`+
          `発売前・締切後・公式ページ応答不良の可能性があります。`
      });
    }

    const top=a.slice(0,3);

    const rat=[.5,.3,.2];

    let used=0;

    const picks=top.map((p,i)=>{
      let amt;

      if(i===2){
        amt=b-used;
      }else{
        amt=Math.floor(b*rat[i]/100)*100;
      }

      used+=amt;

      return{
        ...p,
        amount:amt
      };
    });

    res.setHeader(
      'Cache-Control',
      's-maxage=20, stale-while-revalidate=40'
    );

    return res.json({
      skip:false,
      venueName:V[v],
      race:r,
      oddsCount:a.length,
      picks,
      reason:
        '公式3連単オッズ120通りを取得。' +
        '現MVPはコース事前分布とオッズによるヒューリスティック順位付けで、' +
        '確率は校正済みモデルではありません。'
    });

  }catch(e){

    return res.status(500).json({
      error:
        e.name==='AbortError'
          ? '公式サイト取得がタイムアウトしました'
          : e.message
    });

  }
};

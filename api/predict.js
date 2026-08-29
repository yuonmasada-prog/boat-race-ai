const VENUES = {
  "01": "桐生",
  "02": "戸田",
  "03": "江戸川",
  "04": "平和島",
  "05": "多摩川",
  "06": "浜名湖",
  "07": "蒲郡",
  "08": "常滑",
  "09": "津",
  "10": "三国",
  "11": "びわこ",
  "12": "住之江",
  "13": "尼崎",
  "14": "鳴門",
  "15": "丸亀",
  "16": "児島",
  "17": "宮島",
  "18": "徳山",
  "19": "下関",
  "20": "若松",
  "21": "芦屋",
  "22": "福岡",
  "23": "唐津",
  "24": "大村"
};

module.exports = async function handler(req, res) {
  try {
    const date = String(req.query.date || "")
      .replace(/-/g, "")
      .replace(/\//g, "");

    const venue = String(req.query.venue || "")
      .padStart(2, "0");

    const race = Number(req.query.race || 1);

    // -------------------------
    // 入力チェック
    // -------------------------

    if (!/^\d{8}$/.test(date)) {
      return res.status(400).json({
        success: false,
        stage: "validation",
        error: "日付が不正です",
        received: date
      });
    }

    if (!VENUES[venue]) {
      return res.status(400).json({
        success: false,
        stage: "validation",
        error: "場コードが不正です",
        received: venue
      });
    }

    if (
      !Number.isInteger(race) ||
      race < 1 ||
      race > 12
    ) {
      return res.status(400).json({
        success: false,
        stage: "validation",
        error: "レース番号が不正です",
        received: race
      });
    }

    // -------------------------
    // BOAT RACE公式URL
    // -------------------------

    const officialUrl =
      "https://www.boatrace.jp/owpc/pc/race/odds3t" +
      "?rno=" +
      encodeURIComponent(race) +
      "&jcd=" +
      encodeURIComponent(venue) +
      "&hd=" +
      encodeURIComponent(date);

    // -------------------------
    // 最小構成でfetch
    // -------------------------

    let response;

    try {
      response = await fetch(officialUrl);
    } catch (error) {
      return res.status(502).json({
        success: false,
        stage: "fetch",
        venueName: VENUES[venue],
        race: race,
        officialUrl: officialUrl,
        errorName: error?.name || "UnknownError",
        errorMessage:
          error?.message ||
          String(error)
      });
    }

    // -------------------------
    // HTML取得
    // -------------------------

    let html;

    try {
      html = await response.text();
    } catch (error) {
      return res.status(502).json({
        success: false,
        stage: "response-text",
        venueName: VENUES[venue],
        race: race,
        officialUrl: officialUrl,
        status: response.status,
        errorName: error?.name || "UnknownError",
        errorMessage:
          error?.message ||
          String(error)
      });
    }

    // -------------------------
    // HTMLを少しだけ整形
    // -------------------------

    const preview = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1000);

    // -------------------------
    // oddsPoint存在確認
    // -------------------------

    const oddsPointMatches =
      html.match(/\boddsPoint\b/gi) || [];

    // -------------------------
    // 診断結果
    // -------------------------

    return res.status(200).json({
      success: true,

      diagnostic: true,

      input: {
        date: date,
        venue: venue,
        venueName: VENUES[venue],
        race: race
      },

      officialUrl: officialUrl,

      fetch: {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        contentType:
          response.headers.get("content-type"),
        htmlLength: html.length
      },

      detection: {
        oddsPointCount:
          oddsPointMatches.length
      },

      htmlPreview: preview
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      stage: "unexpected",
      errorName:
        error?.name || "UnknownError",
      errorMessage:
        error?.message || String(error),
      stack:
        error?.stack || null
    });
  }
};

/* ==========================================================
   行记 — album manifest
   Drives album.html and the homepage album links.
   layout: full | pano | wide | std | tall
   ========================================================== */

window.ALBUMS = {
  qinghai: {
    no: '01', cn: '青海', title: 'The Highland Light',
    sub: 'Qinghai — 3,000 metres up, the sky is a mirror and the grass runs to every horizon.',
    dark: false,
    photos: [
      { src: 'assets/img/chaka1.webp',   cap: '茶卡盐湖 — the mirror of the sky', l: 'full' },
      { src: 'assets/img/qjpano.webp',    cap: '祁连山中 — the road over the pass', l: 'pano' },
      { src: 'assets/img/lake1.webp',    cap: 'a gate left open to Qinghai Lake', l: 'wide' },
      { src: 'assets/img/chaka2.webp',   cap: 'the lake, held in one hand', l: 'std' },
      { src: 'assets/img/qinghai1.webp', cap: 'rain coming over the spruce', l: 'wide' },
      { src: 'assets/img/Qinghai3.webp',  cap: 'pylons walking the yellow hills', l: 'tall' },
      { src: 'assets/img/ta1.webp',      cap: '塔尔寺 — a door into incense', l: 'tall' },

      { src: 'assets/img/pano.webp',      cap: 'clouds filing across the plateau', l: 'pano' },
      { src: 'assets/img/qh10.webp',     cap: 'the lake takes the fire calmly', l: 'full' },
      { src: 'assets/img/pano2.webp',    cap: 'big sky country, highland edition', l: 'pano' },
    ],
  },

  lijiang: {
    no: '02', cn: '丽江', title: 'Where the Snow Mountain Watches',
    sub: 'Lijiang — the Jade Dragon keeps thirteen peaks, and every street ends in one of them.',
    dark: false,
    photos: [
      { src: 'assets/img/lijiang1.webp', cap: '蓝月谷 — glacier water, the colour of weather', l: 'full' },
      { src: 'assets/img/lij1.webp',     cap: 'the dry meadow at 3,200 m', l: 'tall' },
      { src: 'assets/img/lijiang4.webp', cap: 'thirteen peaks, counted twice', l: 'wide' },
      { src: 'assets/img/lij2.webp',    cap: 'the mountain, framed by someone’s wish', l: 'tall' },
      { src: 'assets/img/lijiang3.webp', cap: '经幡 — wind reading the prayers aloud', l: 'full' },
      { src: 'assets/img/lijiang5.webp', cap: 'where the trees give up', l: 'wide' },
      { src: 'assets/img/mainli.webp',  cap: 'the glacier keeps to itself', l: 'std' },
      { src: 'assets/img/cow.webp',       cap: 'a local, unimpressed', l: 'std' },
    ],
  },

  xinjiang: {
    no: '03', cn: '新疆', title: 'Where the Light Comes Down',
    sub: 'Xinjiang — a sixth of a country, where the mountains make their own weather and the light arrives in columns.',
    // clear-sky album — it reads on light paper, tinted cool by
    // body.album-xinjiang so it still stands apart from the other albums
    dark: false,
    photos: [
      { src: 'assets/img/xj1.webp',  cap: '天山日暮 — the sun files its report through the cloud', l: 'pano' },
      { src: 'assets/img/xj8.webp',  cap: 'the reservoir keeps a turquoise nobody mixed', l: 'tall' },
      { src: 'assets/img/xj3.webp',  cap: '雪岭 — the snow line, drawn once and never revised', l: 'full' },
      { src: 'assets/img/xj2.webp',  cap: 'the valley hands the light down in stages', l: 'tall' },
      { src: 'assets/img/xj5.webp',  cap: 'weather arrives on the steppe before it is announced', l: 'pano' },
      { src: 'assets/img/xj7.webp',  cap: 'ridge behind ridge, each one paler than its word', l: 'tall' },
      { src: 'assets/img/xj10.webp', cap: '安集海大峡谷 — the river writes in a hand nobody reads', l: 'full' },
      { src: 'assets/img/xj6.webp',  cap: 'one cloud, posted over the spruce like a notice', l: 'tall' },
      { src: 'assets/img/xj4.webp',  cap: 'the grassland takes the whole sun without flinching', l: 'wide' },
      { src: 'assets/img/xj11.webp', cap: '赛里木湖 — water clear enough to read the stones through', l: 'tall' },
      { src: 'assets/img/xj9.webp',  cap: 'the only colour left in the valley, walking', l: 'pano' },
    ],
  },

  japan: {
    no: '04', cn: '日本', title: 'Ten Thousand Gates',
    sub: 'Japan — a country that files its miracles neatly: one volcano, ten thousand torii, trains on time.',
    dark: false,
    photos: [
      { src: 'assets/img/fuj1.webp',     cap: '富士山 — the volcano keeps its smoke politely to one side', l: 'tall' },
      { src: 'assets/img/fuji1.webp',   cap: 'the gate and the mountain agree on red', l: 'full' },
      { src: 'assets/img/kyo1.webp',     cap: 'steps that ask you to slow down', l: 'tall' },
      { src: 'assets/img/kyo3.webp',    cap: '清水寺 — the city kept in a wooden frame', l: 'tall' },
      { src: 'assets/img/kyo2.webp',    cap: 'the pagoda has seen your photo before', l: 'tall' },
      { src: 'assets/img/temple1.webp',  cap: 'the cedars are the congregation', l: 'wide' },
      { src: 'assets/img/japan1.webp',   cap: 'guarded by two patient lions', l: 'std' },
      { src: 'assets/img/kyo4.webp',    cap: 'a lantern over the steps at dusk', l: 'tall' },
      { src: 'assets/img/kyotonew.webp', cap: 'the driver’s view, borrowed', l: 'tall' },
      { src: 'assets/img/fuji2.webp',    cap: '新宿 — signage as weather', l: 'tall' },
      { src: 'assets/img/kyoto1.webp',   cap: '千本鳥居 — a thousand gates, and the dark between them', l: 'full' },
      { src: 'assets/img/tok00.webp',    cap: 'Tokyo — a circuit that never sleeps', l: 'wide' },
      { src: 'assets/img/osa.webp',     cap: 'an alley with its own opinion of light', l: 'tall' },
      { src: 'assets/img/osakanew.webp', cap: '道頓堀 — the street that shouts dinner', l: 'std' },
      { src: 'assets/img/liuli.webp',    cap: '琉璃 — autumn, reflected in lacquer and glass', l: 'full' },
      { src: 'assets/img/liulinew.webp', cap: 'the moss is the oldest resident', l: 'wide' },
    ],
  },

  beijing: {
    no: '05', cn: '北京', title: 'The Garden of Clear Ripples',
    sub: 'Beijing — the Summer Palace at closing hour, when the lake gets the light to itself.',
    dark: false,
    photos: [
      { src: 'assets/img/yih1.webp',     cap: '佛香阁 — the tower above the green', l: 'tall' },
      { src: 'assets/img/yih3.webp',     cap: 'a gate dressed for the occasion', l: 'wide' },
      { src: 'assets/img/yih2.webp',    cap: 'the cloud auditions for a mountain', l: 'tall' },
      { src: 'assets/img/yih4.webp',    cap: '玉泉塔 — across the water, smaller than memory', l: 'tall' },
      { src: 'assets/img/yih6.webp',    cap: 'willows combing the late light', l: 'tall' },
    
      { src: 'assets/img/yih5.webp',    cap: 'she got the best seat and knows it', l: 'tall' },
    ],
  },
};

window.ALBUM_ORDER = ['qinghai', 'lijiang', 'xinjiang', 'japan', 'beijing'];

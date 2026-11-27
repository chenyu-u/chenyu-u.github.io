/* travel-map.js · the Leaflet map of visited cities on life.html (loaded by site.js once Leaflet is in).
   Each city gets a pin; its popup shows travel/map/<slug>.webp (text only if the photo is missing) and a note. */
(function () {
    const el = document.getElementById('travel-map');
    if (!el || typeof L === 'undefined') return;

    const CITIES = [
      // [slug, city, lat, lng, note]
      ['calgary',   'Calgary, Canada',        51.0447, -114.0719, 'Where I grew up, Stampede every summer, and the city where I first started building things.'],
      ['banff',     'Banff, Canada',          51.1784, -115.5708, 'Skiing and hiking in the Rockies, the mountains I grew up travelling to all the time for some peace in nature.'],
      ['toronto',   'Toronto, Canada',        43.6532,  -79.3832, 'Home for university, where the engineering degree, the research, and most of this website happen.'],
      ['ottawa',    'Ottawa, Canada',         45.4215,  -75.6972, 'Spent a weekend here representing the University of Toronto for the 2026 Ontario Engineering Competition after winning the Junior Design category at the University of Toronto Engineering Kompetitions. Parliament Hill and the Gothic Revival stonework there is the best architecture I\u2019ve seen in Canada.'],
      ['london',    'London, UK',             51.5074,   -0.1278, 'Classic engineering on display. Tower Bridge\u2019s bascules and Big Ben\u2019s clockwork are Victorian machines still running every day.'],
      ['barcelona', 'Barcelona, Spain',       41.3874,    2.1686, 'The Sagrada Fam\u00edlia is structural engineering as art, the port infrastructure is massive, and the Montju\u00efc communications tower looked so much like a wind turbine it fooled me at first glance.'],
      ['madrid',    'Madrid, Spain',          40.4168,   -3.7038, 'The Royal Palace\u2019s artwork is lit almost entirely with natural light. Architects were solving illumination problems centuries before the light bulb.'],
      ['busan',     'Busan, South Korea',     35.1796,  129.0756, 'One of my favourite cities, with the ocean everywhere, incredible seafood, and the lit-up harbour bridge stitching the skyline together at night.'],
      ['seoul',     'Seoul, South Korea',     37.5665,  126.9780, 'Palace halls built with joinery instead of nails, museums of naval and military innovation, and Korean BBQ as the reward after.'],
      ['dali',      'Dali, China',            25.6065,  100.2676, 'The perfect vacation city, with unreal scenery and the Three Pagodas standing through a millennium of earthquakes on Tang-dynasty engineering.'],
      ['datong',    'Datong, China',          40.0768,  113.3001, 'The Hanging Temple, cantilevered off a cliff on timber beams 1,500 years ago, is some of the boldest structural thinking I\u2019ve ever seen, next to the carved grottoes.'],
      ['taiyuan',   'Taiyuan, China',         37.8706,  112.5489, 'Where I was born, and still home to the best food I know. Shanxi noodle-making is its own engineering discipline.'],
      ['qingdao',   'Qingdao, China',         36.0671,  120.3826, 'German colonial houses against the mountains, facades that turn into light shows at night, and delivery robots already part of daily life. A century of engineering side by side.'],
      ['vienna',    'Vienna, Austria',        48.2082,   16.3738, 'The city that got me into classical music. It\u2019s in the streets, the opera houses, everywhere. My study playlist traces back to here.'],
      ['salzburg',  'Salzburg, Austria',      47.8095,   13.0550, 'A slower pace of life under a hilltop fortress, Mozart\u2019s hometown, where the old town feels untouched by centuries.'],
      ['munich',    'Munich, Germany',        48.1351,   11.5820, 'Automotive history at its source, a century of German car engineering, framed by Gothic and baroque architecture.'],
      ['nuremberg', 'Nuremberg, Germany',     49.4521,   11.0767, 'A city for learning history head-on, medieval walls and a castle above, and the weight of the twentieth century below.'],
      ['berlin',    'Berlin, Germany',        52.5200,   13.4050, 'German history at its rawest. The divided city, the Brandenburg Gate, and the Reichstag\u2019s mirrored dome funnelling daylight into parliament. Old wounds, modern engineering.'],
      ['dresden',   'Dresden, Germany',       51.0504,   13.7373, 'A city once consumed by flames, rebuilt stone by stone, the clearest lesson I\u2019ve seen in how engineering can both destroy and restore.'],
      ['amsterdam', 'Amsterdam, Netherlands', 52.3676,    4.9041, 'Naval engineering history everywhere, and a city that still runs daily life on water. Canals as infrastructure that never went obsolete.'],
      ['delft',     'Delft, Netherlands',     52.0116,    4.3571, 'Wind energy country. The Dutch have been engineering the wind for centuries, from mills to modern turbine research.'],
      ['antwerp',   'Antwerp, Belgium',       51.2194,    4.4025, 'A port city built around its diamond trade and Gothic cathedral, with engineering in the locks and cranes that still move the harbour today.'],
      ['groningen', 'Groningen, Netherlands', 53.2194,    6.5665, 'A cycling-first city built almost entirely around bikes, proof that infrastructure design shapes how people actually live.'],
      ['brussels',  'Brussels, Belgium',      50.8476,    4.3572, 'European art and the EU institutions in one city, where policy shaping the continent\u2019s engineering and industry gets decided.'],
      ['prague',    'Prague, Czechia',        50.0755,   14.4378, 'Prague Castle makes it feel medieval again. The defensive engineering and weaponry show how much problem-solving went into fortification centuries before CAD.'],
      ['rome',      'Rome, Italy',            41.9028,   12.4964, 'The Colosseum is 2,000-year-old crowd-flow engineering. The Romans solved problems we still study, with concrete we still can\u2019t fully replicate.'],
      ['pompeii',   'Pompeii, Italy',         40.7462,   14.4989, 'Walking the ruins of a complete Roman city, with streets, plumbing, and homes engineered two millennia ago, preserved mid-use.'],
      ['sorrento',  'Sorrento, Italy',        40.6263,   14.3758, 'Cliffside coastline atmosphere and lemon sorbets the size of a softball. In this case, I\u2019d like to tell myself that not everything needs an engineering angle.'],
      ['assisi',    'Assisi, Italy',          43.0707,   12.6196, 'Beautiful basilicas built into the hillside in pink stone, sacred architecture doing serious structural work on a slope.'],
      ['pisa',      'Pisa, Italy',            43.7228,   10.4017, 'The Leaning Tower is a masterclass in engineering adaptation, a marvellous idea acting as an incredible testament to the power of science.'],
      ['florence',  'Florence, Italy',        43.7696,   11.2558, 'Brunelleschi\u2019s dome: four million bricks, no scaffolding, pure geometric problem-solving. The art everywhere (and the best sandwich I\u2019ve had) seal it.'],
      ['venice',    'Venice, Italy',          45.4408,   12.3155, 'A city where nature constantly takes from building science, and engineering keeps adapting back, from timber-pile foundations to modern flood barriers.'],
      ['sirmione',  'Sirmione, Italy',        45.4934,   10.6081, 'Preserved medieval streets on a lake peninsula, old European architecture that survived because it was over-engineered from the start.'],
    ];

    const map = L.map(el, { scrollWheelZoom: false, worldCopyJump: true })
      .setView([38, 25], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_2dqx_1_dbd717915a7343be2d12132d', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd', maxZoom: 19,
    }).addTo(map);

    // scroll zoom only after the user clicks the map (prevents page-scroll hijack)
    map.on('click', () => map.scrollWheelZoom.enable());
    el.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());

    const icon = L.divIcon({ className: '', html: '<div class="cl-pin"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });

    CITIES.forEach(([slug, name, lat, lng, note]) => {
      const imgSrc = `travel/map/${slug}.webp`;
      const html =
        `<img class="mp-img" src="${imgSrc}" alt="${name}" width="260" height="130" decoding="async" onerror="this.remove()">` +
        `<div class="mp-body"><p class="mp-city">Field Note</p>` +
        `<p class="mp-title">${name}</p>` +
        `<p class="mp-desc">${note}</p></div>`;
      const marker = L.marker([lat, lng], { icon, title: name })
        .addTo(map)
        .bindPopup(html, { maxWidth: 260 });

      // clicking the popup photo opens it full-size in the shared lightbox
      marker.on('popupopen', (e) => {
        const img = e.popup.getElement().querySelector('.mp-img');
        if (img && img.isConnected) {
          img.style.cursor = 'zoom-in';
          img.addEventListener('click', () => window.__openLb && window.__openLb([img.currentSrc || img.src], 0));
        }
      });
    });

    const counter = document.getElementById('map-count');
    if (counter) counter.textContent = CITIES.length + ' cities';
})();

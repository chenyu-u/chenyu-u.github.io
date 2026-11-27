# vendor/

Third-party libraries, copied here so the site loads them from its own address
(no extra connections to a CDN before the page can start).

| Folder / file | Library | Version | Licence |
|---|---|---|---|
| `three/three.module.min.js`, `three/addons/` | [three.js](https://threejs.org) | r160 (0.160.0) | MIT |
| `lenis.min.js` | [Lenis](https://github.com/darkroomengineering/lenis) smooth scrolling | 1.1.13 | MIT |
| `leaflet/` | [Leaflet](https://leafletjs.com) maps | 1.9.4 | BSD 2-Clause |

Fonts in `../fonts/`: Archivo (variable weight) and IBM Plex Mono, both under the
SIL Open Font License 1.1, taken from the Fontsource packages.

To update a library: `npm install three@<version>` in a scratch folder and copy the
same files over these. The pages find three.js through the import map in their `<head>`.

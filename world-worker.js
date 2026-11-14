/* world-worker.js · builds the landscape on a second thread (see world-terrain.js).
   Started from the head of index.html, so it is already working while three.js downloads. */
import { generate } from './world-terrain.js';
self.onmessage = (e) => { generate(e.data, (msg, transfer) => self.postMessage(msg, transfer || [])); };

/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

const Stream = require('../lib/stream');

for (let i = 0; i < 10000000; i++) {
  let id = parseInt(Math.random() * 16777216);
  let buffer = Stream.idToBuffer(id);
  let newId = Stream.bufferToId(buffer);
  if (id !== newId) {
    console.log(buffer);
    throw new Error(`#${i} ${id} => ${newId}`);
  }
}


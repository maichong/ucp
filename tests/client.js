/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

process.title = 'ucp_client';

const ucp = require('../index');

const monitor = require('./monitor');

function getBuffer() {
  let buffer = new Buffer(parseInt(14000 * Math.random()));
  buffer.fill('t');
  return buffer;
}

let wave = 256;
let COUNT = 200;

let count = COUNT;

let stream = ucp.connect({
  port: process.env.UCP_PORT || 30000,
  host: process.env.UCP_HOST || '127.0.0.1',
  secret: '123456',
  autoClose: false
}, function () {
  console.log('on connect', stream.id);
  monitor(stream);
  function send() {
    stream.write(getBuffer());
    count--;
    if (count > 0) {
      setTimeout(send, 0);
      return;
    }

    wave--;
    count = COUNT;

    if (wave > 0) {
      setTimeout(send, 1);
      return;
    }

    stream.close();
  }

  send();

});

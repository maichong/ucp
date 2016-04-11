/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

process.title = 'utp_client';

const utp = require('../index');

let buffer = new Buffer(1024 * 1024);
buffer.fill('t');

let count = 256;

utp.connect({
  port: process.env.UCP_PORT || 30000,
  host: process.env.UCP_HOST,
  password: '123456',
  autoClose: false
}, function (stream) {
  console.log('on connect', stream.id);
  stream.on('data', data => {
    console.log(stream.remoteAddress + ':' + stream.remotePort, data.toString());
    //stream.close();
  });
  function send() {
    stream.write(buffer);
    count--;
    if (count > 0) {
      setTimeout(send, 5);
    }
  }

  send();
});

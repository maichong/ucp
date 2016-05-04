/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';

process.title = 'utp_server';

const utp = require('../index');

const monitor = require('./monitor');

let server = utp.createServer({
  port: process.env.UCP_PORT || 30000,
  password: '123456'
}, function (stream) {
  console.log('income steam', stream.id);
  monitor(stream);
  stream.on('data', data => stream.write(data));
});

server.listen();

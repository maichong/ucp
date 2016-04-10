/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-04-10
 * @author Liang <liang@maichong.it>
 */

'use strict';


const utp = require('../index');

let server = utp.createServer({
  port: 30000,
  password: '123456'
}, function (stream) {
  console.log('income steam', stream.id);
  stream.on('data', data => {
    console.log('receive ', data.toString());
  });
});

server.listen();
